export const IMPLEMENTATION_OUTCOME_VERSION =
  "implementation-outcome-v1" as const;
export const IMPLEMENTATION_OUTCOME_RUNNER =
  "pi-sdk-implementation-outcome-v1" as const;

export type ImplementationCaseV1 = {
  version: 1;
  id: string;
  language: "tr" | "en" | "es";
  fixture: string;
  initialRevision: string;
  initialTree: string;
  originalRequest: string;
  validators: string[][];
  allowedPaths: string[];
  forbiddenPaths: string[];
  requiredAssertion: { id: string; argv: string[] };
  maxTouchedFiles: number;
  expectedClarification: "none" | "required";
  network: "deny";
  timeoutMs: number;
};

export type ImplementationArm = "control" | "treatment";
export type ImplementationErrorCode =
  | "NONE"
  | "MODEL_FAILED"
  | "MODEL_TIMEOUT"
  | "VALIDATION_FAILED"
  | "ASSERTION_FAILED"
  | "INVALID_CASE"
  | "INVALID_FIXTURE"
  | "INVALID_BASELINE"
  | "INVALID_ISOLATION"
  | "INVALID_MODEL"
  | "INVALID_REPORT";

export type ImplementationArmResultV1 = {
  caseId: string;
  arm: ImplementationArm;
  order: 0 | 1;
  status: "completed" | "failed" | "invalid";
  errorCode: ImplementationErrorCode;
  taskSuccess: boolean;
  validationPassed: number;
  validationTotal: number;
  assertionPassed: number;
  assertionTotal: number;
  forbiddenViolation: boolean;
  scopeViolation: boolean;
  expectedClarification: "none" | "required";
  observedClarification: boolean;
  touchedPaths: string[];
  touchedCount: number;
  diff: {
    sha256: string;
    insertions: number;
    deletions: number;
    binaryFiles: number;
  };
  implementationLatencyMs: number;
  treatmentCompilationLatencyMs: number | null;
  turns: number;
  toolCalls: number;
  repeatedMutations: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  blockedSafety: {
    boundary: number;
    network: number;
    destructive: number;
  };
  responseLanguageSafety: "unavailable";
  fixtureRevision: string;
  fixtureTree: string;
};

export type ImplementationCasePairV1 = {
  caseId: string;
  configHash: string;
  fixtureRevision: string;
  fixtureTree: string;
  order: [ImplementationArm, ImplementationArm];
  arms: [ImplementationArmResultV1, ImplementationArmResultV1];
};

export type OutcomeMetric = { value: number | null; denominator: number };
export type ImplementationArmAggregatesV1 = {
  valid: number;
  invalid: number;
  taskSuccessRate: OutcomeMetric;
  scopeViolationRate: OutcomeMetric;
  forbiddenViolationRate: OutcomeMetric;
  averageLatencyMs: OutcomeMetric;
};
export type ImplementationOutcomeAggregatesV1 = {
  control: ImplementationArmAggregatesV1;
  treatment: ImplementationArmAggregatesV1;
  pairedTreatmentMinusControl: {
    taskSuccessRate: number | null;
    scopeViolationRate: number | null;
    forbiddenViolationRate: number | null;
    averageLatencyMs: number | null;
  };
};

export type ImplementationOutcomeReportV1 = {
  version: typeof IMPLEMENTATION_OUTCOME_VERSION;
  runner: typeof IMPLEMENTATION_OUTCOME_RUNNER;
  runConfigHash: string;
  pi: {
    packageVersion: "0.80.10";
    provider: string;
    model: string;
    thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  };
  bridge: {
    provider: string;
    model: string;
    schemaVersion: "2";
    promptVersion: string;
    compilerVersion: "pi-v2";
    policyVersion: string;
  };
  corpus: { sha256: string; orderedCaseIds: string[] };
  seed: string;
  order: string[];
  isolation: { mode: "external-policy-sandbox"; policyHash: string };
  ownerReview: "not_reviewed";
  pairs: ImplementationCasePairV1[];
  aggregates: ImplementationOutcomeAggregatesV1;
};

const fail = (code = "IMPLEMENTATION_OUTCOME_INVALID"): never => {
  throw new Error(code);
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
const strict = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
) => {
  const out = object(value);
  if (
    required.some((key) => !(key in out)) ||
    Object.keys(out).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    fail();
  return out;
};
const text = (value: unknown, max = 200): string =>
  typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : fail();
const enumValue = <T extends string>(
  value: unknown,
  values: readonly T[],
): T =>
  typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : fail();
const integer = (value: unknown, min = 0, max = 1_000_000): number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max
    ? value
    : fail();
const nullableFinite = (value: unknown, max = 1_000_000_000): number | null =>
  value === null
    ? null
    : typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= max
      ? value
      : fail();
const bool = (value: unknown): boolean =>
  typeof value === "boolean" ? value : fail();
const hash = (value: unknown): string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : fail();
const gitHash = (value: unknown): string =>
  typeof value === "string" && /^[0-9a-f]{40,64}$/.test(value) ? value : fail();

export function parseRepoPath(value: unknown): string {
  const path = text(value, 300).replaceAll("\\", "/");
  if (
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:\//.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail("IMPLEMENTATION_PATH_INVALID");
  return path;
}

function argv(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 12 ||
    value.some(
      (part) =>
        typeof part !== "string" ||
        !part ||
        part.length > 300 ||
        part.includes("\0") ||
        part.startsWith("/") ||
        /^[A-Za-z]:[\\/]/.test(part) ||
        part.replaceAll("\\", "/").split("/").includes(".."),
    )
  )
    fail();
  return [...(value as string[])];
}
function pathList(value: unknown, max = 30): string[] {
  if (!Array.isArray(value) || value.length > max) fail();
  const paths = (value as unknown[]).map(parseRepoPath);
  if (new Set(paths).size !== paths.length)
    fail("IMPLEMENTATION_PATH_DUPLICATE");
  return paths;
}

export function parseImplementationCaseV1(
  value: unknown,
): ImplementationCaseV1 {
  const o = strict(value, [
    "version",
    "id",
    "language",
    "fixture",
    "initialRevision",
    "initialTree",
    "originalRequest",
    "validators",
    "allowedPaths",
    "forbiddenPaths",
    "requiredAssertion",
    "maxTouchedFiles",
    "expectedClarification",
    "network",
    "timeoutMs",
  ]);
  if (o.version !== 1) fail();
  const validators = Array.isArray(o.validators)
    ? o.validators.map(argv)
    : fail();
  if (validators.length < 1 || validators.length > 8) fail();
  const allowedPaths = pathList(o.allowedPaths);
  const forbiddenPaths = pathList(o.forbiddenPaths);
  const overlaps = (left: string, right: string) =>
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`);
  if (
    !allowedPaths.length ||
    allowedPaths.some((allowed) =>
      forbiddenPaths.some((forbidden) => overlaps(allowed, forbidden)),
    )
  )
    fail();
  const assertion = strict(o.requiredAssertion, ["id", "argv"]);
  return {
    version: 1,
    id: text(o.id, 80),
    language: enumValue(o.language, ["tr", "en", "es"] as const),
    fixture: parseRepoPath(o.fixture),
    initialRevision: gitHash(o.initialRevision),
    initialTree: gitHash(o.initialTree),
    originalRequest: text(o.originalRequest, 8000),
    validators,
    allowedPaths,
    forbiddenPaths,
    requiredAssertion: {
      id: text(assertion.id, 80),
      argv: argv(assertion.argv),
    },
    maxTouchedFiles: integer(o.maxTouchedFiles, 0, 20),
    expectedClarification: enumValue(o.expectedClarification, [
      "none",
      "required",
    ] as const),
    network: enumValue(o.network, ["deny"] as const),
    timeoutMs: integer(o.timeoutMs, 1000, 300_000),
  };
}

export function parseImplementationCasesV1(
  value: unknown,
): ImplementationCaseV1[] {
  if (!Array.isArray(value) || value.length < 12 || value.length > 100) fail();
  const cases = (value as unknown[]).map(parseImplementationCaseV1);
  if (new Set(cases.map((item) => item.id)).size !== cases.length)
    fail("IMPLEMENTATION_CASE_DUPLICATE");
  return cases;
}

function metric(value: unknown): OutcomeMetric {
  const o = strict(value, ["value", "denominator"]);
  const denominator = integer(o.denominator, 0, 1000);
  const parsed = nullableFinite(o.value);
  if ((parsed === null) !== (denominator === 0)) fail();
  return { value: parsed, denominator };
}
function armAggregates(value: unknown): ImplementationArmAggregatesV1 {
  const o = strict(value, [
    "valid",
    "invalid",
    "taskSuccessRate",
    "scopeViolationRate",
    "forbiddenViolationRate",
    "averageLatencyMs",
  ]);
  const result = {
    valid: integer(o.valid, 0, 1000),
    invalid: integer(o.invalid, 0, 1000),
    taskSuccessRate: metric(o.taskSuccessRate),
    scopeViolationRate: metric(o.scopeViolationRate),
    forbiddenViolationRate: metric(o.forbiddenViolationRate),
    averageLatencyMs: metric(o.averageLatencyMs),
  };
  if (
    [
      result.taskSuccessRate,
      result.scopeViolationRate,
      result.forbiddenViolationRate,
      result.averageLatencyMs,
    ].some((item) => item.denominator !== result.valid)
  )
    fail();
  return result;
}

function parseArm(value: unknown): ImplementationArmResultV1 {
  const o = strict(value, [
    "caseId",
    "arm",
    "order",
    "status",
    "errorCode",
    "taskSuccess",
    "validationPassed",
    "validationTotal",
    "assertionPassed",
    "assertionTotal",
    "forbiddenViolation",
    "scopeViolation",
    "expectedClarification",
    "observedClarification",
    "touchedPaths",
    "touchedCount",
    "diff",
    "implementationLatencyMs",
    "treatmentCompilationLatencyMs",
    "turns",
    "toolCalls",
    "repeatedMutations",
    "inputTokens",
    "outputTokens",
    "costUsd",
    "blockedSafety",
    "responseLanguageSafety",
    "fixtureRevision",
    "fixtureTree",
  ]);
  const touchedPaths = pathList(o.touchedPaths, 20);
  const diff = strict(o.diff, [
    "sha256",
    "insertions",
    "deletions",
    "binaryFiles",
  ]);
  const blocked = strict(o.blockedSafety, [
    "boundary",
    "network",
    "destructive",
  ]);
  const result: ImplementationArmResultV1 = {
    caseId: text(o.caseId, 80),
    arm: enumValue(o.arm, ["control", "treatment"] as const),
    order: integer(o.order, 0, 1) as 0 | 1,
    status: enumValue(o.status, ["completed", "failed", "invalid"] as const),
    errorCode: enumValue(o.errorCode, [
      "NONE",
      "MODEL_FAILED",
      "MODEL_TIMEOUT",
      "VALIDATION_FAILED",
      "ASSERTION_FAILED",
      "INVALID_CASE",
      "INVALID_FIXTURE",
      "INVALID_BASELINE",
      "INVALID_ISOLATION",
      "INVALID_MODEL",
      "INVALID_REPORT",
    ] as const),
    taskSuccess: bool(o.taskSuccess),
    validationPassed: integer(o.validationPassed, 0, 8),
    validationTotal: integer(o.validationTotal, 0, 8),
    assertionPassed: integer(o.assertionPassed, 0, 1),
    assertionTotal: integer(o.assertionTotal, 0, 1),
    forbiddenViolation: bool(o.forbiddenViolation),
    scopeViolation: bool(o.scopeViolation),
    expectedClarification: enumValue(o.expectedClarification, [
      "none",
      "required",
    ] as const),
    observedClarification: bool(o.observedClarification),
    touchedPaths,
    touchedCount: integer(o.touchedCount, 0, 20),
    diff: {
      sha256: hash(diff.sha256),
      insertions: integer(diff.insertions),
      deletions: integer(diff.deletions),
      binaryFiles: integer(diff.binaryFiles, 0, 20),
    },
    implementationLatencyMs: integer(o.implementationLatencyMs, 0, 300_000),
    treatmentCompilationLatencyMs: nullableFinite(
      o.treatmentCompilationLatencyMs,
      300_000,
    ),
    turns: integer(o.turns, 0, 100),
    toolCalls: integer(o.toolCalls, 0, 500),
    repeatedMutations: nullableFinite(o.repeatedMutations, 500),
    inputTokens: nullableFinite(o.inputTokens),
    outputTokens: nullableFinite(o.outputTokens),
    costUsd: nullableFinite(o.costUsd, 100_000),
    blockedSafety: {
      boundary: integer(blocked.boundary, 0, 500),
      network: integer(blocked.network, 0, 500),
      destructive: integer(blocked.destructive, 0, 500),
    },
    responseLanguageSafety: enumValue(o.responseLanguageSafety, [
      "unavailable",
    ] as const),
    fixtureRevision: gitHash(o.fixtureRevision),
    fixtureTree: gitHash(o.fixtureTree),
  };
  if (
    result.touchedCount !== touchedPaths.length ||
    result.validationPassed > result.validationTotal ||
    result.assertionPassed > result.assertionTotal ||
    (result.status === "completed") !== (result.errorCode === "NONE") ||
    (result.taskSuccess && result.status !== "completed") ||
    (result.arm === "control" && result.treatmentCompilationLatencyMs !== null)
  )
    fail();
  return result;
}

export function aggregateImplementationOutcomes(
  pairs: readonly ImplementationCasePairV1[],
): ImplementationOutcomeAggregatesV1 {
  const aggregate = (arm: ImplementationArm): ImplementationArmAggregatesV1 => {
    const all = pairs.map((pair) => {
      const result = pair.arms.find((item) => item.arm === arm);
      return result ?? fail();
    });
    const valid = all.filter((item) => item.status !== "invalid");
    const rate = (count: number): OutcomeMetric => ({
      value: valid.length ? count / valid.length : null,
      denominator: valid.length,
    });
    return {
      valid: valid.length,
      invalid: all.length - valid.length,
      taskSuccessRate: rate(valid.filter((item) => item.taskSuccess).length),
      scopeViolationRate: rate(
        valid.filter((item) => item.scopeViolation).length,
      ),
      forbiddenViolationRate: rate(
        valid.filter((item) => item.forbiddenViolation).length,
      ),
      averageLatencyMs: {
        value: valid.length
          ? valid.reduce((sum, item) => sum + item.implementationLatencyMs, 0) /
            valid.length
          : null,
        denominator: valid.length,
      },
    };
  };
  const control = aggregate("control");
  const treatment = aggregate("treatment");
  const delta = (a: number | null, b: number | null) =>
    a === null || b === null ? null : a - b;
  return {
    control,
    treatment,
    pairedTreatmentMinusControl: {
      taskSuccessRate: delta(
        treatment.taskSuccessRate.value,
        control.taskSuccessRate.value,
      ),
      scopeViolationRate: delta(
        treatment.scopeViolationRate.value,
        control.scopeViolationRate.value,
      ),
      forbiddenViolationRate: delta(
        treatment.forbiddenViolationRate.value,
        control.forbiddenViolationRate.value,
      ),
      averageLatencyMs: delta(
        treatment.averageLatencyMs.value,
        control.averageLatencyMs.value,
      ),
    },
  };
}

export function parseImplementationOutcomeReportV1(
  value: unknown,
): ImplementationOutcomeReportV1 {
  const o = strict(value, [
    "version",
    "runner",
    "runConfigHash",
    "pi",
    "bridge",
    "corpus",
    "seed",
    "order",
    "isolation",
    "ownerReview",
    "pairs",
    "aggregates",
  ]);
  if (
    o.version !== IMPLEMENTATION_OUTCOME_VERSION ||
    o.runner !== IMPLEMENTATION_OUTCOME_RUNNER ||
    o.ownerReview !== "not_reviewed"
  )
    fail();
  const runConfigHash = hash(o.runConfigHash);
  const pi = strict(o.pi, ["packageVersion", "provider", "model", "thinking"]);
  const bridge = strict(o.bridge, [
    "provider",
    "model",
    "schemaVersion",
    "promptVersion",
    "compilerVersion",
    "policyVersion",
  ]);
  const corpus = strict(o.corpus, ["sha256", "orderedCaseIds"]);
  const isolation = strict(o.isolation, ["mode", "policyHash"]);
  if (!Array.isArray(o.pairs) || o.pairs.length < 1 || o.pairs.length > 100)
    fail();
  const pairValues = o.pairs as unknown[];
  const pairs = pairValues.map((value): ImplementationCasePairV1 => {
    const pair = strict(value, [
      "caseId",
      "configHash",
      "fixtureRevision",
      "fixtureTree",
      "order",
      "arms",
    ]);
    if (
      !Array.isArray(pair.order) ||
      pair.order.length !== 2 ||
      !Array.isArray(pair.arms) ||
      pair.arms.length !== 2
    )
      fail();
    const orderValues = pair.order as unknown[];
    const armValues = pair.arms as unknown[];
    const order = orderValues.map((arm) =>
      enumValue(arm, ["control", "treatment"] as const),
    ) as [ImplementationArm, ImplementationArm];
    const arms = armValues.map(parseArm) as [
      ImplementationArmResultV1,
      ImplementationArmResultV1,
    ];
    const caseId = text(pair.caseId, 80);
    const fixtureRevision = gitHash(pair.fixtureRevision);
    const fixtureTree = gitHash(pair.fixtureTree);
    if (
      new Set(order).size !== 2 ||
      new Set(arms.map((arm) => arm.arm)).size !== 2 ||
      arms.some(
        (arm) =>
          arm.caseId !== caseId ||
          arm.fixtureRevision !== fixtureRevision ||
          arm.fixtureTree !== fixtureTree,
      ) ||
      arms.some((arm) => order[arm.order] !== arm.arm)
    )
      fail();
    return {
      caseId,
      configHash: hash(pair.configHash),
      fixtureRevision,
      fixtureTree,
      order,
      arms,
    };
  });
  if (
    new Set(pairs.map((pair) => pair.caseId)).size !== pairs.length ||
    new Set(pairs.map((pair) => pair.configHash)).size !== 1 ||
    pairs.some((pair) => pair.configHash !== runConfigHash)
  )
    fail();
  const orderedCaseIds = Array.isArray(corpus.orderedCaseIds)
    ? corpus.orderedCaseIds.map((id) => text(id, 80))
    : fail();
  if (
    orderedCaseIds.length !== pairs.length ||
    orderedCaseIds.some((id, index) => id !== pairs[index]?.caseId)
  )
    fail();
  const aggregateObject = strict(o.aggregates, [
    "control",
    "treatment",
    "pairedTreatmentMinusControl",
  ]);
  const deltas = strict(aggregateObject.pairedTreatmentMinusControl, [
    "taskSuccessRate",
    "scopeViolationRate",
    "forbiddenViolationRate",
    "averageLatencyMs",
  ]);
  const signed = (value: unknown, max: number): number | null => {
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value)) fail();
    const numberValue = value as number;
    const absolute = nullableFinite(Math.abs(numberValue), max);
    return (absolute ?? fail()) * Math.sign(numberValue);
  };
  const parsedAggregates: ImplementationOutcomeAggregatesV1 = {
    control: armAggregates(aggregateObject.control),
    treatment: armAggregates(aggregateObject.treatment),
    pairedTreatmentMinusControl: {
      taskSuccessRate: signed(deltas.taskSuccessRate, 1),
      scopeViolationRate: signed(deltas.scopeViolationRate, 1),
      forbiddenViolationRate: signed(deltas.forbiddenViolationRate, 1),
      averageLatencyMs: signed(deltas.averageLatencyMs, 300_000),
    },
  };
  const canonical = aggregateImplementationOutcomes(pairs);
  if (JSON.stringify(parsedAggregates) !== JSON.stringify(canonical))
    fail("IMPLEMENTATION_AGGREGATES_INCONSISTENT");
  if (
    !Array.isArray(o.order) ||
    o.order.length !== pairs.length ||
    o.order.some((id, i) => id !== orderedCaseIds[i])
  )
    fail();
  return {
    version: IMPLEMENTATION_OUTCOME_VERSION,
    runner: IMPLEMENTATION_OUTCOME_RUNNER,
    runConfigHash,
    pi: {
      packageVersion: enumValue(pi.packageVersion, ["0.80.10"] as const),
      provider: text(pi.provider),
      model: text(pi.model),
      thinking: enumValue(pi.thinking, [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ] as const),
    },
    bridge: {
      provider: text(bridge.provider),
      model: text(bridge.model),
      schemaVersion: enumValue(bridge.schemaVersion, ["2"] as const),
      promptVersion: text(bridge.promptVersion),
      compilerVersion: enumValue(bridge.compilerVersion, ["pi-v2"] as const),
      policyVersion: text(bridge.policyVersion),
    },
    corpus: { sha256: hash(corpus.sha256), orderedCaseIds },
    seed: text(o.seed, 100),
    order: [...orderedCaseIds],
    isolation: {
      mode: enumValue(isolation.mode, ["external-policy-sandbox"] as const),
      policyHash: hash(isolation.policyHash),
    },
    ownerReview: "not_reviewed",
    pairs,
    aggregates: parsedAggregates,
  };
}
