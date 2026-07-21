import { describe, expect, it, vi } from "vitest";
import type {
  IntentDocumentV1,
  IntentProvider,
  ProviderProfileV1,
} from "@intent-bridge/core";
import {
  parseBenchmarkCaseV1,
  runBenchmark,
  createReport,
} from "../src/index.js";
import { evidenceFor } from "./helpers.js";
const profile: ProviderProfileV1 = {
  id: "mock",
  protocol: "openai-compatible",
  baseUrl: "http://mock.test",
  model: "mock",
  apiKeyEnv: "MOCK",
  timeoutMs: 1,
  maxOutputTokens: 1,
  capabilities: {
    structuredOutput: "json_object",
    usageMetadata: true,
    supportsSeed: false,
  },
};
const c = parseBenchmarkCaseV1({
  version: 1,
  id: "one",
  title: "One",
  language: "en",
  messageType: "initial",
  input: "Fix login.",
  expected: {
    requiredGoalConcepts: ["fix login"],
    requiredConstraints: [],
    forbiddenAdditions: [],
    responseLanguage: "en",
  },
  tags: ["clear"],
});
const intent: IntentDocumentV1 = {
  schemaVersion: "1",
  sourceLanguage: { code: "en", confidence: 1 },
  responseLanguage: { code: "en" },
  messageType: "initial",
  goal: "Fix login",
  tasks: [
    {
      id: "login",
      objective: "Fix login",
      scope: [],
      constraints: [],
      successCriteria: [],
    },
  ],
  globalConstraints: [],
  assumptions: [],
  ambiguities: [],
  risk: { level: "low", reasons: [] },
  confidence: 1,
  clarification: { recommended: false },
};
describe("benchmark", () => {
  it("validates strictly and runs one provider call", async () => {
    expect(() => parseBenchmarkCaseV1({ ...c, extra: true })).toThrow();
    const provider: IntentProvider = {
      id: "mock",
      interpret: vi.fn().mockResolvedValue({
        intent,
        evidence: evidenceFor(intent),
        rawResponseHash: "x",
        latencyMs: 1,
      }),
      testConnection: vi.fn(),
    };
    const results = await runBenchmark({
      profileId: "mock",
      profile,
      cases: [c],
      provider,
    });
    expect(provider.interpret).toHaveBeenCalledTimes(1);
    expect(results[0]?.status).toBe("transformed");
    const report = createReport({
      profile: { id: "mock", model: "mock" },
      schemaVersion: "1",
      promptVersion: "x",
      compilerVersion: "pi-v1",
      runnerVersion: "benchmark-v1",
      startedAt: "x",
      completedAt: "x",
      concurrency: 1,
      results,
    });
    expect(report.aggregates.total).toBe(1);
  });
});
