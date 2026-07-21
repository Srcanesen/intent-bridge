import { describe, expect, it } from "vitest";

import {
  INTENT_EVIDENCE_LIMITS,
  type IntentDocumentV1,
  type IntentEvidenceV1,
  parseIntentEvidence,
} from "../src/index.js";

const intent: IntentDocumentV1 = {
  schemaVersion: "1",
  sourceLanguage: { code: "en", confidence: 1 },
  responseLanguage: { code: "en" },
  messageType: "initial",
  goal: "Ship profile and billing.",
  tasks: [
    {
      id: "profile",
      objective: "Fix profile.",
      scope: ["profile.ts"],
      constraints: ["Keep API."],
      successCriteria: ["Profile tests pass."],
    },
    {
      id: "billing",
      objective: "Update billing.",
      scope: ["billing.ts"],
      constraints: ["No dependencies."],
      successCriteria: ["Billing tests pass."],
    },
  ],
  globalConstraints: ["Preserve auth."],
  assumptions: [],
  ambiguities: [],
  risk: { level: "low", reasons: [] },
  confidence: 1,
  clarification: { recommended: false },
};

const sources = {
  originalText:
    "Ship profile and billing. Fix profile. Keep API. Billing tests pass.",
  project: {
    summary: "Update billing. profile.ts No dependencies.",
    instructionExcerpts: ["Profile tests pass. Preserve auth.", "billing.ts"],
  },
};

const validEvidence = (): IntentEvidenceV1 => ({
  version: 1,
  items: [
    { path: "/goal", source: "user_original", quote: "Ship profile" },
    {
      path: "/tasks/0/objective",
      source: "user_original",
      quote: "Fix profile.",
    },
    {
      path: "/tasks/0/scope/0",
      source: "project_summary",
      quote: "profile.ts",
    },
    {
      path: "/tasks/0/constraints/0",
      source: "user_original",
      quote: "Keep API.",
    },
    {
      path: "/tasks/0/successCriteria/0",
      source: "project_instruction",
      quote: "Profile tests pass.",
      instructionIndex: 0,
    },
    {
      path: "/tasks/1/objective",
      source: "project_summary",
      quote: "Update billing.",
    },
    {
      path: "/tasks/1/scope/0",
      source: "project_instruction",
      quote: "billing.ts",
      instructionIndex: 1,
    },
    {
      path: "/tasks/1/constraints/0",
      source: "project_summary",
      quote: "No dependencies.",
    },
    {
      path: "/tasks/1/successCriteria/0",
      source: "user_original",
      quote: "Billing tests pass.",
    },
    {
      path: "/globalConstraints/0",
      source: "project_instruction",
      quote: "Preserve auth.",
      instructionIndex: 0,
    },
  ],
});

function expectInvalid(evidence: unknown) {
  expect(() => parseIntentEvidence(evidence, intent, sources)).toThrowError(
    expect.objectContaining({
      code: "INTENT_SCHEMA_INVALID",
      retryable: false,
    }),
  );
}

function itemAt(evidence: IntentEvidenceV1, index: number) {
  const item = evidence.items[index];
  if (!item) throw new Error(`Missing evidence item ${index}`);
  return item;
}

describe("parseIntentEvidence", () => {
  it("accepts complete evidence across multiple tasks and all source kinds", () => {
    const evidence = validEvidence();
    expect(parseIntentEvidence(evidence, intent, sources)).toEqual(evidence);
  });

  it("rejects unknown keys", () => {
    expectInvalid({ ...validEvidence(), unknown: true });
    const evidence = validEvidence();
    expectInvalid({
      ...evidence,
      items: [
        { ...evidence.items[0], unknown: true },
        ...evidence.items.slice(1),
      ],
    });
  });

  it("rejects duplicate, extra, and missing paths", () => {
    const duplicate = validEvidence();
    duplicate.items[1] = { ...itemAt(duplicate, 0) };
    expectInvalid(duplicate);

    const extra = validEvidence();
    extra.items[0] = { ...itemAt(extra, 0), path: "/assumptions/0" };
    expectInvalid(extra);

    const missing = validEvidence();
    missing.items.pop();
    expectInvalid(missing);
  });

  it("rejects a quote not found byte-for-byte in its selected source", () => {
    const evidence = validEvidence();
    evidence.items[0] = { ...itemAt(evidence, 0), quote: "ship profile" };
    expectInvalid(evidence);
  });

  it("rejects invalid project instruction indexes and source/index mismatches", () => {
    const outOfRange = validEvidence();
    outOfRange.items[4] = {
      ...itemAt(outOfRange, 4),
      instructionIndex: 2,
    };
    expectInvalid(outOfRange);

    const missingIndex = validEvidence();
    const { instructionIndex: _, ...withoutIndex } = itemAt(missingIndex, 4);
    missingIndex.items[4] = withoutIndex;
    expectInvalid(missingIndex);

    const forbiddenIndex = validEvidence();
    forbiddenIndex.items[0] = {
      ...itemAt(forbiddenIndex, 0),
      instructionIndex: 0,
    };
    expectInvalid(forbiddenIndex);
  });

  it.each([
    ["empty quote", (e: IntentEvidenceV1) => (itemAt(e, 0).quote = "")],
    [
      "oversized quote",
      (e: IntentEvidenceV1) =>
        (itemAt(e, 0).quote = "x".repeat(
          INTENT_EVIDENCE_LIMITS.quoteLength + 1,
        )),
    ],
    ["empty path", (e: IntentEvidenceV1) => (itemAt(e, 0).path = "")],
    [
      "oversized path",
      (e: IntentEvidenceV1) =>
        (itemAt(e, 0).path = "x".repeat(INTENT_EVIDENCE_LIMITS.pathLength + 1)),
    ],
  ])("rejects %s", (_, mutate) => {
    const evidence = validEvidence();
    mutate(evidence);
    expectInvalid(evidence);
  });
});
