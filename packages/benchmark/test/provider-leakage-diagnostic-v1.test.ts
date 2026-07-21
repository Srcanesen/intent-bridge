import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseProviderLeakageManifestV1,
  parseProviderLeakageAggregateResultV1,
  sha256Canonical,
  sha256FileBytes,
  type ProviderLeakageManifestV1,
  type ProviderLeakageAggregateResultV1,
} from "../src/index.js";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
const manifestPath = join(
  projectRoot,
  "benchmarks",
  "provider-leakage-diagnostic-v1",
  "manifest.json",
);

// ── Valid fixtures ──────────────────────────────────────────────────────────
const validManifest = (): ProviderLeakageManifestV1 => ({
  schemaVersion: 1,
  benchmarkId: "provider-leakage-diagnostic-v1",
  subjectRelease: "v1.1.1-rc",
  subjectCommit: "766ed0e38049e8cd477f4a3d596fe6486d89a74f",
  seed: 42,
  languages: ["tr", "en"],
  strata: ["informal", "clear", "ambiguity", "edge-safety"],
  totalConfirmatory: 80,
  totalSmoke: 8,
  distribution: {
    tr: { informal: 24, clear: 6, ambiguity: 6, "edge-safety": 4, total: 40 },
    en: { informal: 24, clear: 6, ambiguity: 6, "edge-safety": 4, total: 40 },
  },
  smokeDistribution: {
    tr: { informal: 1, clear: 1, ambiguity: 1, "edge-safety": 1, total: 4 },
    en: { informal: 1, clear: 1, ambiguity: 1, "edge-safety": 1, total: 4 },
  },
  contentSha256:
    "d25bb4bf705923dcfc698279ade9ebf0fac07dc9783f87467940f5c0502c3d55",
  smokeContentSha256:
    "e82b418efdab66212a9fc0e9a9e7810c4ec495e653274d92e80b73fb4e3cdda6",
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
  sandbox: {
    type: "externally-enforced",
    sourceReadOnly: true,
    homeCredentialMount: false,
    network: "deny-except-bounded-loopback-gateways",
    concurrency: 1,
    retries: 0,
  },
  inferenceCap: { totalCalls: 176, providerMeteredCostUsd: 1.0 },
  gates: {
    languagePreservation: 1.0,
    deterministicSafety: 1.0,
    materialIntentAlterationMaxRate: 0.05,
    informalClearerMinRate: 0.8,
    informalLessClearMaxRate: 0.05,
    ambiguityHandlingMinRate: 0.9,
  },
  reviewPolicy: {
    language: "tr",
    smokeReviewAll: true,
    confirmatoryReviewEvaluatorFlagged: true,
    confirmatoryReviewTechnicalAuditFlagged: true,
    confirmatoryStratifiedUnflaggedSampleSize: 16,
    escalateToFullOnReclassifiedUnflagged: true,
    rawBundleMode: "0600",
    rawBundleNeverCommitted: true,
    rawBundleDeleteAfterReview: true,
    commitAggregateOnly: true,
    forbiddenRawContentKeys: [
      "prompt",
      "input",
      "originalText",
      "intent",
      "compiledTask",
      "caseIds",
      "caseTitles",
      "credentials",
      "providerErrorBodies",
    ],
    requireApprovalBeforeRelease: true,
    separateProviderModelCostApprovalRequired: true,
  },
});

const validAggregateResult = (): ProviderLeakageAggregateResultV1 => ({
  schemaVersion: 1,
  benchmarkId: "provider-leakage-diagnostic-v1",
  subjectCommit: "766ed0e38049e8cd477f4a3d596fe6486d89a74f",
  subjectRelease: "v1.1.1-rc",
  manifestSha256:
    "72c79f69d0e293ccca59b03aa5047be800a16300c9c753ad0532e48da58eceed",
  sourceReportV2Sha256s: ["b".repeat(64), "c".repeat(64)],
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
    smokeSha256:
      "e82b418efdab66212a9fc0e9a9e7810c4ec495e653274d92e80b73fb4e3cdda6",
  },
  sandboxPolicyHash: "a".repeat(64),
  calls: { total: 176, candidate: 88, evaluator: 88 },
  cost: { providerMeteredUsd: 1.0 },
  gates: [
    { gate: "smoke", rate: 1, numerator: 8, denominator: 8 },
    { gate: "confirmatory", rate: 1, numerator: 80, denominator: 80 },
    { gate: "structural", rate: 1, numerator: 80, denominator: 80 },
    { gate: "languagePreservation", rate: 1, numerator: 80, denominator: 80 },
    { gate: "deterministicSafety", rate: 1, numerator: 80, denominator: 80 },
    { gate: "evaluatorCoverage", rate: 1, numerator: 80, denominator: 80 },
    { gate: "forbiddenAdditions", rate: 0, numerator: 0, denominator: 80 },
    { gate: "interpreterLeakage", rate: 0, numerator: 0, denominator: 80 },
    { gate: "scopeExpansion", rate: 0, numerator: 0, denominator: 80 },
    {
      gate: "materialIntentAlteration",
      rate: 0,
      numerator: 0,
      denominator: 80,
    },
    { gate: "informalClearer", rate: 1, numerator: 48, denominator: 48 },
    { gate: "informalLessClear", rate: 0, numerator: 0, denominator: 48 },
    { gate: "ambiguityHandling", rate: 1, numerator: 12, denominator: 12 },
    { gate: "escalation", rate: 0, numerator: 0, denominator: 80 },
  ].map((gate) => ({ ...gate, status: "pass" as const })),
  humanReview: {
    language: "tr",
    smokeReviewedAll: true,
    smokeReviewedCount: 8,
    confirmatoryFlaggedReviewed: 5,
    confirmatoryFlaggedTotal: 5,
    confirmatoryUnflaggedSampled: 16,
    confirmatoryUnflaggedReclassified: 0,
    confirmatoryExpandedToAll: false,
    approvalStatus: "approved",
  },
  decision: "pass",
  limitations: ["Live execution externally sandboxed"],
});

const validStoppedSmokeResult = (): ProviderLeakageAggregateResultV1 => {
  const result = validAggregateResult();
  return {
    ...result,
    sourceReportV2Sha256s: [result.sourceReportV2Sha256s[0]],
    calls: { total: 16, candidate: 8, evaluator: 8 },
    cost: { providerMeteredUsd: 0.1 },
    gates: result.gates.map((gate) =>
      gate.gate === "smoke"
        ? { ...gate, rate: 0.875, numerator: 7, denominator: 8, status: "fail" }
        : {
            ...gate,
            rate: null,
            numerator: 0,
            denominator: 0,
            status: "unavailable",
          },
    ),
    humanReview: {
      ...result.humanReview,
      confirmatoryFlaggedReviewed: 0,
      confirmatoryFlaggedTotal: 0,
      confirmatoryUnflaggedSampled: 0,
      approvalStatus: "pending",
    },
    decision: "stop",
  };
};

// ── Manifest tests ──────────────────────────────────────────────────────────
describe("PLV manifest strict parser", () => {
  it("parses the canonical manifest file from disk", async () => {
    const content = JSON.parse(await readFile(manifestPath, "utf8"));
    const parsed = parseProviderLeakageManifestV1(content);
    expect(parsed.benchmarkId).toBe("provider-leakage-diagnostic-v1");
    expect(parsed.subjectCommit).toBe(
      "766ed0e38049e8cd477f4a3d596fe6486d89a74f",
    );
    expect(parsed.candidate.provider).toBe("opencode-go");
    expect(parsed.candidate.runtimeProviderAlias).toBe("opencode-go-gateway");
    expect(parsed.evaluator.reasoning).toBe("medium");
    expect(parsed.reviewPolicy.language).toBe("tr");
    expect(parsed.reviewPolicy.confirmatoryStratifiedUnflaggedSampleSize).toBe(
      16,
    );
  });

  it("accepts a valid programmatic manifest", () => {
    const parsed = parseProviderLeakageManifestV1(validManifest());
    expect(parsed.seed).toBe(42);
    expect(parsed.totalConfirmatory).toBe(80);
  });

  it("rejects unknown keys at top level", () => {
    expect(() =>
      parseProviderLeakageManifestV1({ ...validManifest(), extraKey: true }),
    ).toThrow("PLV_PARSE_FAILED:unknown-key:extraKey");
  });

  it("rejects wrong benchmarkId", () => {
    expect(() =>
      parseProviderLeakageManifestV1({
        ...validManifest(),
        benchmarkId: "wrong-id",
      }),
    ).toThrow("PLV_PARSE_FAILED:manifest:benchmarkId");
  });

  it("rejects wrong subject commit or future release", () => {
    for (const manifest of [
      { ...validManifest(), subjectRelease: "v1.1.0" },
      {
        ...validManifest(),
        subjectCommit: "0000000000000000000000000000000000000000",
      },
    ])
      expect(() => parseProviderLeakageManifestV1(manifest)).toThrow(
        "PLV_PARSE_FAILED",
      );
  });

  it("rejects wrong totalConfirmatory", () => {
    expect(() =>
      parseProviderLeakageManifestV1({
        ...validManifest(),
        totalConfirmatory: 81,
      }),
    ).toThrow("PLV_PARSE_FAILED:manifest:totalConfirmatory");
  });

  it("rejects wrong candidate upstream provider or runtime alias", () => {
    for (const candidate of [
      { ...validManifest().candidate, provider: "other" },
      { ...validManifest().candidate, runtimeProviderAlias: "opencode-go" },
    ])
      expect(() =>
        parseProviderLeakageManifestV1({ ...validManifest(), candidate }),
      ).toThrow("PLV_PARSE_FAILED:manifest:candidate-");
  });

  it("rejects wrong evaluator model", () => {
    expect(() =>
      parseProviderLeakageManifestV1({
        ...validManifest(),
        evaluator: {
          ...validManifest().evaluator,
          model: "wrong-model",
        },
      }),
    ).toThrow("PLV_PARSE_FAILED:manifest:evaluator-model");
  });

  it("rejects wrong evaluator reasoning", () => {
    expect(() =>
      parseProviderLeakageManifestV1({
        ...validManifest(),
        evaluator: {
          ...validManifest().evaluator,
          reasoning: "high",
        },
      }),
    ).toThrow("PLV_PARSE_FAILED:manifest:evaluator-reasoning");
  });

  it("rejects wrong evaluator promptVersion", () => {
    expect(() =>
      parseProviderLeakageManifestV1({
        ...validManifest(),
        evaluator: {
          ...validManifest().evaluator,
          promptVersion: "pi-benchmark-evaluator-v3",
        },
      }),
    ).toThrow("PLV_PARSE_FAILED:manifest:evaluator-promptVersion");
  });

  it("rejects wrong inferenceCap totalCalls", () => {
    expect(() =>
      parseProviderLeakageManifestV1({
        ...validManifest(),
        inferenceCap: { totalCalls: 100, providerMeteredCostUsd: 1.0 },
      }),
    ).toThrow("PLV_PARSE_FAILED:manifest:inferenceCap-totalCalls");
  });

  it("rejects wrong sandbox concurrency", () => {
    expect(() =>
      parseProviderLeakageManifestV1({
        ...validManifest(),
        sandbox: { ...validManifest().sandbox, concurrency: 2 },
      }),
    ).toThrow("PLV_PARSE_FAILED");
  });

  it("rejects wrong gate values", () => {
    expect(() =>
      parseProviderLeakageManifestV1({
        ...validManifest(),
        gates: { ...validManifest().gates, languagePreservation: 0.9 },
      }),
    ).toThrow("PLV_PARSE_FAILED:manifest:gates-languagePreservation");
  });

  it("rejects wrong review policy language or raw-key policy", () => {
    for (const reviewPolicy of [
      { ...validManifest().reviewPolicy, language: "en" },
      {
        ...validManifest().reviewPolicy,
        forbiddenRawContentKeys: ["input", "prompt"],
      },
    ])
      expect(() =>
        parseProviderLeakageManifestV1({ ...validManifest(), reviewPolicy }),
      ).toThrow("PLV_PARSE_FAILED");
  });

  it("rejects wrong contentSha256 format", () => {
    expect(() =>
      parseProviderLeakageManifestV1({
        ...validManifest(),
        contentSha256: "not-a-hex-string",
      }),
    ).toThrow("PLV_PARSE_FAILED:invalid-hex64");
  });

  it("rejects null values", () => {
    expect(() => parseProviderLeakageManifestV1(null)).toThrow(
      "PLV_PARSE_FAILED",
    );
  });

  it("rejects missing required reviewPolicy fields", () => {
    const { reviewPolicy: _, ...rest } = validManifest();
    expect(() => parseProviderLeakageManifestV1(rest)).toThrow(
      "PLV_PARSE_FAILED",
    );
  });

  // ── SHA-256 canonical helper ────────────────────────────────────────────
  it("hashes canonical values and exact file bytes separately", async () => {
    const obj = { b: 2, a: 1, c: { z: 3, y: 2 } };
    expect(sha256Canonical(obj)).toBe(
      sha256Canonical({ a: 1, b: 2, c: { y: 2, z: 3 } }),
    );
    expect(sha256FileBytes(await readFile(manifestPath))).toBe(
      "72c79f69d0e293ccca59b03aa5047be800a16300c9c753ad0532e48da58eceed",
    );
  });
});

// ── Aggregate result tests ──────────────────────────────────────────────────
describe("PLV aggregate result strict parser", () => {
  it("accepts a valid aggregate result", () => {
    const parsed = parseProviderLeakageAggregateResultV1(
      validAggregateResult(),
    );
    expect(parsed.benchmarkId).toBe("provider-leakage-diagnostic-v1");
    expect(parsed.decision).toBe("pass");
    expect(parsed.humanReview.approvalStatus).toBe("approved");
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        extraKey: true,
      }),
    ).toThrow("PLV_PARSE_FAILED:unknown-key:extraKey");
  });

  it("rejects wrong benchmarkId", () => {
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        benchmarkId: "wrong-id",
      }),
    ).toThrow("PLV_PARSE_FAILED:aggregate:benchmarkId");
  });

  it("rejects wrong subjectCommit", () => {
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        subjectCommit: "0000000000000000000000000000000000000000",
      }),
    ).toThrow("PLV_PARSE_FAILED:aggregate:subjectCommit");
  });

  it("rejects raw-content keys at top level", () => {
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        prompt: "some raw prompt",
      }),
    ).toThrow("PLV_PARSE_FAILED:raw-content-key:prompt");
  });

  it("rejects raw-content keys nested in gates", () => {
    const bad = {
      ...validAggregateResult(),
      gates: [
        ...validAggregateResult().gates,
        {
          gate: "someGate",
          rate: 1.0,
          numerator: 1,
          denominator: 1,
          status: "pass" as const,
          caseIds: ["secret-123"],
        },
      ],
    };
    expect(() => parseProviderLeakageAggregateResultV1(bad)).toThrow(
      "PLV_PARSE_FAILED",
    );
  });

  it("rejects invalid humanReview language", () => {
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        humanReview: { ...validAggregateResult().humanReview, language: "en" },
      }),
    ).toThrow("PLV_PARSE_FAILED:aggregate:humanReview-language");
  });

  it("rejects missing humanReview approvalStatus", () => {
    const { approvalStatus: _, ...hr } = validAggregateResult().humanReview;
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        humanReview: hr,
      }),
    ).toThrow("PLV_PARSE_FAILED");
  });

  it("rejects invalid approvalStatus", () => {
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        humanReview: {
          ...validAggregateResult().humanReview,
          approvalStatus: "unknown",
        },
      }),
    ).toThrow("PLV_PARSE_FAILED:aggregate:humanReview-approvalStatus");
  });

  it("rejects invalid decision value", () => {
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        decision: "invalid",
      }),
    ).toThrow("PLV_PARSE_FAILED:aggregate:decision");
  });

  it("rejects pass decision when approvalStatus is pending", () => {
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        humanReview: {
          ...validAggregateResult().humanReview,
          approvalStatus: "pending",
        },
      }),
    ).toThrow("PLV_PARSE_FAILED:aggregate:pass-humanReview");
  });

  it("accepts a stopped smoke aggregate with one report and no approval", () => {
    for (const approvalStatus of ["pending", "rejected"] as const) {
      const stopped = validStoppedSmokeResult();
      const parsed = parseProviderLeakageAggregateResultV1({
        ...stopped,
        evaluator: null,
        humanReview: { ...stopped.humanReview, approvalStatus },
      });
      expect(parsed.decision).toBe("stop");
      expect(parsed.sourceReportV2Sha256s).toHaveLength(1);
      expect(parsed.evaluator).toBeNull();
    }
  });

  it("accepts any valid runtime sandbox policy SHA-256 and rejects malformed values", () => {
    for (const sandboxPolicyHash of ["1".repeat(64), "f".repeat(64)])
      expect(
        parseProviderLeakageAggregateResultV1({
          ...validAggregateResult(),
          sandboxPolicyHash,
        }).sandboxPolicyHash,
      ).toBe(sandboxPolicyHash);
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        sandboxPolicyHash: "not-a-hash",
      }),
    ).toThrow("PLV_PARSE_FAILED:invalid-hex64");
  });

  it("rejects raw content keys in nested objects recursively", () => {
    const bad = {
      ...validAggregateResult(),
      corpus: {
        confirmatorySha256:
          "d25bb4bf705923dcfc698279ade9ebf0fac07dc9783f87467940f5c0502c3d55",
        smokeSha256:
          "e82b418efdab66212a9fc0e9a9e7810c4ec495e653274d92e80b73fb4e3cdda6",
        originalText: "this should be rejected",
      },
    };
    expect(() => parseProviderLeakageAggregateResultV1(bad)).toThrow(
      "PLV_PARSE_FAILED:raw-content-key:corpus.originalText",
    );
  });

  it("rejects raw keys in nested arrays and objects", () => {
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        gates: [{ input: "raw", ...validAggregateResult().gates[0] }],
      }),
    ).toThrow("PLV_PARSE_FAILED:raw-content-key:gates[0].input");
  });

  it("rejects incomplete no-escalation review and accepts completed full escalation review", () => {
    const valid = validAggregateResult();
    for (const humanReview of [
      { ...valid.humanReview, smokeReviewedCount: 7 },
      { ...valid.humanReview, confirmatoryFlaggedReviewed: 4 },
      { ...valid.humanReview, confirmatoryUnflaggedSampled: 15 },
      {
        ...valid.humanReview,
        confirmatoryFlaggedTotal: 70,
        confirmatoryFlaggedReviewed: 70,
        confirmatoryUnflaggedSampled: 11,
      },
      {
        ...valid.humanReview,
        confirmatoryUnflaggedReclassified: 1,
        confirmatoryExpandedToAll: false,
      },
      {
        ...valid.humanReview,
        confirmatoryUnflaggedSampled: 74,
        confirmatoryUnflaggedReclassified: 1,
        confirmatoryExpandedToAll: true,
      },
    ])
      expect(() =>
        parseProviderLeakageAggregateResultV1({ ...valid, humanReview }),
      ).toThrow("PLV_PARSE_FAILED:aggregate:");

    for (const humanReview of [
      {
        ...valid.humanReview,
        confirmatoryUnflaggedSampled: 75,
        confirmatoryUnflaggedReclassified: 1,
        confirmatoryExpandedToAll: true,
      },
      {
        ...valid.humanReview,
        confirmatoryFlaggedTotal: 70,
        confirmatoryFlaggedReviewed: 70,
        confirmatoryUnflaggedSampled: 10,
      },
    ])
      expect(() =>
        parseProviderLeakageAggregateResultV1({ ...valid, humanReview }),
      ).not.toThrow();
  });

  it("requires exactly all 14 known pass gates with available pass evidence", () => {
    const valid = validAggregateResult();
    expect(valid.gates).toHaveLength(14);
    for (const gate of valid.gates) {
      expect(() =>
        parseProviderLeakageAggregateResultV1({
          ...valid,
          gates: valid.gates.map((entry) =>
            entry.gate === gate.gate
              ? { ...entry, status: "unavailable", rate: null }
              : entry,
          ),
        }),
      ).toThrow(`PLV_PARSE_FAILED:aggregate:gate-${gate.gate}`);
    }
    for (const gates of [
      valid.gates.slice(1),
      [...valid.gates, valid.gates[0]],
      [{ ...valid.gates[0], gate: "unknownGate" }, ...valid.gates.slice(1)],
    ])
      expect(() =>
        parseProviderLeakageAggregateResultV1({ ...valid, gates }),
      ).toThrow("PLV_PARSE_FAILED:aggregate:gate-");
  });

  it("accepts truthful fail and unavailable gates on a non-pass full run", () => {
    const valid = validAggregateResult();
    const parsed = parseProviderLeakageAggregateResultV1({
      ...valid,
      decision: "fail",
      humanReview: { ...valid.humanReview, approvalStatus: "rejected" },
      gates: valid.gates.map((gate) =>
        gate.gate === "structural"
          ? { ...gate, rate: 0.8, numerator: 64, status: "fail" }
          : gate.gate === "evaluatorCoverage"
            ? {
                ...gate,
                rate: null,
                numerator: 0,
                denominator: 0,
                status: "unavailable",
              }
            : gate,
      ),
    });
    expect(parsed.decision).toBe("fail");
  });

  it("rejects impossible or inconsistent gate rates and counts", () => {
    const valid = validAggregateResult();
    const replaceSmoke = (patch: Record<string, unknown>) => ({
      ...valid,
      gates: valid.gates.map((gate) =>
        gate.gate === "smoke" ? { ...gate, ...patch } : gate,
      ),
    });
    for (const result of [
      replaceSmoke({ numerator: 9 }),
      replaceSmoke({ rate: 0.5 }),
      replaceSmoke({ rate: null }),
      replaceSmoke({ denominator: 0, numerator: 0, rate: 0 }),
      replaceSmoke({
        status: "unavailable",
        denominator: 0,
        numerator: 0,
        rate: 0,
      }),
    ])
      expect(() => parseProviderLeakageAggregateResultV1(result)).toThrow(
        "PLV_PARSE_FAILED:aggregate:gate-",
      );
  });

  it("rejects non-pass approval, source evidence/identity drift, and cap overflow", () => {
    const valid = validAggregateResult();
    const cases = [
      { ...valid, decision: "stop" as const },
      { ...valid, subjectRelease: "v1.1.0" },
      { ...valid, sourceReportV2Sha256s: ["b".repeat(64)] },
      {
        ...valid,
        sourceReportV2Sha256s: ["b".repeat(64), "b".repeat(64)],
      },
      { ...valid, candidate: { ...valid.candidate, provider: "other" } },
      { ...valid, candidate: { ...valid.candidate, model: "other" } },
      {
        ...valid,
        candidate: { ...valid.candidate, runtimeProviderAlias: "opencode-go" },
      },
      {
        ...valid,
        evaluator: {
          ...(valid.evaluator ?? {}),
          promptVersion: "v3",
        },
      },
      { ...valid, manifestSha256: "d".repeat(64) },
      { ...valid, calls: { total: 177, candidate: 89, evaluator: 88 } },
      { ...valid, cost: { providerMeteredUsd: 1.01 } },
    ];
    for (const result of cases)
      expect(() => parseProviderLeakageAggregateResultV1(result)).toThrow(
        "PLV_PARSE_FAILED",
      );
  });

  it("rejects invalid hex in manifestSha256", () => {
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        manifestSha256: "not-a-hex-string",
      }),
    ).toThrow("PLV_PARSE_FAILED:invalid-hex64");
  });

  it("rejects invalid hex in sourceReportV2Sha256s", () => {
    expect(() =>
      parseProviderLeakageAggregateResultV1({
        ...validAggregateResult(),
        sourceReportV2Sha256s: ["bad-hash"],
      }),
    ).toThrow("PLV_PARSE_FAILED:invalid-hex64");
  });
});
