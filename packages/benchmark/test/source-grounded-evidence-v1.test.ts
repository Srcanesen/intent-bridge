import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseSourceGroundedEvidenceAggregateResultV1,
  parseSourceGroundedEvidenceManifestV1,
  sha256SourceGroundedCanonical,
  sha256SourceGroundedFileBytes,
  SOURCE_GROUNDED_EVIDENCE_MANIFEST_SHA256,
  validateSourceGroundedEvidenceCorpus,
} from "../src/index.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const directory = join(root, "benchmarks", "source-grounded-evidence-v1");
const json = async (name: string) =>
  JSON.parse(await readFile(join(directory, name), "utf8")) as unknown;
const gateNames = [
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
const passGate = (gate: string) => ({
  gate,
  rate: [
    "forbiddenAdditions",
    "interpreterLeakage",
    "scopeExpansion",
    "methodMandate",
    "materialIntentAlteration",
    "informalLessClear",
    "escalation",
  ].includes(gate)
    ? 0
    : 1,
  numerator: [
    "forbiddenAdditions",
    "interpreterLeakage",
    "scopeExpansion",
    "methodMandate",
    "materialIntentAlteration",
    "informalLessClear",
    "escalation",
  ].includes(gate)
    ? 0
    : 8,
  denominator: 8,
  status: "pass" as const,
});
const pass = () => ({
  schemaVersion: 1,
  benchmarkId: "source-grounded-evidence-v1",
  subjectRelease: "v1.2.0-rc",
  subjectCommit: "9d54bb4a8ba6a9cc63c0776023d5856c46199697",
  manifestSha256: SOURCE_GROUNDED_EVIDENCE_MANIFEST_SHA256,
  sourceReportV2Sha256s: ["a".repeat(64), "b".repeat(64)],
  prompts: { pi: "pi-native-v4", openaiCompatible: "openai-compatible-v4" },
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
  gates: gateNames.map(passGate),
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

describe("source-grounded-evidence-v1 frozen corpus", () => {
  it("freezes all eight semantic expectations and canonical hashes", async () => {
    const cases = await json("cases.json");
    const annotations = await json("annotations.json");
    const parsed = validateSourceGroundedEvidenceCorpus(cases, annotations);
    expect(parsed.cases).toHaveLength(8);
    expect(parsed.annotations).toHaveLength(8);
    expect(parsed.cases.filter((item) => item.language === "tr")).toHaveLength(
      4,
    );
    expect(parsed.cases.filter((item) => item.language === "en")).toHaveLength(
      4,
    );
    expect(
      parsed.annotations.map((item) => [
        item.classification,
        item.noCodeConstraint,
        item.materialAmbiguity,
        item.askUser,
      ]),
    ).toEqual([
      ["explicit-negative", true, false, false],
      ["nominal-action", false, false, false],
      ["bare-ambiguity", false, true, true],
      ["quoted-non-instruction", false, false, false],
      ["explicit-negative", true, false, false],
      ["nominal-action", false, false, false],
      ["quoted-non-instruction", false, false, false],
      ["bounded-safe-display", false, false, false],
    ]);
    expect(sha256SourceGroundedCanonical(cases)).toBe(
      "f0ef68b6fb49eb7641af1d088ecc79e68905ed70589aef671804b5772ce8eba6",
    );
    expect(sha256SourceGroundedCanonical(annotations)).toBe(
      "ae6466edeec01c65b638f4d1379b9449a867b703c94b7132d384dde0273126f9",
    );
  });

  it("rejects corpus annotation drift", async () => {
    const cases = await json("cases.json");
    const annotations = (await json("annotations.json")) as Array<
      Record<string, unknown>
    >;
    annotations[2] = { ...annotations[2], askUser: false };
    expect(() =>
      validateSourceGroundedEvidenceCorpus(cases, annotations),
    ).toThrow("SGE_PARSE_FAILED:corpus:annotationsSha256");
  });
});

describe("source-grounded-evidence-v1 strict contracts", () => {
  it("accepts the exact manifest and prints its exact-byte identity", async () => {
    const bytes = await readFile(join(directory, "manifest.json"));
    expect(
      parseSourceGroundedEvidenceManifestV1(JSON.parse(bytes.toString("utf8")))
        .subjectCommit,
    ).toBe("9d54bb4a8ba6a9cc63c0776023d5856c46199697");
    expect(sha256SourceGroundedFileBytes(bytes)).toBe(
      SOURCE_GROUNDED_EVIDENCE_MANIFEST_SHA256,
    );
  });

  it("rejects manifest identity, cap, review, and unknown-key drift", async () => {
    const manifest = (await json("manifest.json")) as Record<string, unknown>;
    for (const changed of [
      { ...manifest, subjectCommit: "0".repeat(40) },
      {
        ...manifest,
        inferenceCap: { totalCalls: 175, providerMeteredCostUsd: 1 },
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
      expect(() => parseSourceGroundedEvidenceManifestV1(changed)).toThrow(
        "SGE_PARSE_FAILED",
      );
  });

  it("accepts stopped smoke and valid pass aggregates", () => {
    const valid = pass();
    expect(parseSourceGroundedEvidenceAggregateResultV1(valid).decision).toBe(
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
        smokeReviewedCount: 8,
        confirmatoryFlaggedReviewed: 0,
        confirmatoryFlaggedTotal: 0,
        confirmatoryUnflaggedSampled: 0,
        approvalStatus: "pending",
      },
      decision: "stop",
    };
    expect(parseSourceGroundedEvidenceAggregateResultV1(stopped).decision).toBe(
      "stop",
    );
  });

  it("rejects evidence, approval, review, identity, cap, gate, and nested-raw drift", () => {
    const valid = pass();
    const invalid = [
      {
        ...valid,
        gates: valid.gates.filter((gate) => gate.gate !== "evidenceCoverage"),
      },
      {
        ...valid,
        humanReview: { ...valid.humanReview, approvalStatus: "pending" },
      },
      {
        ...valid,
        humanReview: { ...valid.humanReview, confirmatoryUnflaggedSampled: 15 },
      },
      {
        ...valid,
        humanReview: {
          ...valid.humanReview,
          confirmatoryUnflaggedReclassified: 1,
          confirmatoryExpandedToAll: true,
        },
      },
      {
        ...valid,
        candidate: { ...valid.candidate, runtimeProviderAlias: "opencode-go" },
      },
      { ...valid, prompts: { ...valid.prompts, pi: "pi-native-v3" } },
      {
        ...valid,
        corpus: { ...valid.corpus, smokeCasesSha256: "d".repeat(64) },
      },
      { ...valid, calls: { total: 177, candidate: 89, evaluator: 88 } },
      { ...valid, gates: [...valid.gates, valid.gates[0]] },
      {
        ...valid,
        gates: [
          { ...valid.gates[0], gate: "unknown" },
          ...valid.gates.slice(1),
        ],
      },
      { ...valid, limitations: [{ evidence: "raw" }] },
    ];
    for (const result of invalid)
      expect(() =>
        parseSourceGroundedEvidenceAggregateResultV1(result),
      ).toThrow("SGE_PARSE_FAILED");
  });
});
