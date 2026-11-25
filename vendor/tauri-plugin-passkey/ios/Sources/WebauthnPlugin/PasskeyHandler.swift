import AuthenticationServices
import Foundation
import UIKit

@MainActor
final class PasskeyHandler: NSObject {
    private var registrationContinuation: CheckedContinuation<ASAuthorization, Error>?
    private var assertionContinuation: CheckedContinuation<ASAuthorization, Error>?
    private var activeController: ASAuthorizationController?

    func register(
        domain: String, challenge: Data, username: String, displayName: String,
        userID: Data, excludeCredentials: [Data], prfEnabled: Bool
    ) async throws -> ASAuthorization {
        let platformProvider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: domain)
        let platformRequest = platformProvider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: username,
            userID: userID
        )

        if prfEnabled {
            if #available(iOS 18.0, *) {
                platformRequest.prf = .checkForSupport
            }
        }

        if !excludeCredentials.isEmpty {
            platformRequest.excludedCredentials = excludeCredentials.map {
                ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0)
            }
        }

        let securityKeyProvider = ASAuthorizationSecurityKeyPublicKeyCredentialProvider(relyingPartyIdentifier: domain)
        let securityKeyRequest = securityKeyProvider.createCredentialRegistrationRequest(
            challenge: challenge,
            displayName: displayName,
            name: username,
            userID: userID
        )
        securityKeyRequest.credentialParameters = [
            ASAuthorizationPublicKeyCredentialParameters(algorithm: .ES256),
        ]
        if !excludeCredentials.isEmpty {
            securityKeyRequest.excludedCredentials = excludeCredentials.map {
                ASAuthorizationSecurityKeyPublicKeyCredentialDescriptor(
                    credentialID: $0,
                    transports: ASAuthorizationSecurityKeyPublicKeyCredentialDescriptor.Transport.allSupported
                )
            }
        }

        let controller = ASAuthorizationController(authorizationRequests: [platformRequest, securityKeyRequest])
        controller.delegate = self
        controller.presentationContextProvider = self

        return try await withCheckedThrowingContinuation { continuation in
            self.registrationContinuation = continuation
            self.activeController = controller
            controller.performRequests()
        }
    }

    func authenticate(
        domain: String, challenge: Data, allowCredentials: [Data],
        prfSalt1: Data?, prfSalt2: Data?
    ) async throws -> ASAuthorization {
        let platformProvider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: domain)
        let platformRequest = platformProvider.createCredentialAssertionRequest(challenge: challenge)

        let securityKeyProvider = ASAuthorizationSecurityKeyPublicKeyCredentialProvider(relyingPartyIdentifier: domain)
        let securityKeyRequest = securityKeyProvider.createCredentialAssertionRequest(challenge: challenge)

        if !allowCredentials.isEmpty {
            platformRequest.allowedCredentials = allowCredentials.map {
                ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0)
            }
            securityKeyRequest.allowedCredentials = allowCredentials.map {
                ASAuthorizationSecurityKeyPublicKeyCredentialDescriptor(
                    credentialID: $0,
                    transports: ASAuthorizationSecurityKeyPublicKeyCredentialDescriptor.Transport.allSupported
                )
            }
        }

        // PRF is only supported on platform authenticators (passkeys), not security keys
        if let salt1 = prfSalt1 {
            if #available(iOS 18.0, *) {
                let inputValues: ASAuthorizationPublicKeyCredentialPRFAssertionInput.InputValues
                if let salt2 = prfSalt2 {
                    inputValues = .saltInput1(salt1, saltInput2: salt2)
                } else {
                    inputValues = .saltInput1(salt1)
                }
                platformRequest.prf = .inputValues(inputValues)
            }
        }

        let controller = ASAuthorizationController(authorizationRequests: [platformRequest, securityKeyRequest])
        controller.delegate = self
        controller.presentationContextProvider = self

        return try await withCheckedThrowingContinuation { continuation in
            self.assertionContinuation = continuation
            self.activeController = controller
            controller.performRequests()
        }
    }

    func cancel() {
        // Dismiss the system sheet. This asynchronously triggers
        // didCompleteWithError(ASAuthorizationError.canceled), which is a
        // no-op because the continuations are nil-ed below first.
        activeController?.cancel()
        activeController = nil
        registrationContinuation?.resume(throwing: CancellationError())
        registrationContinuation = nil
        assertionContinuation?.resume(throwing: CancellationError())
        assertionContinuation = nil
    }
}

// MARK: - ASAuthorizationControllerDelegate

extension PasskeyHandler: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for _: ASAuthorizationController) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return scene?.windows.first(where: { $0.isKeyWindow })
            ?? scene?.windows.first
            ?? UIWindow()
    }

    func authorizationController(
        controller _: ASAuthorizationController, didCompleteWithAuthorization auth: ASAuthorization
    ) {
        activeController = nil
        if auth.credential is ASAuthorizationPlatformPublicKeyCredentialRegistration
            || auth.credential is ASAuthorizationSecurityKeyPublicKeyCredentialRegistration
        {
            registrationContinuation?.resume(returning: auth)
            registrationContinuation = nil
        } else if auth.credential is ASAuthorizationPlatformPublicKeyCredentialAssertion
            || auth.credential is ASAuthorizationSecurityKeyPublicKeyCredentialAssertion
        {
            assertionContinuation?.resume(returning: auth)
            assertionContinuation = nil
        }
    }

    func authorizationController(controller _: ASAuthorizationController, didCompleteWithError error: Error) {
        activeController = nil
        registrationContinuation?.resume(throwing: error)
        registrationContinuation = nil
        assertionContinuation?.resume(throwing: error)
        assertionContinuation = nil
    }
}

// MARK: - Response Serialization

enum PasskeyHandlerError: LocalizedError {
    case unexpectedCredentialType
    case missingAttestationObject

    var errorDescription: String? {
        switch self {
        case .unexpectedCredentialType: return "Unexpected credential type in authorization response"
        case .missingAttestationObject: return "Registration returned no attestation object"
        }
    }
}

func registrationJSON(from auth: ASAuthorization) throws -> [String: Any] {
    guard let reg = auth.credential as? ASAuthorizationPublicKeyCredentialRegistration else {
        throw PasskeyHandlerError.unexpectedCredentialType
    }
    guard let attestationObject = reg.rawAttestationObject else {
        throw PasskeyHandlerError.missingAttestationObject
    }
    var json: [String: Any] = [
        "id": reg.credentialID.base64URLEncodedString(),
        "rawId": reg.credentialID.base64URLEncodedString(),
        "type": "public-key",
        "response": [
            "attestationObject": attestationObject.base64URLEncodedString(),
            "clientDataJSON": reg.rawClientDataJSON.base64URLEncodedString(),
        ],
    ]

    // Extract PRF registration result (iOS 18+)
    if #available(iOS 18.0, *) {
        if let platformReg = reg as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
           let prfResult = platformReg.prf
        {
            json["prf"] = ["enabled": prfResult.isSupported]
        }
    }

    return json
}

func assertionJSON(from auth: ASAuthorization) throws -> [String: Any] {
    guard let assertion = auth.credential as? ASAuthorizationPublicKeyCredentialAssertion else {
        throw PasskeyHandlerError.unexpectedCredentialType
    }
    var response: [String: Any] = [
        "authenticatorData": assertion.rawAuthenticatorData.base64URLEncodedString(),
        "clientDataJSON": assertion.rawClientDataJSON.base64URLEncodedString(),
        "signature": assertion.signature.base64URLEncodedString(),
    ]
    if !assertion.userID.isEmpty {
        response["userHandle"] = assertion.userID.base64URLEncodedString()
    }
    var json: [String: Any] = [
        "id": assertion.credentialID.base64URLEncodedString(),
        "rawId": assertion.credentialID.base64URLEncodedString(),
        "type": "public-key",
        "response": response,
    ]

    // Extract PRF assertion result (iOS 18+)
    if #available(iOS 18.0, *) {
        if let platformAssertion = assertion as? ASAuthorizationPlatformPublicKeyCredentialAssertion,
           let prfResult = platformAssertion.prf
        {
            let firstData = prfResult.first.withUnsafeBytes { Data($0) }
            var prfDict: [String: Any] = [
                "first": firstData.base64URLEncodedString(),
            ]
            if let second = prfResult.second {
                let secondData = second.withUnsafeBytes { Data($0) }
                prfDict["second"] = secondData.base64URLEncodedString()
            }
            json["prf"] = prfDict
        }
    }

    return json
}

// MARK: - Data Helpers

extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

func base64URLDecode(_ str: String) -> Data? {
    var base64 = str
        .replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
    while base64.count % 4 != 0 {
        base64.append("=")
    }
    return Data(base64Encoded: base64)
}
