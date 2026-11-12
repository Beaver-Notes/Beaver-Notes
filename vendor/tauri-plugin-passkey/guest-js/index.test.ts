import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri IPC surface. `vi.hoisted` lets the mock factories (which are
// hoisted above the imports) reference these shared spies.
const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import {
  register,
  authenticate,
  sendPin,
  selectKey,
  cancel,
  registerListener,
  EVENT_NAME,
  PasskeyEventType,
  PinEventType,
  isPasskeyError,
  type PasskeyEvent,
} from "./index";

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset();
  // Default: resolve so the awaiting wrappers don't hang.
  invoke.mockResolvedValue(undefined);
});

describe("register", () => {
  it("invokes the register command with origin + options and returns the result", async () => {
    const options = { challenge: "abc" } as unknown as Parameters<
      typeof register
    >[1];
    const expected = { id: "cred-1" };
    invoke.mockResolvedValueOnce(expected);

    const result = await register("https://example.com", options);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("plugin:passkey|register", {
      origin: "https://example.com",
      options,
    });
    expect(result).toBe(expected);
  });
});

describe("authenticate", () => {
  it("invokes the authenticate command with origin + options and returns the result", async () => {
    const options = { challenge: "def" } as unknown as Parameters<
      typeof authenticate
    >[1];
    const expected = { id: "cred-2" };
    invoke.mockResolvedValueOnce(expected);

    const result = await authenticate("https://example.com", options);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("plugin:passkey|authenticate", {
      origin: "https://example.com",
      options,
    });
    expect(result).toBe(expected);
  });
});

describe("timeout option", () => {
  it("passes timeout through to register", async () => {
    const options = { challenge: "abc" } as unknown as Parameters<
      typeof register
    >[1];

    await register("https://example.com", options, 30_000);

    expect(invoke).toHaveBeenCalledWith("plugin:passkey|register", {
      origin: "https://example.com",
      options,
      timeout: 30_000,
    });
  });

  it("omits timeout from authenticate when not given", async () => {
    const options = { challenge: "def" } as unknown as Parameters<
      typeof authenticate
    >[1];

    await authenticate("https://example.com", options);

    expect(invoke).toHaveBeenCalledWith("plugin:passkey|authenticate", {
      origin: "https://example.com",
      options,
      timeout: undefined,
    });
  });
});

describe("sendPin", () => {
  it("invokes send_pin with the pin payload", async () => {
    await sendPin("1234");

    expect(invoke).toHaveBeenCalledWith("plugin:passkey|send_pin", {
      pin: "1234",
    });
  });
});

describe("selectKey", () => {
  it("maps the numeric index argument onto the `key` payload field", async () => {
    await selectKey(2);

    // Regression guard: the JS parameter is `index` but the backend expects
    // the payload field to be named `key`.
    expect(invoke).toHaveBeenCalledWith("plugin:passkey|select_key", {
      key: 2,
    });
  });
});

describe("cancel", () => {
  it("invokes cancel with no payload argument", async () => {
    await cancel();

    expect(invoke).toHaveBeenCalledWith("plugin:passkey|cancel");
    // Regression guard: cancel must not send a second (payload) argument.
    expect(invoke.mock.calls[0]).toHaveLength(1);
  });
});

describe("registerListener", () => {
  it("subscribes to EVENT_NAME and forwards the event payload to the listener", async () => {
    let captured: ((event: { payload: unknown }) => void) | undefined;
    const unlisten = () => {};
    listen.mockImplementation((_name: string, cb: typeof captured) => {
      captured = cb;
      return Promise.resolve(unlisten);
    });

    const userListener = vi.fn();
    const returned = await registerListener(userListener);

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen.mock.calls[0][0]).toBe(EVENT_NAME);
    expect(returned).toBe(unlisten);

    const payload: PasskeyEvent = { type: PasskeyEventType.SelectDevice };
    captured?.({ payload });

    expect(userListener).toHaveBeenCalledWith(payload);
  });
});

describe("constants and enums", () => {
  it("exposes the event channel name the backend emits on", () => {
    expect(EVENT_NAME).toBe("tauri-plugin-passkey");
  });

  it("keeps PasskeyEventType values in sync with the Rust camelCase serde tags", () => {
    expect(PasskeyEventType.SelectDevice).toBe("selectDevice");
    expect(PasskeyEventType.PresenceRequired).toBe("presenceRequired");
    expect(PasskeyEventType.PinEvent).toBe("pinEvent");
    expect(PasskeyEventType.SelectKey).toBe("selectKey");
  });

  it("keeps PinEventType values in sync with the Rust camelCase serde tags", () => {
    expect(PinEventType.PinRequired).toBe("pinRequired");
    expect(PinEventType.InvalidPin).toBe("invalidPin");
    expect(PinEventType.PinAuthBlocked).toBe("pinAuthBlocked");
    expect(PinEventType.PinBlocked).toBe("pinBlocked");
    expect(PinEventType.InvalidUv).toBe("invalidUv");
    expect(PinEventType.UvBlocked).toBe("uvBlocked");
    expect(PinEventType.PinIsTooShort).toBe("pinIsTooShort");
    expect(PinEventType.PinIsTooLong).toBe("pinIsTooLong");
    expect(PinEventType.PinNotSet).toBe("pinNotSet");
  });
});

describe("isPasskeyError", () => {
  it("accepts a tagged error object", () => {
    expect(
      isPasskeyError({
        kind: "validation",
        message: "Validation error: bad rp_id",
      })
    ).toBe(true);
  });

  it("rejects strings, null, and objects missing fields", () => {
    expect(isPasskeyError("Validation error: bad rp_id")).toBe(false);
    expect(isPasskeyError(null)).toBe(false);
    expect(isPasskeyError({ kind: "validation" })).toBe(false);
    expect(isPasskeyError({ message: "x" })).toBe(false);
  });

  it("accepts unknown future kinds (contract is non-exhaustive)", () => {
    expect(isPasskeyError({ kind: "somethingNew", message: "x" })).toBe(true);
  });
});
