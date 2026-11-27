import AppKit
import AuthenticationServices
import Foundation

@MainActor
public final class PasskeyHandler: NSObject {
    private var registrationContinuation: CheckedContinuation<ASAuthorization, Error>?
    private var assertionContinuation: CheckedContinuation<ASAuthorization, Error>?
    private var activeController: ASAuthorizationController?

    public func register(
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
            if #available(macOS 15.0, *) {
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

    public func authenticate(
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
            if #available(macOS 15.0, *) {
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

    public func cancel() {
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

extension PasskeyHandler: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public func presentationAnchor(for _: ASAuthorizationController) -> ASPresentationAnchor {
        NSApplication.shared.windows.first ?? NSWindow()
    }

    public func authorizationController(
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

    public func authorizationController(controller _: ASAuthorizationController, didCompleteWithError error: Error) {
        activeController = nil
        registrationContinuation?.resume(throwing: error)
        registrationContinuation = nil
        assertionContinuation?.resume(throwing: error)
        assertionContinuation = nil
    }
}
