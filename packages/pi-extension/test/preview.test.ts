import { describe, expect, it } from "vitest";

import {
  type FullInMemoryTransformation,
  type IntentDocumentV1,
  type QualityConfigV1,
  type TransformationAssessment,
  redactSecrets,
} from "@intent-bridge/core";

import {
  formatLastTransformation,
  formatTransformation,
} from "../src/preview.js";

const intent = (
  overrides: Partial<IntentDocumentV1> = {},
): IntentDocumentV1 => ({
  schemaVersion: "1",
  sourceLanguage: { code: "tr", name: "Turkish", confidence: 0.95 },
  responseLanguage: { code: "tr", name: "Turkish" },
  messageType: "initial",
  goal: "Fix the profile page layout.",
  tasks: [
    {
      id: "profile-layout",
      objective: "Fix the profile page layout.",
      scope: ["Profile page components."],
      constraints: ["Preserve the existing API."],
      successCriteria: ["The profile page layout is correct."],
    },
  ],
  globalConstraints: ["Do not add dependencies."],
  assumptions: [],
  ambiguities: [],
  risk: { level: "low", reasons: [] },
  confidence: 0.9,
  clarification: { recommended: false },
  ...overrides,
});

const qualityConfig = (
  overrides: Partial<QualityConfigV1> = {},
): QualityConfigV1 => ({
  enforcement: "observe",
  reviewOnHighRisk: true,
  reviewOnClarification: true,
  reviewOnMaterialAskUser: true,
  minConfidence: null,
  noUiAction: "send_original",
  ...overrides,
});

const assessment = (
  overrides: Partial<TransformationAssessment> = {},
): TransformationAssessment => ({
  policyVersion: "quality-policy-v1",
  outcome: "accept",
  reasons: [],
  observedConfidence: 0.9,
  ...overrides,
});

const sensitive = (value: string): string =>
  `${["api", "key"].join("_")}=${value}`;

const transformation = (
  overrides: Partial<FullInMemoryTransformation> = {},
): FullInMemoryTransformation => ({
  originalText: "Profil sayfasındaki düzeni düzeltin.",
  intent: intent(),
  compiledTask: {
    compilerVersion: "pi-v2",
    text: "[INTENT BRIDGE TASK — v1]\n\ncompiled task",
    responseLanguageCode: "tr",
  },
  quality: {
    schemaValid: true,
    languagePresent: true,
    taskCount: 1,
    hasGoal: true,
    constraintsSeparated: true,
    assumptionsSeparated: true,
    ambiguitiesTyped: true,
    compilerValid: true,
    providerConfidence: 0.9,
  },
  assessment: assessment(),
  qualityConfig: qualityConfig(),
  traceId: "trace-1",
  timestamp: "2026-07-19T12:00:00.000Z",
  ...overrides,
});

describe("preview formatting", () => {
  it("renders every required field, stays under the cap, and preserves secret redaction", () => {
    const text = formatTransformation(
      transformation({
        originalText: `${sensitive("SENTINEL_SECRET_VALUE")} please`,
        intent: intent({
          risk: { level: "high", reasons: ["x"] },
          clarification: {
            recommended: true,
            reason: `${sensitive("SENTINEL_SECRET_VALUE")} reason`,
          },
          ambiguities: [
            {
              description: `billing needs ${sensitive("SENTINEL_SECRET_VALUE")} too`,
              material: true,
              preferredResolution: "ask_user",
            },
          ],
        }),
        assessment: assessment({
          outcome: "review",
          reasons: [
            "high_risk",
            "clarification_recommended",
            "material_ambiguity_requires_user",
          ],
        }),
        qualityConfig: qualityConfig({ enforcement: "review" }),
      }),
    );
    expect(text.length).toBeLessThanOrEqual(5000);
    expect(text).toContain("## Quality assessment");
    expect(text).toContain("Outcome: review");
    expect(text).toContain("Observed confidence");
    expect(text).toContain("Decision reasons");
    expect(text).toContain("Enforcement: review");
    expect(text).toContain("## Risk");
    expect(text).toContain("## Clarification");
    expect(text).toContain("## Material ask_user ambiguities");
    expect(text).not.toContain("SENTINEL_SECRET_VALUE");
  });

  it("preserves the secret redaction for /bridge last formatting", () => {
    const text = formatLastTransformation(
      transformation({ originalText: sensitive("SENTINEL_SECRET_LAST") }),
      "Status: transformed; provider=local; model=m",
    );
    expect(text.length).toBeLessThanOrEqual(5000);
    expect(text).toContain("Original request");
    expect(text).toContain("## Quality assessment");
    expect(text).not.toContain("SENTINEL_SECRET_LAST");
  });

  it("truncates long bounded reason lists and caps the output", () => {
    const longReasons = Array.from(
      { length: 50 },
      (_, index) => `long reason ${index} — SENTINEL_${index}`,
    );
    const longAmbiguityDescriptions = Array.from(
      { length: 50 },
      (_, index) =>
        `SENTINEL_AMBIG_${index}: very long ask_user material ambiguity ${index}`,
    );
    const text = formatTransformation(
      transformation({
        intent: intent({
          risk: { level: "high", reasons: longReasons },
          ambiguities: longAmbiguityDescriptions.map((description) => ({
            description,
            material: true,
            preferredResolution: "ask_user" as const,
          })),
        }),
      }),
    );
    expect(text.length).toBeLessThanOrEqual(5000);
    expect(text).toContain("[truncated]");
    expect(text).not.toContain("SENTINEL_49");
    expect(redactSecrets(text).count).toBe(0);
  });

  it("redacts with current helpers and preserves existing caps", () => {
    const text = formatTransformation(
      transformation({
        intent: intent({
          globalConstraints: [sensitive("abcdefghijklmnopqrstuvwxyz")],
        }),
      }),
    );
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(text.length).toBeLessThanOrEqual(5000);
  });

  it("redacts base64-like assessment prose while preserving decision reasons", () => {
    const encodedValue = "VGhpcy1iYXNlNjQtbGlrZS1zZWNyZXQtaXMtbG9uZy1lbm91Z2g";
    const text = formatTransformation(
      transformation({
        intent: intent({
          risk: { level: "high", reasons: [`risk ${encodedValue}`] },
          clarification: {
            recommended: true,
            reason: `clarification ${encodedValue}`,
          },
          ambiguities: [
            {
              description: `ambiguity ${encodedValue}`,
              material: true,
              preferredResolution: "ask_user",
            },
          ],
        }),
        assessment: assessment({
          outcome: "review",
          reasons: [
            "material_ambiguity_requires_user",
            "confidence_below_threshold",
          ],
        }),
      }),
    );
    expect(text).not.toContain(encodedValue);
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("material_ambiguity_requires_user");
    expect(text).toContain("confidence_below_threshold");
  });
});
