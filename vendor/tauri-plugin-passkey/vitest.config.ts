import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The guest-js API is a thin marshalling layer over @tauri-apps/api,
    // which is mocked in the tests, so a plain node environment is enough.
    environment: "node",
    include: ["guest-js/**/*.test.ts"],
  },
});
