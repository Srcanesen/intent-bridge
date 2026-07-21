import type {
  BridgeMessageType,
  CompiledTask,
  IntentDocument,
  ProjectContext,
  QualitySignalsV1,
} from "@intent-bridge/core";

export type BenchmarkCaseV1 = {
  version: 1;
  id: string;
  title: string;
  language: string;
  messageType: BridgeMessageType;
  input: string;
  attachments?: { imageCount: number };
  contextFixture?: string;
  expected: {
    requiredGoalConcepts: string[];
    requiredConstraints: string[];
    forbiddenAdditions: string[];
    responseLanguage: string;
    risk?: "low" | "medium" | "high";
    clarificationRecommended?: boolean;
  };
  tags: string[];
};
export type InvariantResult = {
  passed: boolean;
  checks: { name: string; passed: boolean; detail?: string }[];
};
/** Transient evidence sent only to an explicitly injected model evaluator. */
export type BenchmarkEvaluatorInputV1 = {
  caseId: string;
  source: {
    originalText: string;
    sourceLanguage: string;
    messageType: BridgeMessageType;
    attachmentSummary: { imageCount: number };
    projectContext: ProjectContext;
  };
  candidate: {
    intent: IntentDocument;
    compiledTask: CompiledTask;
  };
};
/** Bounded output from a model evaluator; it is not a human rating. */
export type BenchmarkEvaluationV1 = {
  version: 1;
  intentAltered: boolean;
  clarity: "clearer" | "equal" | "less_clear";
  rating?: "good" | "bad";
};
export interface BenchmarkEvaluator {
  evaluate(input: BenchmarkEvaluatorInputV1): Promise<BenchmarkEvaluationV1>;
}
export type BenchmarkResultV1 = {
  caseId: string;
  title: string;
  tags: string[];
  status: "transformed" | "fail_open" | "skipped";
  errorCode?: string;
  latencyMs?: number;
  tokenUsage?: { input?: number; output?: number; total?: number };
  estimatedCostUsd?: number;
  quality?: QualitySignalsV1;
  invariant: InvariantResult;
  evaluation?: BenchmarkEvaluationV1;
  evaluatorError?: "EVALUATOR_FAILED";
};
export type Metric = { value: number | null; denominator: number };
export type BenchmarkAggregatesV1 = {
  total: number;
  attempted: number;
  transformed: number;
  failOpen: number;
  skipped: number;
  schemaValidRate: Metric;
  invariantPassRate: Metric;
  failOpenRate: Metric;
  latencyP50: number | null;
  latencyP95: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  averageInputTokens: number | null;
  averageOutputTokens: number | null;
  averageTotalTokens: number | null;
  missingUsageCount: number;
  totalCostUsd: number | null;
  averageCostUsd: number | null;
  missingCostCount: number;
  qualitySchemaValidRate: Metric;
  qualityLanguagePresentRate: Metric;
  qualityHasGoalRate: Metric;
  qualityConstraintsSeparatedRate: Metric;
  qualityAssumptionsSeparatedRate: Metric;
  qualityAmbiguitiesTypedRate: Metric;
  qualityCompilerValidRate: Metric;
  averageTaskCount: Metric;
  averageProviderConfidence: Metric;
  forbiddenAdditionFailureCount: number;
  forbiddenAdditionFailureRate: Metric;
  languagePreservationRate: Metric;
  evaluatedCount: number;
  evaluatorMaterialIntentAlterationRate: Metric;
  evaluatorClearerOrEqualRate: Metric;
  evaluatorGoodRatingRate: Metric;
  humanRatingRate: Metric;
  userRatingRate: Metric;
};
export type BenchmarkThresholdsV1 = Record<
  "invariants" | "materialAlteration" | "clarity" | "language" | "safety",
  { status: "pass" | "fail" | "unavailable"; denominator: number }
>;
export type BenchmarkReportV1 = {
  version: 1;
  profile: { id: string; model: string };
  schemaVersion: "1" | "2";
  promptVersion: string;
  compilerVersion: "pi-v1" | "pi-v2";
  runnerVersion: "benchmark-v1";
  startedAt: string;
  completedAt: string;
  concurrency: number;
  results: BenchmarkResultV1[];
  aggregates: BenchmarkAggregatesV1;
  thresholds: BenchmarkThresholdsV1;
};

const fail = (message = "BENCHMARK_INVALID"): never => {
  throw new Error(message);
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : fail();
const strict = (v: unknown, keys: readonly string[]) => {
  const o = object(v);
  if (
    Object.keys(o).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in o))
  )
    fail();
  return o;
};
const optionalStrict = (
  v: unknown,
  required: readonly string[],
  optional: readonly string[],
) => {
  const o = object(v);
  if (
    Object.keys(o).some(
      (key) => !required.includes(key) && !optional.includes(key),
    ) ||
    required.some((key) => !(key in o))
  )
    fail();
  return o;
};
const text = (v: unknown, max = 4000): string =>
  typeof v === "string" && v.trim() && v.length <= max ? v : fail();
const list = (v: unknown): string[] =>
  Array.isArray(v) &&
  v.length <= 20 &&
  v.every((x) => typeof x === "string" && x.trim() && x.length <= 1000)
    ? v
    : fail();
const finite = (v: unknown, min = 0, max = Number.POSITIVE_INFINITY): number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fail();
const integer = (
  v: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number => {
  const n = finite(v, min);
  return Number.isInteger(n) && n <= max ? n : fail();
};
const boolean = (v: unknown): boolean => (typeof v === "boolean" ? v : fail());
const enumValue = <T extends string>(v: unknown, values: readonly T[]): T =>
  typeof v === "string" && values.includes(v as T) ? (v as T) : fail();
const date = (v: unknown): string => {
  const value = text(v, 40);
  return Number.isFinite(Date.parse(value)) ? value : fail();
};
const metric = (v: unknown, rateOnly = true): Metric => {
  const o = strict(v, ["value", "denominator"]);
  const denominator = integer(o.denominator);
  const value = o.value === null ? null : finite(o.value);
  if (
    (value === null) !== (denominator === 0) ||
    (rateOnly && value !== null && value > 1)
  )
    fail();
  return { value, denominator };
};

export function parseBenchmarkCaseV1(value: unknown): BenchmarkCaseV1 {
  const o = optionalStrict(
    value,
    [
      "version",
      "id",
      "title",
      "language",
      "messageType",
      "input",
      "expected",
      "tags",
    ],
    ["attachments", "contextFixture"],
  );
  if (o.version !== 1) fail();
  const messageType = enumValue(o.messageType, [
    "initial",
    "normal",
    "steer",
    "follow_up",
  ] as const);
  const e = optionalStrict(
    o.expected,
    [
      "requiredGoalConcepts",
      "requiredConstraints",
      "forbiddenAdditions",
      "responseLanguage",
    ],
    ["risk", "clarificationRecommended"],
  );
  const attachments =
    o.attachments === undefined
      ? undefined
      : strict(o.attachments, ["imageCount"]);
  if (attachments) integer(attachments.imageCount, 0, 20);
  return {
    version: 1,
    id: text(o.id, 100),
    title: text(o.title, 200),
    language: text(o.language, 16),
    messageType,
    input: text(o.input, 12000),
    ...(attachments
      ? { attachments: { imageCount: integer(attachments.imageCount, 0, 20) } }
      : {}),
    ...(o.contextFixture === undefined
      ? {}
      : { contextFixture: text(o.contextFixture, 100) }),
    expected: {
      requiredGoalConcepts: list(e.requiredGoalConcepts),
      requiredConstraints: list(e.requiredConstraints),
      forbiddenAdditions: list(e.forbiddenAdditions),
      responseLanguage: text(e.responseLanguage, 16),
      ...(e.risk === undefined
        ? {}
        : { risk: enumValue(e.risk, ["low", "medium", "high"] as const) }),
      ...(e.clarificationRecommended === undefined
        ? {}
        : { clarificationRecommended: boolean(e.clarificationRecommended) }),
    },
    tags: list(o.tags),
  };
}

export function parseBenchmarkEvaluationV1(
  value: unknown,
): BenchmarkEvaluationV1 {
  const o = optionalStrict(
    value,
    ["version", "intentAltered", "clarity"],
    ["rating"],
  );
  if (o.version !== 1) fail("EVALUATOR_FAILED");
  return {
    version: 1,
    intentAltered: boolean(o.intentAltered),
    clarity: enumValue(o.clarity, ["clearer", "equal", "less_clear"] as const),
    ...(o.rating === undefined
      ? {}
      : { rating: enumValue(o.rating, ["good", "bad"] as const) }),
  };
}

const parseInvariant = (value: unknown): InvariantResult => {
  const o = strict(value, ["passed", "checks"]);
  const checks: unknown[] = Array.isArray(o.checks) ? o.checks : fail();
  if (checks.length > 30) fail();
  return {
    passed: boolean(o.passed),
    checks: checks.map((entry: unknown) => {
      const check = optionalStrict(entry, ["name", "passed"], ["detail"]);
      return {
        name: text(check.name, 100),
        passed: boolean(check.passed),
        ...(check.detail === undefined
          ? {}
          : { detail: text(check.detail, 160) }),
      };
    }),
  };
};
const parseQuality = (value: unknown): QualitySignalsV1 => {
  const o = optionalStrict(
    value,
    [
      "schemaValid",
      "languagePresent",
      "taskCount",
      "hasGoal",
      "constraintsSeparated",
      "assumptionsSeparated",
      "ambiguitiesTyped",
      "compilerValid",
    ],
    ["providerConfidence", "estimatedScore"],
  );
  return {
    schemaValid: boolean(o.schemaValid),
    languagePresent: boolean(o.languagePresent),
    taskCount: integer(o.taskCount),
    hasGoal: boolean(o.hasGoal),
    constraintsSeparated: boolean(o.constraintsSeparated),
    assumptionsSeparated: boolean(o.assumptionsSeparated),
    ambiguitiesTyped: boolean(o.ambiguitiesTyped),
    compilerValid: boolean(o.compilerValid),
    ...(o.providerConfidence === undefined
      ? {}
      : { providerConfidence: finite(o.providerConfidence, 0, 1) }),
    ...(o.estimatedScore === undefined
      ? {}
      : { estimatedScore: finite(o.estimatedScore, 0, 1) }),
  };
};
const parseResult = (value: unknown): BenchmarkResultV1 => {
  const o = optionalStrict(
    value,
    ["caseId", "title", "tags", "status", "invariant"],
    [
      "errorCode",
      "latencyMs",
      "tokenUsage",
      "estimatedCostUsd",
      "quality",
      "evaluation",
      "evaluatorError",
    ],
  );
  const tokenUsage =
    o.tokenUsage === undefined
      ? undefined
      : optionalStrict(o.tokenUsage, [], ["input", "output", "total"]);
  return {
    caseId: text(o.caseId, 100),
    title: text(o.title, 200),
    tags: list(o.tags),
    status: enumValue(o.status, [
      "transformed",
      "fail_open",
      "skipped",
    ] as const),
    ...(o.errorCode === undefined ? {} : { errorCode: text(o.errorCode, 100) }),
    ...(o.latencyMs === undefined ? {} : { latencyMs: finite(o.latencyMs) }),
    ...(tokenUsage
      ? {
          tokenUsage: {
            ...(tokenUsage.input === undefined
              ? {}
              : { input: integer(tokenUsage.input) }),
            ...(tokenUsage.output === undefined
              ? {}
              : { output: integer(tokenUsage.output) }),
            ...(tokenUsage.total === undefined
              ? {}
              : { total: integer(tokenUsage.total) }),
          },
        }
      : {}),
    ...(o.estimatedCostUsd === undefined
      ? {}
      : { estimatedCostUsd: finite(o.estimatedCostUsd) }),
    ...(o.quality === undefined ? {} : { quality: parseQuality(o.quality) }),
    invariant: parseInvariant(o.invariant),
    ...(o.evaluation === undefined
      ? {}
      : { evaluation: parseBenchmarkEvaluationV1(o.evaluation) }),
    ...(o.evaluatorError === undefined
      ? {}
      : {
          evaluatorError: enumValue(o.evaluatorError, [
            "EVALUATOR_FAILED",
          ] as const),
        }),
  };
};

const aggregateKeys = [
  "total",
  "attempted",
  "transformed",
  "failOpen",
  "skipped",
  "schemaValidRate",
  "invariantPassRate",
  "failOpenRate",
  "latencyP50",
  "latencyP95",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "averageInputTokens",
  "averageOutputTokens",
  "averageTotalTokens",
  "missingUsageCount",
  "totalCostUsd",
  "averageCostUsd",
  "missingCostCount",
  "qualitySchemaValidRate",
  "qualityLanguagePresentRate",
  "qualityHasGoalRate",
  "qualityConstraintsSeparatedRate",
  "qualityAssumptionsSeparatedRate",
  "qualityAmbiguitiesTypedRate",
  "qualityCompilerValidRate",
  "averageTaskCount",
  "averageProviderConfidence",
  "forbiddenAdditionFailureCount",
  "forbiddenAdditionFailureRate",
  "languagePreservationRate",
  "evaluatedCount",
  "evaluatorMaterialIntentAlterationRate",
  "evaluatorClearerOrEqualRate",
  "evaluatorGoodRatingRate",
  "humanRatingRate",
  "userRatingRate",
] as const;
const metricKeys = new Set([
  "schemaValidRate",
  "invariantPassRate",
  "failOpenRate",
  "qualitySchemaValidRate",
  "qualityLanguagePresentRate",
  "qualityHasGoalRate",
  "qualityConstraintsSeparatedRate",
  "qualityAssumptionsSeparatedRate",
  "qualityAmbiguitiesTypedRate",
  "qualityCompilerValidRate",
  "averageTaskCount",
  "averageProviderConfidence",
  "forbiddenAdditionFailureRate",
  "languagePreservationRate",
  "evaluatorMaterialIntentAlterationRate",
  "evaluatorClearerOrEqualRate",
  "evaluatorGoodRatingRate",
  "humanRatingRate",
  "userRatingRate",
]);
const nullableNumberKeys = new Set([
  "latencyP50",
  "latencyP95",
  "averageInputTokens",
  "averageOutputTokens",
  "averageTotalTokens",
  "totalCostUsd",
  "averageCostUsd",
]);
function parseAggregates(value: unknown): BenchmarkAggregatesV1 {
  const o = strict(value, aggregateKeys);
  const parsed: Record<string, unknown> = {};
  for (const key of aggregateKeys) {
    if (metricKeys.has(key))
      parsed[key] = metric(o[key], key !== "averageTaskCount");
    else if (nullableNumberKeys.has(key))
      parsed[key] = o[key] === null ? null : finite(o[key]);
    else parsed[key] = integer(o[key]);
  }
  return parsed as BenchmarkAggregatesV1;
}
function parseThresholds(value: unknown): BenchmarkThresholdsV1 {
  const o = strict(value, [
    "invariants",
    "materialAlteration",
    "clarity",
    "language",
    "safety",
  ]);
  return Object.fromEntries(
    Object.entries(o).map(([key, value]) => {
      const threshold = strict(value, ["status", "denominator"]);
      return [
        key,
        {
          status: enumValue(threshold.status, [
            "pass",
            "fail",
            "unavailable",
          ] as const),
          denominator: integer(threshold.denominator),
        },
      ];
    }),
  ) as BenchmarkThresholdsV1;
}
export function parseBenchmarkReportV1(value: unknown): BenchmarkReportV1 {
  const o = strict(value, [
    "version",
    "profile",
    "schemaVersion",
    "promptVersion",
    "compilerVersion",
    "runnerVersion",
    "startedAt",
    "completedAt",
    "concurrency",
    "results",
    "aggregates",
    "thresholds",
  ]);
  if (
    o.version !== 1 ||
    !["1", "2"].includes(o.schemaVersion as string) ||
    !["pi-v1", "pi-v2"].includes(o.compilerVersion as string) ||
    o.runnerVersion !== "benchmark-v1"
  )
    fail();
  const profile = strict(o.profile, ["id", "model"]);
  const results: unknown[] = Array.isArray(o.results) ? o.results : fail();
  return {
    version: 1,
    profile: { id: text(profile.id, 100), model: text(profile.model, 200) },
    schemaVersion: enumValue(o.schemaVersion, ["1", "2"] as const),
    promptVersion: text(o.promptVersion, 100),
    compilerVersion: enumValue(o.compilerVersion, ["pi-v1", "pi-v2"] as const),
    runnerVersion: "benchmark-v1",
    startedAt: date(o.startedAt),
    completedAt: date(o.completedAt),
    concurrency: integer(o.concurrency, 1, 8),
    results: results.map(parseResult),
    aggregates: parseAggregates(o.aggregates),
    thresholds: parseThresholds(o.thresholds),
  };
}

export type BenchmarkAggregatesV2 = Omit<
  BenchmarkAggregatesV1,
  "invariantPassRate" | "humanRatingRate" | "userRatingRate"
> & {
  structuralPassRate: Metric;
  literalGoalDiagnosticRate: Metric;
  literalConstraintDiagnosticRate: Metric;
  deterministicSafetyPassRate: Metric;
  evaluatorCoverageRate: Metric;
  ownerReviewCoverageRate: Metric;
  ownerMaterialIntentAlterationRate: Metric;
  ownerClearerOrEqualRate: Metric;
};
export type BenchmarkThresholdsV2 = Record<
  | "structural"
  | "language"
  | "deterministicSafety"
  | "evaluatorCoverage"
  | "evaluatorMaterialAlteration"
  | "evaluatorClarity"
  | "ownerCoverage"
  | "ownerMaterialAlteration"
  | "ownerClarity"
  | "ownerAcceptance",
  { status: "pass" | "fail" | "unavailable"; denominator: number }
>;
export type BenchmarkEvaluatorPromptVersion =
  | "pi-benchmark-evaluator-v1"
  | "pi-benchmark-evaluator-v2"
  | "pi-benchmark-evaluator-v3"
  | "pi-benchmark-evaluator-v4";
/** Bounded Pi ModelThinkingLevel values supported by the benchmark evaluator. */
export type BenchmarkEvaluatorReasoningV1 =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
export type BenchmarkEvaluatorMetadataV1 = {
  provider: string;
  model: string;
  promptVersion: BenchmarkEvaluatorPromptVersion;
  /** Optional bounded Pi ModelThinkingLevel selected for the evaluator. */
  reasoning?: BenchmarkEvaluatorReasoningV1;
};
export type OwnerReviewMetadataV1 = {
  sourceReportSha256: string;
  reviewerKind: "owner-human";
  reviewedAt: string;
  manualAcceptance: "pass" | "fail";
};
export type OwnerReviewV1 = OwnerReviewMetadataV1 & {
  version: 1;
  cases: {
    profileId: string;
    caseId: string;
    intentAltered: boolean;
    clarity: "clearer" | "equal" | "less_clear";
    accepted: boolean;
  }[];
};
export type BenchmarkCorpusMetadataV1 = {
  total: number;
  caseIdSequenceSha256: string;
  contentSha256: string;
};
export type BenchmarkReportV2 = Omit<
  BenchmarkReportV1,
  "version" | "runnerVersion" | "aggregates" | "thresholds"
> & {
  version: 2;
  runnerVersion: "benchmark-v2";
  corpus?: BenchmarkCorpusMetadataV1;
  evaluator?: BenchmarkEvaluatorMetadataV1;
  ownerReview?: OwnerReviewMetadataV1;
  aggregates: BenchmarkAggregatesV2;
  thresholds: BenchmarkThresholdsV2;
};
export type BenchmarkReport = BenchmarkReportV1 | BenchmarkReportV2;

const v2RemovedAggregateKeys = new Set<string>([
  "invariantPassRate",
  "humanRatingRate",
  "userRatingRate",
]);
const v2AggregateKeys = [
  ...aggregateKeys.filter((key) => !v2RemovedAggregateKeys.has(key)),
  "structuralPassRate",
  "literalGoalDiagnosticRate",
  "literalConstraintDiagnosticRate",
  "deterministicSafetyPassRate",
  "evaluatorCoverageRate",
  "ownerReviewCoverageRate",
  "ownerMaterialIntentAlterationRate",
  "ownerClearerOrEqualRate",
] as const;
const v2MetricKeys = new Set<string>([
  ...metricKeys,
  "structuralPassRate",
  "literalGoalDiagnosticRate",
  "literalConstraintDiagnosticRate",
  "deterministicSafetyPassRate",
  "evaluatorCoverageRate",
  "ownerReviewCoverageRate",
  "ownerMaterialIntentAlterationRate",
  "ownerClearerOrEqualRate",
]);
function parseAggregatesV2(value: unknown): BenchmarkAggregatesV2 {
  const o = strict(value, v2AggregateKeys);
  const parsed: Record<string, unknown> = {};
  for (const key of v2AggregateKeys) {
    if (v2MetricKeys.has(key))
      parsed[key] = metric(o[key], key !== "averageTaskCount");
    else if (nullableNumberKeys.has(key))
      parsed[key] = o[key] === null ? null : finite(o[key]);
    else parsed[key] = integer(o[key]);
  }
  return parsed as BenchmarkAggregatesV2;
}
function parseThresholdsV2(value: unknown): BenchmarkThresholdsV2 {
  const keys = [
    "structural",
    "language",
    "deterministicSafety",
    "evaluatorCoverage",
    "evaluatorMaterialAlteration",
    "evaluatorClarity",
    "ownerCoverage",
    "ownerMaterialAlteration",
    "ownerClarity",
    "ownerAcceptance",
  ] as const;
  const o = strict(value, keys);
  return Object.fromEntries(
    keys.map((key) => {
      const threshold = strict(o[key], ["status", "denominator"]);
      return [
        key,
        {
          status: enumValue(threshold.status, [
            "pass",
            "fail",
            "unavailable",
          ] as const),
          denominator: integer(threshold.denominator),
        },
      ];
    }),
  ) as BenchmarkThresholdsV2;
}
const sha256 = (v: unknown): string =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail();
const isoDate = (v: unknown): string => {
  const value = text(v, 40);
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value
    ? value
    : fail();
};
const parseOwnerReviewMetadata = (value: unknown): OwnerReviewMetadataV1 => {
  const o = strict(value, [
    "sourceReportSha256",
    "reviewerKind",
    "reviewedAt",
    "manualAcceptance",
  ]);
  return {
    sourceReportSha256: sha256(o.sourceReportSha256),
    reviewerKind: enumValue(o.reviewerKind, ["owner-human"] as const),
    reviewedAt: isoDate(o.reviewedAt),
    manualAcceptance: enumValue(o.manualAcceptance, ["pass", "fail"] as const),
  };
};
export function parseOwnerReviewV1(value: unknown): OwnerReviewV1 {
  const o = strict(value, [
    "version",
    "sourceReportSha256",
    "reviewerKind",
    "reviewedAt",
    "manualAcceptance",
    "cases",
  ]);
  if (o.version !== 1) fail();
  const metadata = parseOwnerReviewMetadata({
    sourceReportSha256: o.sourceReportSha256,
    reviewerKind: o.reviewerKind,
    reviewedAt: o.reviewedAt,
    manualAcceptance: o.manualAcceptance,
  });
  const cases: unknown[] = Array.isArray(o.cases) ? o.cases : fail();
  if (cases.length > 1000) fail();
  return {
    version: 1,
    ...metadata,
    cases: cases.map((value) => {
      const item = strict(value, [
        "profileId",
        "caseId",
        "intentAltered",
        "clarity",
        "accepted",
      ]);
      return {
        profileId: text(item.profileId, 100),
        caseId: text(item.caseId, 100),
        intentAltered: boolean(item.intentAltered),
        clarity: enumValue(item.clarity, [
          "clearer",
          "equal",
          "less_clear",
        ] as const),
        accepted: boolean(item.accepted),
      };
    }),
  };
}
export function parseBenchmarkReportV2(value: unknown): BenchmarkReportV2 {
  const o = optionalStrict(
    value,
    [
      "version",
      "profile",
      "schemaVersion",
      "promptVersion",
      "compilerVersion",
      "runnerVersion",
      "startedAt",
      "completedAt",
      "concurrency",
      "results",
      "aggregates",
      "thresholds",
    ],
    ["corpus", "evaluator", "ownerReview"],
  );
  if (
    o.version !== 2 ||
    !["1", "2"].includes(o.schemaVersion as string) ||
    !["pi-v1", "pi-v2"].includes(o.compilerVersion as string) ||
    o.runnerVersion !== "benchmark-v2"
  )
    fail();
  const profile = strict(o.profile, ["id", "model"]);
  const corpus =
    o.corpus === undefined
      ? undefined
      : strict(o.corpus, ["total", "caseIdSequenceSha256", "contentSha256"]);
  const corpusMetadata = corpus
    ? {
        total: integer(corpus.total, 0, 1000),
        caseIdSequenceSha256: sha256(corpus.caseIdSequenceSha256),
        contentSha256: sha256(corpus.contentSha256),
      }
    : undefined;
  const evaluator =
    o.evaluator === undefined
      ? undefined
      : optionalStrict(
          o.evaluator,
          ["provider", "model", "promptVersion"],
          ["reasoning"],
        );
  const evaluatorMetadata = evaluator
    ? {
        provider: text(evaluator.provider, 100),
        model: text(evaluator.model, 200),
        promptVersion: enumValue(evaluator.promptVersion, [
          "pi-benchmark-evaluator-v1",
          "pi-benchmark-evaluator-v2",
          "pi-benchmark-evaluator-v3",
          "pi-benchmark-evaluator-v4",
        ] as const),
        ...(evaluator.reasoning === undefined
          ? {}
          : {
              reasoning: enumValue(evaluator.reasoning, [
                "off",
                "minimal",
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ] as const),
            }),
      }
    : undefined;
  const ownerReview =
    o.ownerReview === undefined
      ? undefined
      : parseOwnerReviewMetadata(o.ownerReview);
  const results: unknown[] = Array.isArray(o.results) ? o.results : fail();
  return {
    version: 2,
    profile: { id: text(profile.id, 100), model: text(profile.model, 200) },
    ...(corpusMetadata ? { corpus: corpusMetadata } : {}),
    ...(evaluatorMetadata ? { evaluator: evaluatorMetadata } : {}),
    ...(ownerReview ? { ownerReview } : {}),
    schemaVersion: enumValue(o.schemaVersion, ["1", "2"] as const),
    promptVersion: text(o.promptVersion, 100),
    compilerVersion: enumValue(o.compilerVersion, ["pi-v1", "pi-v2"] as const),
    runnerVersion: "benchmark-v2",
    startedAt: date(o.startedAt),
    completedAt: date(o.completedAt),
    concurrency: integer(o.concurrency, 1, 8),
    results: results.map(parseResult),
    aggregates: parseAggregatesV2(o.aggregates),
    thresholds: parseThresholdsV2(o.thresholds),
  };
}
export function parseBenchmarkReport(value: unknown): BenchmarkReport {
  const report = object(value);
  return report.version === 1
    ? parseBenchmarkReportV1(report)
    : report.version === 2
      ? parseBenchmarkReportV2(report)
      : fail();
}
