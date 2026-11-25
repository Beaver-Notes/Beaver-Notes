import AuthenticationServices
import CryptoKit
import Foundation

// MARK: - Active handler storage

/// Module-level storage for the active handler, accessed on the main actor.
@MainActor
private var activePasskeyHandler: PasskeyHandler?

// MARK: - C-callable FFI exports

/// Callback type: receives a JSON C-string (or null on failure) and a context pointer.
/// The Rust side owns the C-string and must free it with `webauthn_free_string`.
public typealias WebauthnCallback = @Sendable @convention(c) (
    UnsafePointer<CChar>?, // json result (null = error)
    UnsafePointer<CChar>?, // error message (null = success)
    UInt64 // context
) -> Void

@_cdecl("webauthn_register")
public func webauthnRegister(
    domain: UnsafePointer<CChar>,
    challengePtr: UnsafePointer<UInt8>,
    challengeLen: UInt,
    username: UnsafePointer<CChar>,
    displayName: UnsafePointer<CChar>,
    userIdPtr: UnsafePointer<UInt8>,
    userIdLen: UInt,
    excludeCredentialsJson: UnsafePointer<CChar>?,
    prfEnabled: UInt8,
    context: UInt64,
    callback: WebauthnCallback
) {
    let domainStr = String(cString: domain)
    let challengeData = Data(bytes: challengePtr, count: Int(challengeLen))
    let usernameStr = String(cString: username)
    let displayNameStr = String(cString: displayName)
    let userIdData = Data(bytes: userIdPtr, count: Int(userIdLen))
    let wantPrf = prfEnabled != 0

    var excludedCredentials: [Data] = []
    if let jsonPtr = excludeCredentialsJson {
        let jsonStr = String(cString: jsonPtr)
        if let jsonData = jsonStr.data(using: .utf8),
           let arr = try? JSONSerialization.jsonObject(with: jsonData) as? [String]
        {
            excludedCredentials = arr.compactMap { base64URLDecode($0) }
        }
    }

    Task { @MainActor in
        let handler = PasskeyHandler()
        activePasskeyHandler = handler
        defer { activePasskeyHandler = nil }
        do {
            let auth = try await handler.register(
                domain: domainStr,
                challenge: challengeData,
                username: usernameStr,
                displayName: displayNameStr,
                userID: userIdData,
                excludeCredentials: excludedCredentials,
                prfEnabled: wantPrf
            )

            let json = try registrationJSON(from: auth)
            callbackWithJSON(json, context: context, callback: callback)
        } catch {
            callbackWithError(error, context: context, callback: callback)
        }
    }
}

@_cdecl("webauthn_authenticate")
public func webauthnAuthenticate(
    domain: UnsafePointer<CChar>,
    challengePtr: UnsafePointer<UInt8>,
    challengeLen: UInt,
    allowCredentialsJson: UnsafePointer<CChar>?,
    prfSalt1Ptr: UnsafePointer<UInt8>?,
    prfSalt1Len: UInt,
    prfSalt2Ptr: UnsafePointer<UInt8>?,
    prfSalt2Len: UInt,
    context: UInt64,
    callback: WebauthnCallback
) {
    let domainStr = String(cString: domain)
    let challengeData = Data(bytes: challengePtr, count: Int(challengeLen))

    var allowedCredentials: [Data] = []
    if let jsonPtr = allowCredentialsJson {
        let jsonStr = String(cString: jsonPtr)
        if let jsonData = jsonStr.data(using: .utf8),
           let arr = try? JSONSerialization.jsonObject(with: jsonData) as? [String]
        {
            allowedCredentials = arr.compactMap { base64URLDecode($0) }
        }
    }

    let prfSalt1: Data? = (prfSalt1Ptr != nil && prfSalt1Len > 0) ? Data(bytes: prfSalt1Ptr!, count: Int(prfSalt1Len)) : nil
    let prfSalt2: Data? = (prfSalt2Ptr != nil && prfSalt2Len > 0) ? Data(bytes: prfSalt2Ptr!, count: Int(prfSalt2Len)) : nil

    Task { @MainActor in
        let handler = PasskeyHandler()
        activePasskeyHandler = handler
        defer { activePasskeyHandler = nil }
        do {
            let auth = try await handler.authenticate(
                domain: domainStr,
                challenge: challengeData,
                allowCredentials: allowedCredentials,
                prfSalt1: prfSalt1,
                prfSalt2: prfSalt2
            )

            let json = try assertionJSON(from: auth)
            callbackWithJSON(json, context: context, callback: callback)
        } catch {
            callbackWithError(error, context: context, callback: callback)
        }
    }
}

@_cdecl("webauthn_free_string")
public func webauthnFreeString(ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}

@_cdecl("webauthn_cancel")
public func webauthnCancel() {
    DispatchQueue.main.async {
        activePasskeyHandler?.cancel()
        activePasskeyHandler = nil
    }
}

// MARK: - Response serialization

enum BridgeError: LocalizedError {
    case unexpectedCredentialType
    case missingAttestationObject

    var errorDescription: String? {
        switch self {
        case .unexpectedCredentialType: return "Unexpected credential type in authorization response"
        case .missingAttestationObject: return "Registration returned no attestation object"
        }
    }
}

private func registrationJSON(from auth: ASAuthorization) throws -> [String: Any] {
    guard let reg = auth.credential as? ASAuthorizationPublicKeyCredentialRegistration else {
        throw BridgeError.unexpectedCredentialType
    }
    guard let attestationObject = reg.rawAttestationObject else {
        throw BridgeError.missingAttestationObject
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

    // Extract PRF registration result (macOS 15+)
    if #available(macOS 15.0, *) {
        if let platformReg = reg as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
           let prfResult = platformReg.prf
        {
            json["prf"] = ["enabled": prfResult.isSupported]
        }
    }

    return json
}

private func assertionJSON(from auth: ASAuthorization) throws -> [String: Any] {
    guard let assertion = auth.credential as? ASAuthorizationPublicKeyCredentialAssertion else {
        throw BridgeError.unexpectedCredentialType
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

    // Extract PRF assertion result (macOS 15+)
    if #available(macOS 15.0, *) {
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

// MARK: - Helpers

private func callbackWithJSON(_ json: [String: Any], context: UInt64, callback: WebauthnCallback) {
    guard let jsonData = try? JSONSerialization.data(withJSONObject: json),
          let jsonStr = String(data: jsonData, encoding: .utf8)
    else {
        callbackWithError(
            NSError(
                domain: "WebauthnBridge", code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to serialize JSON"]
            ),
            context: context,
            callback: callback
        )
        return
    }
    jsonStr.withCString { cStr in
        callback(strdup(cStr), nil, context)
    }
}

private func callbackWithError(_ error: Error, context: UInt64, callback: WebauthnCallback) {
    error.localizedDescription.withCString { cStr in
        callback(nil, strdup(cStr), context)
    }
}

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
