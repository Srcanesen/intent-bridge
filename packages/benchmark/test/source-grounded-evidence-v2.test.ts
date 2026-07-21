import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSourceGroundedEvidenceAggregateResultV2,
  parseSourceGroundedEvidenceManifestV2,
  sha256SourceGroundedCanonical,
  sha256SourceGroundedFileBytes,
  SOURCE_GROUNDED_EVIDENCE_V2_MANIFEST_SHA256,
  validateSourceGroundedEvidenceV2Corpus,
} from "../src/index.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const v1 = join(root, "benchmarks", "source-grounded-evidence-v1");
const v2 = join(root, "benchmarks", "source-grounded-evidence-v2");
const json = async (path: string) =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
const gates = [
  "smoke",
  "confirmatory",
  "structural",
  "languagePreservation",
  "deterministicSafety",
  "evidenceCoverage",
  "forbiddenAdditions",
  "interpreterLeakage",
  "scopeExpansion",
  "methodMandate",
  "materialIntentAlteration",
  "informalClearer",
  "informalLessClear",
  "ambiguityHandling",
  "smokeAmbiguityExact",
  "escalation",
];
const zeroGate = new Set([
  "forbiddenAdditions",
  "interpreterLeakage",
  "scopeExpansion",
  "methodMandate",
  "materialIntentAlteration",
  "informalLessClear",
  "escalation",
]);
const pass = () => ({
  schemaVersion: 1,
  benchmarkId: "source-grounded-evidence-v2",
  subjectRelease: "v1.2.0-rc",
  subjectCommit: "acb8f60e5f2a0e6297c0f1bc01853b0b5ee12294",
  manifestSha256: SOURCE_GROUNDED_EVIDENCE_V2_MANIFEST_SHA256,
  sourceReportV2Sha256s: ["a".repeat(64), "b".repeat(64)],
  prompts: { pi: "pi-native-v5", openaiCompatible: "openai-compatible-v4" },
  candidate: {
    provider: "opencode-go",
    runtimeProviderAlias: "opencode-go-gateway",
    model: "deepseek-v4-flash",
  },
  evaluator: {
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    reasoning: "medium",
    promptVersion: "pi-benchmark-evaluator-v4",
  },
  corpus: {
    confirmatorySha256:
      "d25bb4bf705923dcfc698279ade9ebf0fac07dc9783f87467940f5c0502c3d55",
    smokeCasesSha256:
      "f0ef68b6fb49eb7641af1d088ecc79e68905ed70589aef671804b5772ce8eba6",
    smokeAnnotationsSha256:
      "ae6466edeec01c65b638f4d1379b9449a867b703c94b7132d384dde0273126f9",
  },
  sandboxPolicyHash: "c".repeat(64),
  calls: { total: 176, candidate: 88, evaluator: 88 },
  cost: { providerMeteredUsd: 1 },
  gates: gates.map((gate) => ({
    gate,
    rate: zeroGate.has(gate) ? 0 : 1,
    numerator: zeroGate.has(gate) ? 0 : 8,
    denominator: 8,
    status: "pass" as const,
  })),
  humanReview: {
    language: "tr",
    smokeReviewedCount: 8,
    confirmatoryFlaggedReviewed: 0,
    confirmatoryFlaggedTotal: 0,
    confirmatoryUnflaggedSampled: 16,
    confirmatoryUnflaggedReclassified: 0,
    confirmatoryExpandedToAll: false,
    approvalStatus: "approved",
  },
  decision: "pass",
  limitations: ["Dış sandbox kanıtı özetle sınırlıdır."],
});

describe("source-grounded-evidence-v2 frozen preregistration", () => {
  it("accepts the exact manifest, exact file hash, and referenced v1 corpus", async () => {
    const bytes = await readFile(join(v2, "manifest.json"));
    const manifest = parseSourceGroundedEvidenceManifestV2(
      JSON.parse(bytes.toString()),
    );
    expect(manifest.subjectCommit).toBe(
      "acb8f60e5f2a0e6297c0f1bc01853b0b5ee12294",
    );
    expect(sha256SourceGroundedFileBytes(bytes)).toBe(
      SOURCE_GROUNDED_EVIDENCE_V2_MANIFEST_SHA256,
    );
    const cases = await json(join(v1, "cases.json"));
    const annotations = await json(join(v1, "annotations.json"));
    expect(
      validateSourceGroundedEvidenceV2Corpus(cases, annotations).cases,
    ).toHaveLength(8);
    expect(sha256SourceGroundedCanonical(cases)).toBe(
      "f0ef68b6fb49eb7641af1d088ecc79e68905ed70589aef671804b5772ce8eba6",
    );
    expect(sha256SourceGroundedCanonical(annotations)).toBe(
      "ae6466edeec01c65b638f4d1379b9449a867b703c94b7132d384dde0273126f9",
    );
  });

  it("rejects manifest identity, prompt, cap, gates, review, and unknown-key drift", async () => {
    const manifest = await json(join(v2, "manifest.json"));
    for (const changed of [
      { ...manifest, benchmarkId: "source-grounded-evidence-v1" },
      { ...manifest, subjectCommit: "0".repeat(40) },
      {
        ...manifest,
        prompts: {
          ...(manifest.prompts as Record<string, unknown>),
          pi: "pi-native-v4",
        },
      },
      {
        ...manifest,
        inferenceCap: { totalCalls: 175, providerMeteredCostUsd: 1 },
      },
      {
        ...manifest,
        gates: {
          ...(manifest.gates as Record<string, unknown>),
          evidenceCoverage: 0.9,
        },
      },
      {
        ...manifest,
        reviewPolicy: {
          ...(manifest.reviewPolicy as Record<string, unknown>),
          language: "en",
        },
      },
      { ...manifest, extra: true },
    ])
      expect(() => parseSourceGroundedEvidenceManifestV2(changed)).toThrow();
  });

  it("accepts stopped smoke and approved pass aggregates", () => {
    const valid = pass();
    expect(parseSourceGroundedEvidenceAggregateResultV2(valid).decision).toBe(
      "pass",
    );
    const stopped = {
      ...valid,
      sourceReportV2Sha256s: ["a".repeat(64)],
      evaluator: null,
      calls: { total: 16, candidate: 8, evaluator: 8 },
      cost: { providerMeteredUsd: 0.1 },
      gates: valid.gates.map((gate) =>
        gate.gate === "smoke"
          ? { ...gate, rate: 0.875, numerator: 7, status: "fail" as const }
          : {
              ...gate,
              rate: null,
              numerator: 0,
              denominator: 0,
              status: "unavailable" as const,
            },
      ),
      humanReview: {
        ...valid.humanReview,
        confirmatoryFlaggedReviewed: 0,
        confirmatoryFlaggedTotal: 0,
        confirmatoryUnflaggedSampled: 0,
        approvalStatus: "pending",
      },
      decision: "stop",
    };
    expect(parseSourceGroundedEvidenceAggregateResultV2(stopped).decision).toBe(
      "stop",
    );
  });

  it("rejects identity, manifest, raw, cap, gate, review, and approval drift", () => {
    const valid = pass();
    for (const changed of [
      { ...valid, benchmarkId: "wrong" },
      { ...valid, subjectCommit: "0".repeat(40) },
      { ...valid, prompts: { ...valid.prompts, pi: "pi-native-v4" } },
      { ...valid, manifestSha256: "d".repeat(64) },
      { ...valid, limitations: [{ evidence: "raw" }] },
      { ...valid, calls: { total: 177, candidate: 89, evaluator: 88 } },
      {
        ...valid,
        gates: valid.gates.filter((gate) => gate.gate !== "evidenceCoverage"),
      },
      {
        ...valid,
        humanReview: { ...valid.humanReview, confirmatoryUnflaggedSampled: 15 },
      },
      {
        ...valid,
        humanReview: { ...valid.humanReview, approvalStatus: "pending" },
      },
    ])
      expect(() =>
        parseSourceGroundedEvidenceAggregateResultV2(changed),
      ).toThrow();
  });
});
