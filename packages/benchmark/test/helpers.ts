import type {
  IntentDocumentV1,
  IntentProvider,
  ProviderProfileV1,
  QualitySignalsV1,
} from "@intent-bridge/core";
import type { BenchmarkCaseV1, BenchmarkResultV1 } from "../src/index.js";

export const profile: ProviderProfileV1 = {
  id: "mock",
  protocol: "openai-compatible",
  baseUrl: "http://mock.test",
  model: "mock-model",
  apiKeyEnv: "MOCK_KEY",
  timeoutMs: 100,
  maxOutputTokens: 100,
  capabilities: {
    structuredOutput: "json_object",
    usageMetadata: true,
    supportsSeed: false,
  },
  pricing: { currency: "USD", inputPerMillion: 1, outputPerMillion: 2 },
};
export const makeCase = (
  id = "one",
  overrides: Partial<BenchmarkCaseV1> = {},
): BenchmarkCaseV1 => ({
  version: 1,
  id,
  title: `Case ${id}`,
  language: "en",
  messageType: "initial",
  input: `Fix login ${id}.`,
  expected: {
    requiredGoalConcepts: ["fix login"],
    requiredConstraints: [],
    forbiddenAdditions: [],
    responseLanguage: "en",
  },
  tags: ["clear"],
  ...overrides,
});
export const makeIntent = (
  overrides: Partial<IntentDocumentV1> = {},
): IntentDocumentV1 => ({
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
  ...overrides,
});
export const providerWith = (
  interpret: IntentProvider["interpret"],
): IntentProvider => ({
  id: "mock",
  interpret,
  testConnection: async () => ({ ok: true, latencyMs: 1 }),
});
export const quality: QualitySignalsV1 = {
  schemaValid: true,
  languagePresent: true,
  taskCount: 1,
  hasGoal: true,
  constraintsSeparated: true,
  assumptionsSeparated: true,
  ambiguitiesTyped: true,
  compilerValid: true,
  providerConfidence: 0.8,
};
export const makeResult = (
  caseId: string,
  overrides: Partial<BenchmarkResultV1> = {},
): BenchmarkResultV1 => ({
  caseId,
  title: `Case ${caseId}`,
  tags: ["clear"],
  status: "transformed",
  latencyMs: 10,
  tokenUsage: { input: 2, output: 3, total: 5 },
  estimatedCostUsd: 0.01,
  quality,
  invariant: {
    passed: true,
    checks: [
      { name: "response_language", passed: true },
      { name: "forbidden_additions", passed: true },
    ],
  },
  ...overrides,
});
export const reportInput = (results: BenchmarkResultV1[], id = "mock") => ({
  profile: { id, model: "mock-model" },
  schemaVersion: "1" as const,
  promptVersion: "test-v1",
  compilerVersion: "pi-v1" as const,
  runnerVersion: "benchmark-v1" as const,
  startedAt: "2025-01-01T00:00:00.000Z",
  completedAt: "2025-01-01T00:00:01.000Z",
  concurrency: 2,
  results,
});
