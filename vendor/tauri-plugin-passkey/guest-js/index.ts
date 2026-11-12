import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

/**
 * The WebAuthn JSON types used below — `PublicKeyCredentialCreationOptionsJSON`,
 * `PublicKeyCredentialRequestOptionsJSON`, `RegistrationResponseJSON` and
 * `AuthenticationResponseJSON` — are standard DOM types, globally available to
 * any consumer compiling with the `DOM` lib. Only the union of the two response
 * types has no name in the DOM lib, so it is declared here.
 */
export type PublicKeyCredentialJSON =
  RegistrationResponseJSON | AuthenticationResponseJSON;

export type PasskeyEvent =
  | {
      type: PasskeyEventType.SelectDevice | PasskeyEventType.PresenceRequired;
    }
  | {
      type: PasskeyEventType.PinEvent;
      event: PinEvent;
    }
  | {
      type: PasskeyEventType.SelectKey;
      keys: AuthKey[];
    };

export enum PasskeyEventType {
  SelectDevice = "selectDevice",
  PresenceRequired = "presenceRequired",
  PinEvent = "pinEvent",
  SelectKey = "selectKey",
}

export type PinEvent =
  | {
      type:
        | PinEventType.PinRequired
        | PinEventType.PinAuthBlocked
        | PinEventType.PinBlocked
        | PinEventType.UvBlocked
        | PinEventType.PinIsTooShort
        | PinEventType.PinNotSet;
    }
  | {
      type: PinEventType.InvalidPin | PinEventType.InvalidUv;
      attempts_remaining?: number;
    }
  | {
      type: PinEventType.PinIsTooLong;
      max_length: number;
    };

export enum PinEventType {
  PinRequired = "pinRequired",
  InvalidPin = "invalidPin",
  PinAuthBlocked = "pinAuthBlocked",
  PinBlocked = "pinBlocked",
  InvalidUv = "invalidUv",
  UvBlocked = "uvBlocked",
  PinIsTooShort = "pinIsTooShort",
  PinIsTooLong = "pinIsTooLong",
  PinNotSet = "pinNotSet",
}

export type AuthKey = {
  id: string;
  name?: string;
  displayName?: string;
};

/**
 * Known error kinds. The set is non-exhaustive: future minor releases may add
 * kinds, so treat unknown strings as a generic failure.
 */
export type PasskeyErrorKind =
  | "io"
  | "platform"
  | "serialization"
  | "noToken"
  | "validation"
  | "authenticator"
  // Raised for a request the platform cannot fulfill by design, not by
  // failure: PRF on Windows (no PRF support at all), `prf.eval` at
  // registration (evaluate salts during authentication instead), and
  // `residentKey: "discouraged"` on Android (Credential Manager only
  // creates discoverable credentials).
  | "unsupported"
  | (string & {});

/**
 * Every rejected plugin promise carries this shape.
 * `message` is human-readable display text; branch on `kind`.
 */
export interface PasskeyError {
  kind: PasskeyErrorKind;
  message: string;
}

/** Type guard for errors thrown by this plugin's commands. */
export function isPasskeyError(e: unknown): e is PasskeyError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as PasskeyError).kind === "string" &&
    typeof (e as PasskeyError).message === "string"
  );
}

export const EVENT_NAME = "tauri-plugin-passkey";

/**
 * Tries to register using the native WebAuthn API.
 *
 * @param origin The origin of the request. This is used to verify the request.
 * @param options The webauthn options. This is used to create the request.
 * @param timeout Optional timeout in milliseconds. Defaults to 60000 on the Rust side.
 * @returns A promise that resolves to the registration response.
 */
export async function register(
  origin: string,
  options: PublicKeyCredentialCreationOptionsJSON,
  timeout?: number
): Promise<RegistrationResponseJSON> {
  return await invoke<RegistrationResponseJSON>("plugin:passkey|register", {
    origin,
    options,
    timeout,
  });
}

/**
 * Tries to authenticate using the native WebAuthn API.
 *
 * @param origin The origin of the request. This is used to verify the request.
 * @param options The webauthn options. This is used to create the request.
 * @param timeout Optional timeout in milliseconds. Defaults to 60000 on the Rust side.
 * @returns A promise that resolves to the authentication response.
 */
export async function authenticate(
  origin: string,
  options: PublicKeyCredentialRequestOptionsJSON,
  timeout?: number
): Promise<PublicKeyCredentialJSON> {
  return await invoke<PublicKeyCredentialJSON>("plugin:passkey|authenticate", {
    origin,
    options,
    timeout,
  });
}

/**
 * Sends a pin to the authenticator.
 * Only needed on Linux; PIN entry is handled natively elsewhere.
 *
 * @param pin The pin to send to the authenticator.
 * @returns A promise that resolves when the pin has been sent.
 */
export async function sendPin(pin: string): Promise<void> {
  return await invoke("plugin:passkey|send_pin", {
    pin,
  });
}

/**
 * Select a key from the list delivered by the `selectKey` event.
 * Only meaningful on Linux; does nothing on Windows and mobile.
 *
 * @param index The zero-based index into the `keys` array of the `selectKey` event.
 * @returns A promise that resolves once the selection has been sent.
 */
export async function selectKey(index: number): Promise<void> {
  return await invoke("plugin:passkey|select_key", {
    key: index,
  });
}

/**
 * Cancels the current operation.
 * Cancels the pending operation on Linux, macOS, iOS, and Android. Does nothing on Windows.
 *
 * @returns A promise that resolves when the operation has been cancelled.
 */
export async function cancel(): Promise<void> {
  return await invoke("plugin:passkey|cancel");
}

/**
 * Creates a listener for plugin events.
 * Events are only emitted on Linux; other platforms show native UI instead.
 *
 * @param listener The listener to call when the event is triggered.
 * @returns A promise that resolves to a function that can be used to unregister the listener.
 */
export async function registerListener(
  listener: (event: PasskeyEvent) => void
): Promise<UnlistenFn> {
  return listen(EVENT_NAME, (event) => {
    listener(event.payload as PasskeyEvent);
  });
}
