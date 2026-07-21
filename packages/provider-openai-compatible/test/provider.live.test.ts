import { describe, expect, it } from "vitest";

import type { ProviderProfileV1 } from "@intent-bridge/core";

import { OpenAICompatibleProvider } from "../src/index.js";

const enabled = process.env.INTENT_BRIDGE_LIVE_TESTS === "1";
const baseUrl = process.env.INTENT_BRIDGE_LIVE_BASE_URL;
const model = process.env.INTENT_BRIDGE_LIVE_MODEL;
const apiKeyEnv = process.env.INTENT_BRIDGE_LIVE_API_KEY_ENV;
const structuredOutput = (process.env.INTENT_BRIDGE_LIVE_STRUCTURED_OUTPUT ??
  "json_schema") as ProviderProfileV1["capabilities"]["structuredOutput"];
const configuredTimeoutMs = Number(process.env.INTENT_BRIDGE_LIVE_TIMEOUT_MS);
const timeoutMs =
  Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : 30_000;
const configuredMaxOutputTokens = Number(
  process.env.INTENT_BRIDGE_LIVE_MAX_OUTPUT_TOKENS,
);
const maxOutputTokens =
  Number.isInteger(configuredMaxOutputTokens) && configuredMaxOutputTokens > 0
    ? configuredMaxOutputTokens
    : 4_096;
const ready =
  enabled && baseUrl && model && apiKeyEnv && process.env[apiKeyEnv];

describe.skipIf(!ready)("OpenAI-compatible live smoke", () => {
  it(
    "returns a valid intent document",
    async () => {
      const profile: ProviderProfileV1 = {
        id: "live",
        protocol: "openai-compatible",
        baseUrl: baseUrl as string,
        model: model as string,
        apiKeyEnv: apiKeyEnv as string,
        timeoutMs,
        maxOutputTokens,
        temperature: 0,
        capabilities: {
          structuredOutput,
          usageMetadata: true,
          supportsSeed: false,
        },
      };
      const result = await new OpenAICompatibleProvider(profile).interpret(
        {
          schemaVersion: "2",
          originalText: "Fix the profile page without changing payments.",
          messageType: "initial",
          attachmentSummary: { imageCount: 0 },
          projectContext: { instructionExcerpts: [] },
          outputRequirements: {
            contentLanguage: "en",
            preserveResponseLanguage: true,
            strictSchema: true,
            implementationCodeForbidden: true,
          },
        },
        {},
      );
      expect(result.intent.schemaVersion).toBe("2");
    },
    timeoutMs + 5_000,
  );
});
