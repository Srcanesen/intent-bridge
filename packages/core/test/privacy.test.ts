import { describe, expect, it } from "vitest";
import {
  fullLoggingWarning,
  privacyPreview,
  projectTrace,
  redactSecrets,
  type BridgeTraceV1,
} from "../src/index.js";

const trace: BridgeTraceV1 = {
  version: 1,
  traceId: "id",
  timestamp: "now",
  mode: "auto",
  status: "success",
  content: {
    originalText: "prompt secret",
    compiledTask: {
      compilerVersion: "pi-v1",
      text: "Bearer abcdefghijklmnop",
      responseLanguageCode: "en",
    },
    contextManifest: { Authorization: "Bearer top-secret", path: "npm test" },
  },
};
describe("privacy", () => {
  it("redacts bearer, PEM, API keys, credential URLs and long secret-like values while preserving commands", () => {
    const input =
      "Bearer abcdefghijklmnop sk_abcdefghijklmnopqrstuvwxyz https://u:password123@example.test -----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY----- npm test /tmp/path";
    const output = redactSecrets(input).text;
    expect(output).not.toMatch(
      /abcdefghijklmnop|password123|BEGIN PRIVATE KEY/,
    );
    expect(output).toContain("npm test /tmp/path");
  });
  it("metadata cannot serialize prompt or content", () => {
    const output = projectTrace({ mode: "metadata" }, trace);
    expect(JSON.stringify(output)).not.toContain("prompt secret");
    expect(output?.content).toBeUndefined();
  });
  it("full logging warns and recursively sanitizes sensitive values", () => {
    const output = projectTrace({ mode: "full" }, trace);
    expect(fullLoggingWarning({ mode: "full" })).toContain("sanitized");
    expect(JSON.stringify(output)).not.toContain("top-secret");
    expect(output?.content?.originalText).toBe("prompt secret");
  });
  it("off does not persist and preview has no bodies", () => {
    expect(projectTrace({ mode: "off" }, trace)).toBeUndefined();
    const preview = privacyPreview({
      enabled: true,
      logging: { mode: "full" },
      manifest: {
        totalCharacters: 4,
        redactionCount: 0,
        entries: [
          { path: "AGENTS.md", included: true },
          { path: ".env", included: false, reason: "denied" },
        ],
      },
    });
    expect(JSON.stringify(preview)).not.toContain("AGENTS.md");
    expect(preview).toEqual({
      enabled: true,
      eligibleCount: 1,
      excludedCount: 1,
      totalCharacters: 4,
      fullLogging: true,
    });
  });
});
