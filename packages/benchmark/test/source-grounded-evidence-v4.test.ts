import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSourceGroundedEvidenceAggregateResultV4,
  parseSourceGroundedEvidenceManifestV4,
  sha256SourceGroundedCanonical,
  sha256SourceGroundedFileBytes,
  SOURCE_GROUNDED_EVIDENCE_V4_MANIFEST_SHA256,
  validateSourceGroundedEvidenceV4Corpus,
} from "../src/index.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const v1 = join(root, "benchmarks", "source-grounded-evidence-v1");
const v4 = join(root, "benchmarks", "source-grounded-evidence-v4");
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
  benchmarkId: "source-grounded-evidence-v4",
  subjectRelease: "v1.2.0-rc",
  subjectCommit: "74f8856d0c903562a4a40e9240f8dd92b04b6b56",
  manifestSha256: SOURCE_GROUNDED_EVIDENCE_V4_MANIFEST_SHA256,
  sourceReportV2Sha256s: ["a".repeat(64), "b".repeat(64)],
  prompts: { pi: "pi-native-v6", openaiCompatible: "openai-compatible-v5" },
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

describe("source-grounded-evidence-v4 frozen preregistration", () => {
  it("accepts the exact manifest, exact file hash, and referenced v1 corpus", async () => {
    const bytes = await readFile(join(v4, "manifest.json"));
    const manifest = parseSourceGroundedEvidenceManifestV4(
      JSON.parse(bytes.toString()),
    );
    expect(manifest.subjectCommit).toBe(
      "74f8856d0c903562a4a40e9240f8dd92b04b6b56",
    );
    expect(sha256SourceGroundedFileBytes(bytes)).toBe(
      SOURCE_GROUNDED_EVIDENCE_V4_MANIFEST_SHA256,
    );
    const cases = await json(join(v1, "cases.json"));
    const annotations = await json(join(v1, "annotations.json"));
    expect(
      validateSourceGroundedEvidenceV4Corpus(cases, annotations).cases,
    ).toHaveLength(8);
    expect(sha256SourceGroundedCanonical(cases)).toBe(
      "f0ef68b6fb49eb7641af1d088ecc79e68905ed70589aef671804b5772ce8eba6",
    );
    expect(sha256SourceGroundedCanonical(annotations)).toBe(
      "ae6466edeec01c65b638f4d1379b9449a867b703c94b7132d384dde0273126f9",
    );
  });

  it("rejects manifest identity, prompt, cap, gates, review, and unknown-key drift", async () => {
    const manifest = await json(join(v4, "manifest.json"));
    for (const changed of [
      { ...manifest, benchmarkId: "source-grounded-evidence-v3" },
      { ...manifest, subjectCommit: "0".repeat(40) },
      {
        ...manifest,
        prompts: {
          ...(manifest.prompts as Record<string, unknown>),
          pi: "pi-native-v5",
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
      expect(() => parseSourceGroundedEvidenceManifestV4(changed)).toThrow();
  });

  it("accepts stopped smoke and approved pass aggregates", () => {
    const valid = pass();
    expect(parseSourceGroundedEvidenceAggregateResultV4(valid).decision).toBe(
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
    expect(parseSourceGroundedEvidenceAggregateResultV4(stopped).decision).toBe(
      "stop",
    );
  });

  it("rejects identity, manifest, raw, cap, gate, review, and approval drift", () => {
    const valid = pass();
    for (const changed of [
      { ...valid, benchmarkId: "wrong" },
      { ...valid, subjectCommit: "0".repeat(40) },
      { ...valid, prompts: { ...valid.prompts, pi: "pi-native-v5" } },
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
        parseSourceGroundedEvidenceAggregateResultV4(changed),
      ).toThrow();
  });
});

describe("v3 regressions pass unchanged", () => {
  it("accepts v3 exact manifest and referenced corpus", async () => {
    const { parseSourceGroundedEvidenceManifestV3 } = await import(
      "../src/index.js"
    );
    const bytes = await readFile(
      join(root, "benchmarks", "source-grounded-evidence-v3", "manifest.json"),
    );
    expect(() =>
      parseSourceGroundedEvidenceManifestV3(JSON.parse(bytes.toString())),
    ).not.toThrow();
  });
});

describe("v2 regressions pass unchanged", () => {
  it("accepts v2 exact manifest and referenced corpus", async () => {
    const { parseSourceGroundedEvidenceManifestV2 } = await import(
      "../src/index.js"
    );
    const bytes = await readFile(
      join(root, "benchmarks", "source-grounded-evidence-v2", "manifest.json"),
    );
    expect(() =>
      parseSourceGroundedEvidenceManifestV2(JSON.parse(bytes.toString())),
    ).not.toThrow();
  });
});

describe("v1 regressions pass unchanged", () => {
  it("accepts v1 exact manifest and corpus", async () => {
    const { parseSourceGroundedEvidenceManifestV1 } = await import(
      "../src/index.js"
    );
    const bytes = await readFile(
      join(root, "benchmarks", "source-grounded-evidence-v1", "manifest.json"),
    );
    expect(() =>
      parseSourceGroundedEvidenceManifestV1(JSON.parse(bytes.toString())),
    ).not.toThrow();
  });
});
