import { createHash } from "node:crypto";

import { parseBenchmarkCaseV1, type BenchmarkCaseV1 } from "./contracts.js";

const ID = "source-grounded-evidence-v1";
const COMMIT = "9d54bb4a8ba6a9cc63c0776023d5856c46199697";
const CONFIRMATORY_HASH =
  "d25bb4bf705923dcfc698279ade9ebf0fac07dc9783f87467940f5c0502c3d55";
const SMOKE_HASH =
  "f0ef68b6fb49eb7641af1d088ecc79e68905ed70589aef671804b5772ce8eba6";
const ANNOTATIONS_HASH =
  "ae6466edeec01c65b638f4d1379b9449a867b703c94b7132d384dde0273126f9";
export const SOURCE_GROUNDED_EVIDENCE_MANIFEST_SHA256 =
  "7e9ef1df4ebb8a0e29f6a3353543b19670fe71e06049332a4148de923486c36a";

class SgeError extends Error {
  constructor(reason: string) {
    super(`SGE_PARSE_FAILED:${reason}`);
  }
}
const fail = (reason: string): never => {
  throw new SgeError(reason);
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail("not-object");
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : fail("not-array");
const string = (value: unknown): string =>
  typeof value === "string" && value.length > 0 ? value : fail("not-string");
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= max
    ? value
    : fail("not-integer");
const number = (value: unknown, max = Number.MAX_SAFE_INTEGER): number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max
    ? value
    : fail("not-number");
const bool = (value: unknown): boolean =>
  typeof value === "boolean" ? value : fail("not-boolean");
const hash = (value: unknown): string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
    ? value
    : fail("invalid-hex64");
const strict = (
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> => {
  const result = object(value);
  for (const key of Object.keys(result))
    if (!keys.includes(key)) fail(`unknown-key:${key}`);
  for (const key of keys) if (!(key in result)) fail(`missing-key:${key}`);
  return result;
};
const canonical = (value: unknown): string =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value as Record<string, unknown>)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
          )
          .join(",")}}`;
export const sha256SourceGroundedCanonical = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const sha256SourceGroundedFileBytes = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const rawKeys = new Set([
  "prompt",
  "input",
  "originalText",
  "intent",
  "compiledTask",
  "evidence",
  "quotes",
  "items",
  "caseIds",
  "caseTitles",
  "credentials",
  "providerErrorBodies",
]);
const rejectRaw = (value: unknown, path = ""): void => {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      rejectRaw(item, `${path}[${index}]`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (rawKeys.has(key)) fail(`raw-content-key:${next}`);
    rejectRaw(child, next);
  }
};

const manifestShape = {
  schemaVersion: 1,
  benchmarkId: ID,
  subjectRelease: "v1.2.0-rc",
  subjectCommit: COMMIT,
  confirmatory: {
    count: 80,
    contentSha256: CONFIRMATORY_HASH,
    source: "prompt-transformation-v1",
  },
  smoke: {
    count: 8,
    casesSha256: SMOKE_HASH,
    annotationsSha256: ANNOTATIONS_HASH,
  },
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
  sandbox: {
    type: "externally-enforced",
    sourceReadOnly: true,
    homeCredentialMount: false,
    network: "deny-except-bounded-loopback-gateways",
    concurrency: 1,
    retries: 0,
  },
  inferenceCap: { totalCalls: 176, providerMeteredCostUsd: 1 },
  gates: {
    languagePreservation: 1,
    deterministicSafety: 1,
    materialIntentAlterationMaxRate: 0.05,
    informalClearerMinRate: 0.8,
    informalLessClearMaxRate: 0.05,
    ambiguityHandlingMinRate: 0.9,
    evidenceCoverage: 1,
    smokeAmbiguityExact: 1,
  },
  reviewPolicy: {
    language: "tr",
    smokeReviewAll: true,
    englishEvidenceTurkishExplanation: true,
    confirmatoryReviewFlagged: true,
    confirmatoryStratifiedUnflaggedSampleSize: 16,
    escalateToAllOnReclassifiedUnflagged: true,
    rawBundleMode: "0600",
    rawBundleLocalOnly: true,
    rawBundleNeverCommitted: true,
    rawBundleDeleteAfterReview: true,
    commitAggregateOnly: true,
    forbiddenRawContentKeys: [...rawKeys],
    requireApprovalBeforeRelease: true,
    separateProviderModelCostApprovalRequired: true,
  },
} as const;
export type SourceGroundedEvidenceManifestV1 = typeof manifestShape;
const exact = (value: unknown, expected: unknown, path = "manifest"): void => {
  if (expected === null || typeof expected !== "object") {
    if (value !== expected) fail(`${path}:value`);
    return;
  }
  if (Array.isArray(expected)) {
    const actual = array(value);
    if (actual.length !== expected.length) fail(`${path}:length`);
    for (const [index, item] of actual.entries())
      exact(item, expected[index], `${path}[${index}]`);
    return;
  }
  const actual = strict(value, Object.keys(expected));
  for (const key of Object.keys(expected))
    exact(
      actual[key],
      (expected as Record<string, unknown>)[key],
      `${path}:${key}`,
    );
};
export const parseSourceGroundedEvidenceManifestV1 = (
  value: unknown,
): SourceGroundedEvidenceManifestV1 => {
  exact(value, manifestShape);
  return manifestShape;
};

export type SourceGroundedEvidenceAnnotationV1 = {
  caseId: string;
  classification:
    | "explicit-negative"
    | "nominal-action"
    | "bare-ambiguity"
    | "quoted-non-instruction"
    | "bounded-safe-display";
  noCodeConstraint: boolean;
  materialAmbiguity: boolean;
  askUser: boolean;
  forbiddenInterpreterMetadata: string[];
  prohibited: string[];
  responseLanguage: "tr" | "en";
  evidenceSources: string[];
};
const annotation = (value: unknown): SourceGroundedEvidenceAnnotationV1 => {
  const o = strict(value, [
    "caseId",
    "classification",
    "noCodeConstraint",
    "materialAmbiguity",
    "askUser",
    "forbiddenInterpreterMetadata",
    "prohibited",
    "responseLanguage",
    "evidenceSources",
  ]);
  const classification = string(o.classification);
  if (
    !(
      [
        "explicit-negative",
        "nominal-action",
        "bare-ambiguity",
        "quoted-non-instruction",
        "bounded-safe-display",
      ] as const
    ).includes(
      classification as SourceGroundedEvidenceAnnotationV1["classification"],
    )
  )
    fail("annotation:classification");
  const responseLanguage = string(o.responseLanguage);
  if (responseLanguage !== "tr" && responseLanguage !== "en")
    fail("annotation:responseLanguage");
  const strings = (item: unknown): string[] => array(item).map(string);
  return {
    caseId: string(o.caseId),
    classification:
      classification as SourceGroundedEvidenceAnnotationV1["classification"],
    noCodeConstraint: bool(o.noCodeConstraint),
    materialAmbiguity: bool(o.materialAmbiguity),
    askUser: bool(o.askUser),
    forbiddenInterpreterMetadata: strings(o.forbiddenInterpreterMetadata),
    prohibited: strings(o.prohibited),
    responseLanguage: responseLanguage as "tr" | "en",
    evidenceSources: strings(o.evidenceSources),
  };
};
export const validateSourceGroundedEvidenceCorpus = (
  casesValue: unknown,
  annotationsValue: unknown,
): {
  cases: BenchmarkCaseV1[];
  annotations: SourceGroundedEvidenceAnnotationV1[];
} => {
  const cases = array(casesValue).map(parseBenchmarkCaseV1);
  const annotations = array(annotationsValue).map(annotation);
  if (cases.length !== 8 || annotations.length !== 8) fail("corpus:count");
  if (sha256SourceGroundedCanonical(casesValue) !== SMOKE_HASH)
    fail("corpus:casesSha256");
  if (sha256SourceGroundedCanonical(annotationsValue) !== ANNOTATIONS_HASH)
    fail("corpus:annotationsSha256");
  const ids = new Set(cases.map((item) => item.id));
  if (ids.size !== 8 || annotations.some((item) => !ids.has(item.caseId)))
    fail("corpus:caseIds");
  const tr = cases.filter((item) => item.language === "tr");
  const en = cases.filter((item) => item.language === "en");
  if (tr.length !== 4 || en.length !== 4) fail("corpus:languages");
  const byId = new Map(annotations.map((item) => [item.caseId, item]));
  for (const [id, expected] of Object.entries({
    "sge-tr-01": ["explicit-negative", true, false, false],
    "sge-tr-02": ["nominal-action", false, false, false],
    "sge-tr-03": ["bare-ambiguity", false, true, true],
    "sge-tr-04": ["quoted-non-instruction", false, false, false],
    "sge-en-01": ["explicit-negative", true, false, false],
    "sge-en-02": ["nominal-action", false, false, false],
    "sge-en-03": ["quoted-non-instruction", false, false, false],
    "sge-en-04": ["bounded-safe-display", false, false, false],
  })) {
    const found = byId.get(id);
    if (
      !found ||
      found.classification !== expected[0] ||
      found.noCodeConstraint !== expected[1] ||
      found.materialAmbiguity !== expected[2] ||
      found.askUser !== expected[3] ||
      !["provider", "model", "runtimeProviderAlias"].every((key) =>
        found.forbiddenInterpreterMetadata.includes(key),
      ) ||
      found.evidenceSources.join(",") !==
        "candidate-intent,compiled-task,evaluator-verdict,turkish-human-review"
    )
      fail(`corpus:annotation:${id}`);
  }
  return { cases, annotations };
};

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
] as const;
type Gate = (typeof gates)[number];
const passes = (gate: Gate, rate: number) =>
  ({
    smoke: rate === 1,
    confirmatory: rate === 1,
    structural: rate === 1,
    languagePreservation: rate === 1,
    deterministicSafety: rate === 1,
    evidenceCoverage: rate === 1,
    forbiddenAdditions: rate === 0,
    interpreterLeakage: rate === 0,
    scopeExpansion: rate === 0,
    methodMandate: rate === 0,
    materialIntentAlteration: rate <= 0.05,
    informalClearer: rate >= 0.8,
    informalLessClear: rate <= 0.05,
    ambiguityHandling: rate >= 0.9,
    smokeAmbiguityExact: rate === 1,
    escalation: rate === 0,
  })[gate];
export type SourceGroundedEvidenceAggregateResultV1 = Record<string, unknown>;
export const parseSourceGroundedEvidenceAggregateResultV1 = (
  value: unknown,
): SourceGroundedEvidenceAggregateResultV1 => {
  rejectRaw(value);
  const o = strict(value, [
    "schemaVersion",
    "benchmarkId",
    "subjectRelease",
    "subjectCommit",
    "manifestSha256",
    "sourceReportV2Sha256s",
    "prompts",
    "candidate",
    "evaluator",
    "corpus",
    "sandboxPolicyHash",
    "calls",
    "cost",
    "gates",
    "humanReview",
    "decision",
    "limitations",
  ]);
  if (
    o.schemaVersion !== 1 ||
    o.benchmarkId !== ID ||
    o.subjectRelease !== "v1.2.0-rc" ||
    o.subjectCommit !== COMMIT
  )
    fail("aggregate:identity");
  if (hash(o.manifestSha256) !== SOURCE_GROUNDED_EVIDENCE_MANIFEST_SHA256)
    fail("aggregate:manifestSha256");
  exact(o.prompts, manifestShape.prompts, "aggregate:prompts");
  exact(o.candidate, manifestShape.candidate, "aggregate:candidate");
  if (o.evaluator !== null)
    exact(o.evaluator, manifestShape.evaluator, "aggregate:evaluator");
  const corpus = strict(o.corpus, [
    "confirmatorySha256",
    "smokeCasesSha256",
    "smokeAnnotationsSha256",
  ]);
  if (
    hash(corpus.confirmatorySha256) !== CONFIRMATORY_HASH ||
    hash(corpus.smokeCasesSha256) !== SMOKE_HASH ||
    hash(corpus.smokeAnnotationsSha256) !== ANNOTATIONS_HASH
  )
    fail("aggregate:corpus");
  hash(o.sandboxPolicyHash);
  const reports = array(o.sourceReportV2Sha256s).map(hash);
  if (new Set(reports).size !== reports.length)
    fail("aggregate:sourceReports-duplicate");
  const calls = strict(o.calls, ["total", "candidate", "evaluator"]);
  const total = integer(calls.total, 176);
  if (total !== integer(calls.candidate, 176) + integer(calls.evaluator, 176))
    fail("aggregate:calls-total");
  const cost = strict(o.cost, ["providerMeteredUsd"]);
  const usd =
    cost.providerMeteredUsd === null
      ? null
      : number(cost.providerMeteredUsd, 1);
  if (usd !== null && usd > 1) fail("aggregate:cost-cap");
  const parsedGates = array(o.gates).map((entry) => {
    const gate = strict(entry, [
      "gate",
      "rate",
      "numerator",
      "denominator",
      "status",
    ]);
    const name = string(gate.gate) as Gate;
    if (!gates.includes(name)) fail(`aggregate:gate-unknown:${gate.gate}`);
    const numerator = integer(gate.numerator, 88),
      denominator = integer(gate.denominator, 88),
      rate = gate.rate === null ? null : number(gate.rate, 1),
      status = string(gate.status);
    if (!(["pass", "fail", "unavailable"] as const).includes(status as "pass"))
      fail(`aggregate:gate-status:${name}`);
    if (
      numerator > denominator ||
      (status === "unavailable"
        ? rate !== null || numerator !== 0 || denominator !== 0
        : rate === null ||
          denominator === 0 ||
          Math.abs(rate - numerator / denominator) > 1e-12 ||
          passes(name, rate) !== (status === "pass"))
    )
      fail(`aggregate:gate:${name}`);
    return { name, rate, status };
  });
  if (new Set(parsedGates.map((gate) => gate.name)).size !== parsedGates.length)
    fail("aggregate:gate-duplicate");
  const review = strict(o.humanReview, [
    "language",
    "smokeReviewedCount",
    "confirmatoryFlaggedReviewed",
    "confirmatoryFlaggedTotal",
    "confirmatoryUnflaggedSampled",
    "confirmatoryUnflaggedReclassified",
    "confirmatoryExpandedToAll",
    "approvalStatus",
  ]);
  const language = string(review.language),
    smokeReviewed = integer(review.smokeReviewedCount, 8),
    flaggedReviewed = integer(review.confirmatoryFlaggedReviewed, 80),
    flaggedTotal = integer(review.confirmatoryFlaggedTotal, 80),
    sampled = integer(review.confirmatoryUnflaggedSampled, 80),
    reclassified = integer(review.confirmatoryUnflaggedReclassified, 80),
    expanded = bool(review.confirmatoryExpandedToAll),
    approval = string(review.approvalStatus),
    decision = string(o.decision);
  if (
    language !== "tr" ||
    smokeReviewed !== 8 ||
    flaggedReviewed > flaggedTotal ||
    sampled > 80 - flaggedTotal ||
    reclassified > sampled ||
    !["pending", "approved", "rejected"].includes(approval) ||
    !["stop", "pass", "fail"].includes(decision)
  )
    fail("aggregate:review");
  if (decision === "stop") {
    if (
      reports.length !== 1 ||
      total > 16 ||
      approval === "approved" ||
      flaggedReviewed ||
      flaggedTotal ||
      sampled ||
      reclassified ||
      expanded
    )
      fail("aggregate:stopped-smoke");
  } else {
    if (
      reports.length !== 2 ||
      (approval === "approved" && decision !== "pass")
    )
      fail("aggregate:reports-or-approval");
    if (
      reclassified > 0
        ? !expanded || flaggedReviewed + sampled !== 80
        : expanded ||
          flaggedReviewed !== flaggedTotal ||
          sampled !== Math.min(16, 80 - flaggedTotal)
    )
      fail("aggregate:review-completeness");
  }
  if (decision === "pass") {
    if (
      !o.evaluator ||
      usd === null ||
      total > 176 ||
      smokeReviewed !== 8 ||
      approval !== "approved" ||
      parsedGates.length !== gates.length
    )
      fail("aggregate:pass-requirements");
    for (const name of gates) {
      const gate = parsedGates.find((item) => item.name === name);
      if (!gate || gate.status !== "pass") fail(`aggregate:gate-${name}`);
    }
  }
  if (!array(o.limitations).every((item) => typeof item === "string"))
    fail("aggregate:limitations");
  return o;
};
