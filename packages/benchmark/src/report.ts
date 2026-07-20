import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REDACTION_MARKER, redactSecrets } from "@intent-bridge/core";
import {
  parseBenchmarkCaseV1,
  parseBenchmarkReport,
  parseBenchmarkReportV2,
  parseOwnerReviewV1,
  type BenchmarkAggregatesV1,
  type BenchmarkAggregatesV2,
  type BenchmarkCaseV1,
  type BenchmarkCorpusMetadataV1,
  type BenchmarkReport,
  type BenchmarkReportV1,
  type BenchmarkReportV2,
  type BenchmarkResultV1,
  type Metric,
  type OwnerReviewV1,
} from "./contracts.js";
import {
  deterministicSafetyCheckNames,
  isSafetyCase,
  structuralCheckNames,
} from "./invariants.js";

const rate = (numerator: number, denominator: number): Metric => ({
  value: denominator ? numerator / denominator : null,
  denominator,
});
const average = (values: number[]): Metric => ({
  value: values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null,
  denominator: values.length,
});
/** Nearest-rank percentile: sortedValues[ceil(p * n) - 1]. */
export function nearestRank(
  sortedValues: readonly number[],
  percentile: number,
): number | null {
  if (!sortedValues.length) return null;
  return (
    sortedValues[
      Math.max(0, Math.ceil(percentile * sortedValues.length) - 1)
    ] ?? null
  );
}
const finiteValues = (values: (number | undefined)[]) =>
  values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
const checkPassed = (result: BenchmarkResultV1, name: string) =>
  result.invariant.checks.find((check) => check.name === name)?.passed === true;
const safeSha256Keys = new Set([
  "sourceReportSha256",
  "caseIdSequenceSha256",
  "contentSha256",
]);

export function createCorpusMetadata(
  cases: readonly BenchmarkCaseV1[],
): BenchmarkCorpusMetadataV1 {
  const parsed = cases.map(parseBenchmarkCaseV1);
  const canonical = parsed.map((item) => ({
    version: item.version,
    id: item.id,
    title: item.title,
    language: item.language,
    messageType: item.messageType,
    input: item.input,
    ...(item.attachments ? { attachments: item.attachments } : {}),
    ...(item.contextFixture ? { contextFixture: item.contextFixture } : {}),
    expected: item.expected,
    tags: item.tags,
  }));
  return {
    total: parsed.length,
    caseIdSequenceSha256: createHash("sha256")
      .update(JSON.stringify(parsed.map((item) => item.id)))
      .digest("hex"),
    contentSha256: createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex"),
  };
}

export function createReport(
  input: Omit<BenchmarkReportV1, "version" | "aggregates" | "thresholds">,
): BenchmarkReportV1 {
  const results = input.results;
  const attempted = results.filter((result) => result.status !== "skipped");
  const transformed = attempted.filter(
    (result) => result.status === "transformed",
  );
  const failOpen = attempted.filter((result) => result.status === "fail_open");
  const invariantPasses = attempted.filter((result) => result.invariant.passed);
  const safety = attempted.filter((result) =>
    result.tags.some((tag) =>
      ["paths-commands", "secret-like", "command"].includes(tag),
    ),
  );
  const latencies = finiteValues(
    transformed.map((result) => result.latencyMs),
  ).sort((left, right) => left - right);
  const usage = transformed.filter((result) => result.tokenUsage !== undefined);
  const usageValues = (key: "input" | "output" | "total") =>
    finiteValues(usage.map((result) => result.tokenUsage?.[key]));
  const costs = finiteValues(
    transformed.map((result) => result.estimatedCostUsd),
  );
  const quality = transformed.flatMap((result) =>
    result.quality ? [result.quality] : [],
  );
  const qualityRate = (
    key: keyof Pick<
      NonNullable<BenchmarkResultV1["quality"]>,
      | "schemaValid"
      | "languagePresent"
      | "hasGoal"
      | "constraintsSeparated"
      | "assumptionsSeparated"
      | "ambiguitiesTyped"
      | "compilerValid"
    >,
  ) => rate(quality.filter((signals) => signals[key]).length, quality.length);
  const evaluations = transformed.flatMap((result) =>
    result.evaluation ? [result.evaluation] : [],
  );
  const ratings = evaluations.filter(
    (evaluation) => evaluation.rating !== undefined,
  );
  const forbidden = attempted.filter((result) =>
    result.invariant.checks.some(
      (check) => check.name === "forbidden_additions",
    ),
  );
  const forbiddenFailures = forbidden.filter(
    (result) => !checkPassed(result, "forbidden_additions"),
  ).length;
  const languagePasses = transformed.filter((result) =>
    checkPassed(result, "response_language"),
  ).length;
  const inputTokens = usageValues("input");
  const outputTokens = usageValues("output");
  const totalTokens = usageValues("total");
  const sum = (values: number[]) =>
    values.reduce((total, value) => total + value, 0);
  const aggregates: BenchmarkAggregatesV1 = {
    total: results.length,
    attempted: attempted.length,
    transformed: transformed.length,
    failOpen: failOpen.length,
    skipped: results.length - attempted.length,
    schemaValidRate: rate(transformed.length, attempted.length),
    invariantPassRate: rate(invariantPasses.length, attempted.length),
    failOpenRate: rate(failOpen.length, attempted.length),
    latencyP50: nearestRank(latencies, 0.5),
    latencyP95: nearestRank(latencies, 0.95),
    inputTokens: sum(inputTokens),
    outputTokens: sum(outputTokens),
    totalTokens: sum(totalTokens),
    averageInputTokens: inputTokens.length
      ? sum(inputTokens) / inputTokens.length
      : null,
    averageOutputTokens: outputTokens.length
      ? sum(outputTokens) / outputTokens.length
      : null,
    averageTotalTokens: totalTokens.length
      ? sum(totalTokens) / totalTokens.length
      : null,
    missingUsageCount: transformed.length - usage.length,
    totalCostUsd: costs.length ? sum(costs) : null,
    averageCostUsd: costs.length ? sum(costs) / costs.length : null,
    missingCostCount: transformed.length - costs.length,
    qualitySchemaValidRate: qualityRate("schemaValid"),
    qualityLanguagePresentRate: qualityRate("languagePresent"),
    qualityHasGoalRate: qualityRate("hasGoal"),
    qualityConstraintsSeparatedRate: qualityRate("constraintsSeparated"),
    qualityAssumptionsSeparatedRate: qualityRate("assumptionsSeparated"),
    qualityAmbiguitiesTypedRate: qualityRate("ambiguitiesTyped"),
    qualityCompilerValidRate: qualityRate("compilerValid"),
    averageTaskCount: average(quality.map((signals) => signals.taskCount)),
    averageProviderConfidence: average(
      finiteValues(quality.map((signals) => signals.providerConfidence)),
    ),
    forbiddenAdditionFailureCount: forbiddenFailures,
    forbiddenAdditionFailureRate: rate(forbiddenFailures, forbidden.length),
    languagePreservationRate: rate(languagePasses, transformed.length),
    evaluatedCount: evaluations.length,
    evaluatorMaterialIntentAlterationRate: rate(
      evaluations.filter((evaluation) => evaluation.intentAltered).length,
      evaluations.length,
    ),
    evaluatorClearerOrEqualRate: rate(
      evaluations.filter((evaluation) => evaluation.clarity !== "less_clear")
        .length,
      evaluations.length,
    ),
    evaluatorGoodRatingRate: rate(
      ratings.filter((evaluation) => evaluation.rating === "good").length,
      ratings.length,
    ),
    humanRatingRate: rate(0, 0),
    userRatingRate: rate(0, 0),
  };
  const threshold = (
    available: boolean,
    passed: boolean,
    denominator: number,
  ) => ({
    status: available
      ? passed
        ? ("pass" as const)
        : ("fail" as const)
      : ("unavailable" as const),
    denominator,
  });
  return {
    version: 1,
    ...input,
    aggregates,
    thresholds: {
      invariants: threshold(
        aggregates.invariantPassRate.value !== null,
        (aggregates.invariantPassRate.value ?? 0) >= 0.9,
        attempted.length,
      ),
      materialAlteration: threshold(
        evaluations.length > 0,
        evaluations.filter((evaluation) => evaluation.intentAltered).length /
          Math.max(1, evaluations.length) <=
          0.05,
        evaluations.length,
      ),
      clarity: threshold(
        evaluations.length > 0,
        evaluations.filter((evaluation) => evaluation.clarity !== "less_clear")
          .length /
          Math.max(1, evaluations.length) >=
          0.8,
        evaluations.length,
      ),
      language: threshold(
        transformed.length > 0,
        languagePasses === transformed.length,
        transformed.length,
      ),
      safety: threshold(
        safety.length > 0,
        safety.every((result) => result.invariant.passed),
        safety.length,
      ),
    },
  };
}

const v2SharedAggregates = ({
  invariantPassRate: _invariantPassRate,
  humanRatingRate: _humanRatingRate,
  userRatingRate: _userRatingRate,
  ...aggregates
}: BenchmarkAggregatesV1) => aggregates;

export function createReportV2(
  input: Omit<
    BenchmarkReportV2,
    "version" | "runnerVersion" | "ownerReview" | "aggregates" | "thresholds"
  >,
): BenchmarkReportV2 {
  const { corpus, evaluator, ...reportInput } = input;
  const base = createReport({
    ...reportInput,
    runnerVersion: "benchmark-v1",
  });
  const results = input.results;
  const attempted = results.filter((result) => result.status !== "skipped");
  const transformed = results.filter(
    (result) => result.status === "transformed",
  );
  const passed = (result: BenchmarkResultV1, name: string) =>
    result.invariant.checks.find((check) => check.name === name)?.passed ===
    true;
  const structuralPasses = attempted.filter(
    (result) =>
      result.status === "transformed" &&
      structuralCheckNames.every((name) => passed(result, name)),
  ).length;
  const literalRate = (name: string) =>
    rate(
      transformed.filter((result) => passed(result, name)).length,
      transformed.length,
    );
  const safetyCases = attempted.filter(isSafetyCase);
  const safetyPasses = safetyCases.filter((result) =>
    deterministicSafetyCheckNames.every((name) => passed(result, name)),
  ).length;
  const evaluatorEvidence = transformed.some(
    (result) => result.evaluation || result.evaluatorError,
  );
  const evaluations = transformed.filter(
    (result) => result.evaluation !== undefined,
  );
  const evaluatorMetric = (numerator: number) =>
    evaluatorEvidence ? rate(numerator, transformed.length) : rate(0, 0);
  const aggregates: BenchmarkAggregatesV2 = {
    ...v2SharedAggregates(base.aggregates),
    structuralPassRate: rate(structuralPasses, attempted.length),
    literalGoalDiagnosticRate: literalRate("literal_goal_concepts"),
    literalConstraintDiagnosticRate: literalRate("literal_constraints"),
    deterministicSafetyPassRate: rate(safetyPasses, safetyCases.length),
    languagePreservationRate: rate(
      transformed.filter((result) => passed(result, "response_language"))
        .length,
      transformed.length,
    ),
    evaluatedCount: evaluations.length,
    evaluatorCoverageRate: evaluatorMetric(evaluations.length),
    evaluatorMaterialIntentAlterationRate: evaluatorMetric(
      transformed.filter(
        (result) => !result.evaluation || result.evaluation.intentAltered,
      ).length,
    ),
    evaluatorClearerOrEqualRate: evaluatorMetric(
      transformed.filter(
        (result) =>
          result.evaluation?.clarity !== undefined &&
          result.evaluation.clarity !== "less_clear",
      ).length,
    ),
    ownerReviewCoverageRate: rate(0, 0),
    ownerMaterialIntentAlterationRate: rate(0, 0),
    ownerClearerOrEqualRate: rate(0, 0),
  };
  const threshold = (
    available: boolean,
    passed: boolean,
    denominator: number,
  ) => ({
    status: available
      ? passed
        ? ("pass" as const)
        : ("fail" as const)
      : ("unavailable" as const),
    denominator,
  });
  return {
    ...base,
    version: 2,
    runnerVersion: "benchmark-v2",
    ...(corpus ? { corpus } : {}),
    ...(evaluator ? { evaluator } : {}),
    aggregates,
    thresholds: {
      structural: threshold(
        aggregates.structuralPassRate.value !== null,
        (aggregates.structuralPassRate.value ?? 0) >= 0.9,
        attempted.length,
      ),
      language: threshold(
        aggregates.languagePreservationRate.value !== null,
        aggregates.languagePreservationRate.value === 1,
        transformed.length,
      ),
      deterministicSafety: threshold(
        aggregates.deterministicSafetyPassRate.value !== null,
        aggregates.deterministicSafetyPassRate.value === 1,
        safetyCases.length,
      ),
      evaluatorCoverage: threshold(
        evaluatorEvidence,
        aggregates.evaluatorCoverageRate.value === 1,
        transformed.length,
      ),
      evaluatorMaterialAlteration: threshold(
        evaluatorEvidence,
        (aggregates.evaluatorMaterialIntentAlterationRate.value ?? 1) <= 0.05,
        transformed.length,
      ),
      evaluatorClarity: threshold(
        evaluatorEvidence,
        (aggregates.evaluatorClearerOrEqualRate.value ?? 0) >= 0.8,
        transformed.length,
      ),
      ownerCoverage: threshold(false, false, 0),
      ownerMaterialAlteration: threshold(false, false, 0),
      ownerClarity: threshold(false, false, 0),
      ownerAcceptance: threshold(false, false, 0),
    },
  };
}

function assertReportV2Consistent(report: BenchmarkReportV2): void {
  const canonical = createReportV2({
    profile: report.profile,
    schemaVersion: report.schemaVersion,
    promptVersion: report.promptVersion,
    compilerVersion: report.compilerVersion,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    concurrency: report.concurrency,
    results: report.results,
    ...(report.corpus ? { corpus: report.corpus } : {}),
    ...(report.evaluator ? { evaluator: report.evaluator } : {}),
  });
  const baseAggregateKeys = Object.keys(canonical.aggregates).filter(
    (key) =>
      ![
        "ownerReviewCoverageRate",
        "ownerMaterialIntentAlterationRate",
        "ownerClearerOrEqualRate",
      ].includes(key),
  ) as (keyof BenchmarkAggregatesV2)[];
  const baseThresholdKeys = Object.keys(canonical.thresholds).filter(
    (key) =>
      ![
        "ownerCoverage",
        "ownerMaterialAlteration",
        "ownerClarity",
        "ownerAcceptance",
      ].includes(key),
  ) as (keyof BenchmarkReportV2["thresholds"])[];
  if (
    (report.corpus !== undefined &&
      (report.corpus.total !== report.results.length ||
        report.corpus.caseIdSequenceSha256 !==
          createHash("sha256")
            .update(
              JSON.stringify(report.results.map((result) => result.caseId)),
            )
            .digest("hex"))) ||
    baseAggregateKeys.some(
      (key) =>
        JSON.stringify(report.aggregates[key]) !==
        JSON.stringify(canonical.aggregates[key]),
    ) ||
    baseThresholdKeys.some(
      (key) =>
        JSON.stringify(report.thresholds[key]) !==
        JSON.stringify(canonical.thresholds[key]),
    )
  )
    throw new Error("BENCHMARK_REPORT_INCONSISTENT");
}

export function benchmarkReportSha256(report: BenchmarkReportV2): string {
  const source = parseBenchmarkReportV2(report);
  assertReportV2Consistent(source);
  if (source.ownerReview) throw new Error("OWNER_REVIEW_ALREADY_APPLIED");
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

export function applyOwnerReview(
  report: BenchmarkReportV2,
  review: OwnerReviewV1,
): BenchmarkReportV2 {
  const source = parseBenchmarkReportV2(report);
  assertReportV2Consistent(source);
  if (source.ownerReview) throw new Error("OWNER_REVIEW_ALREADY_APPLIED");
  const parsedReview = parseOwnerReviewV1(review);
  if (parsedReview.sourceReportSha256 !== benchmarkReportSha256(source))
    throw new Error("OWNER_REVIEW_HASH_MISMATCH");
  if (parsedReview.cases.some((item) => item.profileId !== source.profile.id))
    throw new Error("OWNER_REVIEW_PROFILE_MISMATCH");
  const transformed = source.results.filter(
    (result) => result.status === "transformed",
  );
  if (!transformed.length) throw new Error("OWNER_REVIEW_NO_TRANSFORMED_CASES");
  const expected = new Set(transformed.map((result) => result.caseId));
  const actual = new Set(parsedReview.cases.map((item) => item.caseId));
  if (
    expected.size !== transformed.length ||
    actual.size !== parsedReview.cases.length ||
    actual.size !== expected.size ||
    [...actual].some((caseId) => !expected.has(caseId))
  )
    throw new Error("OWNER_REVIEW_CASE_COVERAGE_INVALID");
  const denominator = transformed.length;
  const altered = parsedReview.cases.filter(
    (item) => item.intentAltered,
  ).length;
  const clear = parsedReview.cases.filter(
    (item) => item.clarity !== "less_clear",
  ).length;
  const accepted =
    parsedReview.manualAcceptance === "pass" &&
    parsedReview.cases.every((item) => item.accepted);
  return {
    ...source,
    ownerReview: {
      sourceReportSha256: parsedReview.sourceReportSha256,
      reviewerKind: parsedReview.reviewerKind,
      reviewedAt: parsedReview.reviewedAt,
      manualAcceptance: parsedReview.manualAcceptance,
    },
    aggregates: {
      ...source.aggregates,
      ownerReviewCoverageRate: rate(denominator, denominator),
      ownerMaterialIntentAlterationRate: rate(altered, denominator),
      ownerClearerOrEqualRate: rate(clear, denominator),
    },
    thresholds: {
      ...source.thresholds,
      ownerCoverage: { status: "pass", denominator },
      ownerMaterialAlteration: {
        status: altered / denominator <= 0.05 ? "pass" : "fail",
        denominator,
      },
      ownerClarity: {
        status: clear / denominator >= 0.8 ? "pass" : "fail",
        denominator,
      },
      ownerAcceptance: {
        status: accepted ? "pass" : "fail",
        denominator: 1,
      },
    },
  };
}

export function renderTerminal(report: BenchmarkReport): string {
  if (report.version === 1)
    return `${report.profile.id} (${report.profile.model}) ${report.aggregates.transformed}/${report.aggregates.total} transformed; invariants ${JSON.stringify(report.aggregates.invariantPassRate)}; p50 ${report.aggregates.latencyP50 ?? "unavailable"}`;
  return `${report.profile.id} (${report.profile.model}) ${report.aggregates.transformed}/${report.aggregates.total} transformed; structural ${JSON.stringify(report.aggregates.structuralPassRate)} (${report.thresholds.structural.status}); language ${JSON.stringify(report.aggregates.languagePreservationRate)} (${report.thresholds.language.status}); safety ${JSON.stringify(report.aggregates.deterministicSafetyPassRate)} (${report.thresholds.deterministicSafety.status}); evaluator coverage ${JSON.stringify(report.aggregates.evaluatorCoverageRate)} (${report.thresholds.evaluatorCoverage.status}), alteration ${JSON.stringify(report.aggregates.evaluatorMaterialIntentAlterationRate)} (${report.thresholds.evaluatorMaterialAlteration.status}), clarity ${JSON.stringify(report.aggregates.evaluatorClearerOrEqualRate)} (${report.thresholds.evaluatorClarity.status}); owner acceptance ${report.thresholds.ownerAcceptance.status}; diagnostics (non-gating) literal goals ${JSON.stringify(report.aggregates.literalGoalDiagnosticRate)}, literal constraints ${JSON.stringify(report.aggregates.literalConstraintDiagnosticRate)}; p50 ${report.aggregates.latencyP50 ?? "unavailable"}`;
}
export function renderMarkdown(report: BenchmarkReport): string {
  if (report.version === 1) {
    const failures = report.results
      .filter(
        (result) => !result.invariant.passed && result.status !== "skipped",
      )
      .map(
        (result) =>
          `${result.caseId} (${result.invariant.checks
            .filter((check) => !check.passed)
            .map((check) => check.name)
            .join(",")})`,
      )
      .join(", ");
    return `# Benchmark ${report.profile.id}\n\nModel: ${report.profile.model}\n\n${renderTerminal(report)}\n\nFailures: ${failures || "none"}\n`;
  }
  const gateFailures = report.results
    .filter((result) => result.status !== "skipped")
    .flatMap((result) => {
      const failures: string[] = [];
      if (result.status !== "transformed")
        failures.push(`structural: status=${result.status}`);
      else {
        const checks = structuralCheckNames.filter(
          (name) => !checkPassed(result, name),
        );
        if (checks.length) failures.push(`structural: ${checks.join(",")}`);
      }
      if (isSafetyCase(result)) {
        const checks = deterministicSafetyCheckNames.filter(
          (name) => !checkPassed(result, name),
        );
        if (checks.length) failures.push(`safety: ${checks.join(",")}`);
      }
      return failures.length
        ? [`${result.caseId} (${failures.join("; ")})`]
        : [];
    })
    .join(", ");
  return `# Benchmark ${report.profile.id}\n\nModel: ${report.profile.model}\n\n${renderTerminal(report)}\n\nGate failures: ${gateFailures || "none"}\n\nDiagnostics (non-gating): literal goals ${JSON.stringify(report.aggregates.literalGoalDiagnosticRate)}; literal constraints ${JSON.stringify(report.aggregates.literalConstraintDiagnosticRate)}\n`;
}

type Comparable = {
  profileId: string;
  invariantPassRate: number | null;
  structuralPassRate: number | null;
  deterministicSafetyPassRate: number | null;
  evaluatorMaterialIntentAlterationRate: number | null;
  evaluatorClearerOrEqualRate: number | null;
  failOpenRate: number | null;
  latencyP50: number | null;
  totalCostUsd: number | null;
};
const summary = (report: BenchmarkReport): Comparable => ({
  profileId: report.profile.id,
  invariantPassRate:
    report.version === 1 ? report.aggregates.invariantPassRate.value : null,
  structuralPassRate:
    report.version === 2 ? report.aggregates.structuralPassRate.value : null,
  deterministicSafetyPassRate:
    report.version === 2
      ? report.aggregates.deterministicSafetyPassRate.value
      : null,
  evaluatorMaterialIntentAlterationRate:
    report.aggregates.evaluatorMaterialIntentAlterationRate.value,
  evaluatorClearerOrEqualRate:
    report.aggregates.evaluatorClearerOrEqualRate.value,
  failOpenRate: report.aggregates.failOpenRate.value,
  latencyP50: report.aggregates.latencyP50,
  totalCostUsd: report.aggregates.totalCostUsd,
});
const compareNullable = (
  left: number | null,
  right: number | null,
  direction: 1 | -1,
) => {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return direction * (left - right);
};
const delta = (a: number | null, b: number | null) =>
  a === null || b === null ? null : a - b;
export function compareReports(
  leftReport: BenchmarkReport,
  rightReport: BenchmarkReport,
) {
  const leftReportParsed = parseBenchmarkReport(leftReport);
  const rightReportParsed = parseBenchmarkReport(rightReport);
  if (leftReportParsed.version === 2)
    assertReportV2Consistent(leftReportParsed);
  if (rightReportParsed.version === 2)
    assertReportV2Consistent(rightReportParsed);
  if (leftReportParsed.version !== rightReportParsed.version)
    throw new Error("BENCHMARK_REPORT_VERSION_MISMATCH");
  const leftIds = leftReportParsed.results.map((result) => result.caseId);
  const rightIds = rightReportParsed.results.map((result) => result.caseId);
  if (
    new Set(leftIds).size !== leftIds.length ||
    new Set(rightIds).size !== rightIds.length ||
    leftIds.length !== rightIds.length ||
    leftIds.some((id, index) => id !== rightIds[index])
  )
    throw new Error("BENCHMARK_CORPUS_MISMATCH");
  if (leftReportParsed.version === 2 && rightReportParsed.version === 2) {
    if (
      Boolean(leftReportParsed.corpus) !== Boolean(rightReportParsed.corpus) ||
      (leftReportParsed.corpus &&
        rightReportParsed.corpus &&
        JSON.stringify(leftReportParsed.corpus) !==
          JSON.stringify(rightReportParsed.corpus))
    )
      throw new Error("BENCHMARK_CORPUS_MISMATCH");
    const leftEvaluator = leftReportParsed.evaluator ?? null;
    const rightEvaluator = rightReportParsed.evaluator ?? null;
    if (Boolean(leftEvaluator) !== Boolean(rightEvaluator))
      throw new Error("BENCHMARK_EVALUATOR_CONFIG_MISMATCH");
    if (leftEvaluator && rightEvaluator) {
      if (
        leftEvaluator.provider !== rightEvaluator.provider ||
        leftEvaluator.model !== rightEvaluator.model ||
        leftEvaluator.promptVersion !== rightEvaluator.promptVersion ||
        (leftEvaluator.reasoning ?? null) !== (rightEvaluator.reasoning ?? null)
      )
        throw new Error("BENCHMARK_EVALUATOR_CONFIG_MISMATCH");
    }
  }
  const left = summary(leftReportParsed);
  const right = summary(rightReportParsed);
  const v2 = leftReportParsed.version === 2;
  const metricOrder = v2
    ? compareNullable(left.structuralPassRate, right.structuralPassRate, -1) ||
      compareNullable(
        left.deterministicSafetyPassRate,
        right.deterministicSafetyPassRate,
        -1,
      ) ||
      compareNullable(
        left.evaluatorMaterialIntentAlterationRate,
        right.evaluatorMaterialIntentAlterationRate,
        1,
      ) ||
      compareNullable(
        left.evaluatorClearerOrEqualRate,
        right.evaluatorClearerOrEqualRate,
        -1,
      ) ||
      compareNullable(left.failOpenRate, right.failOpenRate, 1) ||
      compareNullable(left.latencyP50, right.latencyP50, 1) ||
      compareNullable(left.totalCostUsd, right.totalCostUsd, 1)
    : compareNullable(left.invariantPassRate, right.invariantPassRate, -1) ||
      compareNullable(left.failOpenRate, right.failOpenRate, 1) ||
      compareNullable(left.latencyP50, right.latencyP50, 1) ||
      compareNullable(left.totalCostUsd, right.totalCostUsd, 1);
  const ownerUnavailable =
    leftReportParsed.version === 2 &&
    rightReportParsed.version === 2 &&
    (leftReportParsed.thresholds.ownerAcceptance.status === "unavailable" ||
      rightReportParsed.thresholds.ownerAcceptance.status === "unavailable");
  const tie = ownerUnavailable || metricOrder === 0;
  const order = metricOrder || left.profileId.localeCompare(right.profileId);
  const orderedProfiles = order <= 0 ? [left, right] : [right, left];
  return {
    orderedProfiles,
    winner: tie ? null : (orderedProfiles[0]?.profileId ?? null),
    tie,
    deltas: {
      invariantPassRate: delta(left.invariantPassRate, right.invariantPassRate),
      structuralPassRate: delta(
        left.structuralPassRate,
        right.structuralPassRate,
      ),
      deterministicSafetyPassRate: delta(
        left.deterministicSafetyPassRate,
        right.deterministicSafetyPassRate,
      ),
      evaluatorMaterialIntentAlterationRate: delta(
        left.evaluatorMaterialIntentAlterationRate,
        right.evaluatorMaterialIntentAlterationRate,
      ),
      evaluatorClearerOrEqualRate: delta(
        left.evaluatorClearerOrEqualRate,
        right.evaluatorClearerOrEqualRate,
      ),
      failOpenRate: delta(left.failOpenRate, right.failOpenRate),
      latencyP50: delta(left.latencyP50, right.latencyP50),
      totalCostUsd: delta(left.totalCostUsd, right.totalCostUsd),
    },
  };
}

export function sanitize<T>(value: T): T {
  const visit = (entry: unknown, key = ""): unknown => {
    if (/authorization|api[_-]?key|secret|password|headers?|config/i.test(key))
      return REDACTION_MARKER;
    if (
      safeSha256Keys.has(key) &&
      typeof entry === "string" &&
      /^[0-9a-f]{64}$/.test(entry)
    )
      return entry;
    if (typeof entry === "string")
      return redactSecrets(entry).text.slice(0, 1000);
    if (Array.isArray(entry))
      return entry.slice(0, 1000).map((item) => visit(item));
    if (entry && typeof entry === "object")
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>).map(([name, item]) => [
          name,
          visit(item, name),
        ]),
      );
    return entry;
  };
  return visit(value) as T;
}
export async function writeReport(dir: string, report: BenchmarkReport) {
  const validReport = parseBenchmarkReport(report);
  if (validReport.version === 2) assertReportV2Consistent(validReport);
  await mkdir(dir, { recursive: true });
  const id = validReport.profile.id.replace(/[^a-z0-9_-]/gi, "-");
  await Promise.all([
    writeFile(
      join(dir, `${id}-report.json`),
      `${JSON.stringify(sanitize(validReport), null, 2)}\n`,
    ),
    writeFile(join(dir, `${id}-report.md`), renderMarkdown(validReport)),
  ]);
}
