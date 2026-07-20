import { describe, expect, it } from "vitest";
import {
  applyOwnerReview,
  benchmarkReportSha256,
  compareReports,
  createCorpusMetadata,
  createReport,
  createReportV2,
  nearestRank,
  parseBenchmarkReportV1,
  parseBenchmarkReportV2,
  renderMarkdown,
  renderTerminal,
  sanitize,
  writeReport,
} from "../src/index.js";
import { makeCase, makeResult, quality, reportInput } from "./helpers.js";

const report = (results = [makeResult("one")], id = "profile") =>
  createReport(reportInput(results, id));
const ownerReview = (
  source: ReturnType<typeof createReportV2>,
  overrides: Record<string, unknown> = {},
) => ({
  version: 1 as const,
  sourceReportSha256: benchmarkReportSha256(source),
  reviewerKind: "owner-human" as const,
  reviewedAt: "2025-01-02T03:04:05.000Z",
  manualAcceptance: "pass" as const,
  cases: source.results
    .filter((result) => result.status === "transformed")
    .map((result) => ({
      profileId: source.profile.id,
      caseId: result.caseId,
      intentAltered: false,
      clarity: "equal" as const,
      accepted: true,
    })),
  ...overrides,
});

describe("benchmark aggregation and reports", () => {
  it("counts attempted independently from skipped and uses attempted rate denominators", () => {
    const value = report([
      makeResult("pass"),
      makeResult("failed", {
        status: "fail_open",
        invariant: { passed: false, checks: [] },
      }),
      makeResult("skipped", {
        status: "skipped",
        invariant: {
          passed: false,
          checks: [{ name: "skipped", passed: false }],
        },
      }),
    ]);
    expect(value.aggregates).toMatchObject({
      total: 3,
      attempted: 2,
      transformed: 1,
      failOpen: 1,
      skipped: 1,
    });
    expect(value.aggregates.schemaValidRate).toEqual({
      value: 0.5,
      denominator: 2,
    });
    expect(value.aggregates.invariantPassRate).toEqual({
      value: 0.5,
      denominator: 2,
    });
    expect(value.aggregates.failOpenRate).toEqual({
      value: 0.5,
      denominator: 2,
    });
  });

  it("uses exact nearest-rank percentiles and ignores nonfinite latency", () => {
    expect(nearestRank([1, 2, 3, 4], 0.5)).toBe(2);
    expect(nearestRank([1, 2, 3, 4], 0.95)).toBe(4);
    expect(nearestRank([], 0.5)).toBeNull();
    const value = report([
      makeResult("a", { latencyMs: 1 }),
      makeResult("b", { latencyMs: 2 }),
      makeResult("c", { latencyMs: Number.NaN }),
      makeResult("d", { latencyMs: 4 }),
    ]);
    expect(value.aggregates.latencyP50).toBe(2);
    expect(value.aggregates.latencyP95).toBe(4);
  });

  it("sums and averages available usage without treating missing values as zero", () => {
    const value = report([
      makeResult("full", { tokenUsage: { input: 10, output: 4, total: 14 } }),
      makeResult("partial", { tokenUsage: { input: 6 } }),
      makeResult("missing", { tokenUsage: undefined }),
    ]);
    expect(value.aggregates).toMatchObject({
      inputTokens: 16,
      outputTokens: 4,
      totalTokens: 14,
      averageInputTokens: 8,
      averageOutputTokens: 4,
      averageTotalTokens: 14,
      missingUsageCount: 1,
    });
  });

  it("keeps unavailable costs null and counts missing costs", () => {
    const unavailable = report([
      makeResult("a", { estimatedCostUsd: undefined }),
    ]);
    expect(unavailable.aggregates.totalCostUsd).toBeNull();
    expect(unavailable.aggregates.averageCostUsd).toBeNull();
    expect(unavailable.aggregates.missingCostCount).toBe(1);
    const available = report([
      makeResult("a", { estimatedCostUsd: 0.1 }),
      makeResult("b", { estimatedCostUsd: 0.3 }),
    ]);
    expect(available.aggregates.totalCostUsd).toBeCloseTo(0.4);
    expect(available.aggregates.averageCostUsd).toBeCloseTo(0.2);
  });

  it("aggregates quality only over available quality traces", () => {
    const value = report([
      makeResult("a", {
        quality: {
          ...quality,
          taskCount: 3,
          schemaValid: true,
          providerConfidence: 0.5,
        },
      }),
      makeResult("b", {
        quality: {
          ...quality,
          taskCount: 1,
          schemaValid: false,
          providerConfidence: undefined,
        },
      }),
      makeResult("none", { quality: undefined }),
    ]);
    expect(value.aggregates.qualitySchemaValidRate).toEqual({
      value: 0.5,
      denominator: 2,
    });
    expect(value.aggregates.averageTaskCount).toEqual({
      value: 2,
      denominator: 2,
    });
    expect(value.aggregates.averageProviderConfidence).toEqual({
      value: 0.5,
      denominator: 1,
    });
  });

  it("reports forbidden, language, evaluator, and unavailable human/user metrics", () => {
    const value = report([
      makeResult("good", {
        evaluation: {
          version: 1,
          intentAltered: false,
          clarity: "clearer",
          rating: "good",
        },
      }),
      makeResult("bad", {
        invariant: {
          passed: false,
          checks: [
            { name: "response_language", passed: false },
            { name: "forbidden_additions", passed: false },
          ],
        },
        evaluation: { version: 1, intentAltered: true, clarity: "less_clear" },
      }),
    ]);
    expect(value.aggregates.forbiddenAdditionFailureRate).toEqual({
      value: 0.5,
      denominator: 2,
    });
    expect(value.aggregates.languagePreservationRate).toEqual({
      value: 0.5,
      denominator: 2,
    });
    expect(value.aggregates.evaluatorMaterialIntentAlterationRate).toEqual({
      value: 0.5,
      denominator: 2,
    });
    expect(value.aggregates.evaluatorClearerOrEqualRate).toEqual({
      value: 0.5,
      denominator: 2,
    });
    expect(value.aggregates.evaluatorGoodRatingRate).toEqual({
      value: 1,
      denominator: 1,
    });
    expect(value.aggregates.humanRatingRate).toEqual({
      value: null,
      denominator: 0,
    });
    expect(value.aggregates.userRatingRate).toEqual({
      value: null,
      denominator: 0,
    });
  });

  it("marks thresholds pass, fail, or unavailable with both safety tags", () => {
    const empty = report([]);
    expect(
      Object.values(empty.thresholds).every(
        (item) => item.status === "unavailable",
      ),
    ).toBe(true);
    const passing = report([
      makeResult("path", {
        tags: ["paths-commands"],
        evaluation: { version: 1, intentAltered: false, clarity: "equal" },
      }),
      makeResult("secret", {
        tags: ["secret-like"],
        evaluation: { version: 1, intentAltered: false, clarity: "clearer" },
      }),
    ]);
    expect(
      Object.values(passing.thresholds).every((item) => item.status === "pass"),
    ).toBe(true);
    const failing = report([
      makeResult("path", {
        tags: ["paths-commands"],
        invariant: {
          passed: false,
          checks: [{ name: "response_language", passed: false }],
        },
        evaluation: { version: 1, intentAltered: true, clarity: "less_clear" },
      }),
    ]);
    expect(failing.thresholds).toMatchObject({
      invariants: { status: "fail" },
      materialAlteration: { status: "fail" },
      clarity: { status: "fail" },
      language: { status: "fail" },
      safety: { status: "fail" },
    });
  });

  it("compares numerically, puts null last, exposes deltas, and handles ties", () => {
    const a = report([makeResult("same")], "a");
    const b = report([makeResult("same")], "b");
    b.aggregates.invariantPassRate = { value: 0.95, denominator: 1 };
    a.aggregates.invariantPassRate = { value: 0.9, denominator: 1 };
    const ranked = compareReports(a, b);
    expect(ranked).toMatchObject({ winner: "b", tie: false });
    expect(ranked.orderedProfiles.map((item) => item.profileId)).toEqual([
      "b",
      "a",
    ]);
    expect(ranked.deltas.invariantPassRate).toBeCloseTo(-0.05);
    a.aggregates.invariantPassRate = { value: 1, denominator: 1 };
    b.aggregates.invariantPassRate = { value: 1, denominator: 1 };
    a.aggregates.latencyP50 = null;
    b.aggregates.latencyP50 = 100;
    expect(compareReports(a, b).winner).toBe("b");
    const tieA = report([], "z");
    const tieB = report([], "a");
    const tied = compareReports(tieA, tieB);
    expect(tied).toMatchObject({ winner: null, tie: true });
    expect(tied.orderedProfiles.map((item) => item.profileId)).toEqual([
      "a",
      "z",
    ]);
  });

  it("fails V2 structural, safety, and language gates when required checks are missing", () => {
    const structural = createReportV2(
      reportInput([
        makeResult("structural", {
          invariant: {
            passed: true,
            checks: [
              { name: "schema_valid", passed: true },
              { name: "compiler_valid", passed: true },
              { name: "message_type", passed: true },
              { name: "compiled_response_language", passed: true },
              { name: "original_request_fenced", passed: true },
            ],
          },
        }),
      ]),
    );
    expect(structural.aggregates.structuralPassRate).toEqual({
      value: 0,
      denominator: 1,
    });
    expect(structural.aggregates.languagePreservationRate).toEqual({
      value: 0,
      denominator: 1,
    });
    expect(structural.thresholds).toMatchObject({
      structural: { status: "fail", denominator: 1 },
      language: { status: "fail", denominator: 1 },
    });

    const safety = createReportV2(
      reportInput([
        makeResult("safety", {
          tags: ["paths-commands"],
          invariant: {
            passed: true,
            checks: [
              { name: "schema_valid", passed: true },
              { name: "compiler_valid", passed: true },
              { name: "message_type", passed: true },
              { name: "response_language", passed: true },
              { name: "compiled_response_language", passed: true },
              { name: "original_request_fenced", passed: true },
            ],
          },
        }),
      ]),
    );
    expect(safety.aggregates.deterministicSafetyPassRate).toEqual({
      value: 0,
      denominator: 1,
    });
    expect(safety.thresholds.deterministicSafety).toEqual({
      status: "fail",
      denominator: 1,
    });
  });

  it("uses all transformed cases for V2 literal diagnostic denominators", () => {
    const value = createReportV2(
      reportInput([
        makeResult("present", {
          invariant: {
            passed: true,
            checks: [{ name: "literal_goal_concepts", passed: true }],
          },
        }),
        makeResult("missing"),
      ]),
    );
    expect(value.aggregates.literalGoalDiagnosticRate).toEqual({
      value: 0.5,
      denominator: 2,
    });
    expect(value.aggregates.literalConstraintDiagnosticRate).toEqual({
      value: 0,
      denominator: 2,
    });
  });

  it("keeps literal diagnostics out of V2 structural and safety gates", () => {
    const value = createReportV2(
      reportInput([
        makeResult("safety", {
          tags: ["paths-commands"],
          invariant: {
            passed: false,
            checks: [
              { name: "schema_valid", passed: true },
              { name: "compiler_valid", passed: true },
              { name: "message_type", passed: true },
              { name: "response_language", passed: true },
              { name: "compiled_response_language", passed: true },
              { name: "original_request_fenced", passed: true },
              { name: "forbidden_additions", passed: true },
              { name: "literal_goal_concepts", passed: false },
              { name: "literal_constraints", passed: false },
            ],
          },
        }),
      ]),
    );
    expect(value.aggregates.structuralPassRate.value).toBe(1);
    expect(value.aggregates.deterministicSafetyPassRate.value).toBe(1);
    expect(value.aggregates.literalGoalDiagnosticRate.value).toBe(0);
    expect(value.thresholds.structural.status).toBe("pass");
    expect(value.thresholds.deterministicSafety.status).toBe("pass");
    const terminal = renderTerminal(value);
    const markdown = renderMarkdown(value);
    expect(terminal).not.toContain("invariants");
    expect(terminal).toContain("diagnostics (non-gating) literal goals");
    expect(markdown).toContain("Gate failures: none");
    expect(markdown).toContain("Diagnostics (non-gating): literal goals");
    expect(markdown).not.toContain("literal_goal_concepts");
    expect(markdown).not.toContain("Failures:");
  });

  it("treats evaluator omissions and errors as V2 coverage failures and leaves absent evidence unavailable", () => {
    const unavailable = createReportV2(reportInput([makeResult("none")]));
    expect(unavailable.aggregates.evaluatorCoverageRate).toEqual({
      value: null,
      denominator: 0,
    });
    expect(unavailable.thresholds.evaluatorCoverage.status).toBe("unavailable");
    const value = createReportV2(
      reportInput([
        makeResult("verdict", {
          evaluation: { version: 1, intentAltered: false, clarity: "equal" },
        }),
        makeResult("error", { evaluatorError: "EVALUATOR_FAILED" }),
        makeResult("missing"),
      ]),
    );
    expect(value.aggregates.evaluatorCoverageRate).toEqual({
      value: 1 / 3,
      denominator: 3,
    });
    expect(value.aggregates.evaluatorMaterialIntentAlterationRate).toEqual({
      value: 2 / 3,
      denominator: 3,
    });
    expect(value.aggregates.evaluatorClearerOrEqualRate).toEqual({
      value: 1 / 3,
      denominator: 3,
    });
    expect(value.thresholds.evaluatorCoverage.status).toBe("fail");
  });

  it("hashes canonical strict-parsed V2 reports deterministically", () => {
    const source = createReportV2(reportInput([makeResult("one")], "owner"));
    const reordered = Object.fromEntries(
      Object.entries(source).reverse(),
    ) as typeof source;
    expect(benchmarkReportSha256(reordered)).toBe(
      benchmarkReportSha256(structuredClone(source)),
    );
    expect(benchmarkReportSha256(source)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("applies a complete hash-bound owner review without mutating source", () => {
    const source = createReportV2(
      reportInput([makeResult("one"), makeResult("two")], "owner"),
    );
    const before = structuredClone(source);
    const finalReport = applyOwnerReview(source, ownerReview(source));
    expect(source).toEqual(before);
    expect(parseBenchmarkReportV2(finalReport)).toEqual(finalReport);
    expect(finalReport.ownerReview).toEqual({
      sourceReportSha256: benchmarkReportSha256(source),
      reviewerKind: "owner-human",
      reviewedAt: "2025-01-02T03:04:05.000Z",
      manualAcceptance: "pass",
    });
    expect(finalReport).not.toHaveProperty("ownerReview.cases");
    expect(finalReport.aggregates.ownerReviewCoverageRate).toEqual({
      value: 1,
      denominator: 2,
    });
    expect(finalReport.aggregates.ownerMaterialIntentAlterationRate).toEqual({
      value: 0,
      denominator: 2,
    });
    expect(finalReport.aggregates.ownerClearerOrEqualRate).toEqual({
      value: 1,
      denominator: 2,
    });
    expect(finalReport.thresholds).toMatchObject({
      ownerCoverage: { status: "pass", denominator: 2 },
      ownerMaterialAlteration: { status: "pass", denominator: 2 },
      ownerClarity: { status: "pass", denominator: 2 },
      ownerAcceptance: { status: "pass", denominator: 1 },
    });
    expect(finalReport.results).toEqual(source.results);
    expect(finalReport.evaluator).toEqual(source.evaluator);
  });

  it("rejects invalid owner review binding and case coverage", () => {
    const source = createReportV2(
      reportInput([makeResult("one"), makeResult("two")], "owner"),
    );
    const review = ownerReview(source);
    expect(() =>
      applyOwnerReview(source, {
        ...review,
        sourceReportSha256: "0".repeat(64),
      }),
    ).toThrow("OWNER_REVIEW_HASH_MISMATCH");
    expect(() =>
      applyOwnerReview(source, {
        ...review,
        cases: review.cases.map((item) => ({
          ...item,
          profileId: "wrong",
        })),
      }),
    ).toThrow("OWNER_REVIEW_PROFILE_MISMATCH");
    const firstCase = review.cases[0];
    expect(firstCase).toBeDefined();
    if (!firstCase) throw new Error("missing review case");
    for (const cases of [
      review.cases.slice(0, 1),
      [...review.cases, { ...firstCase, caseId: "extra" }],
      [firstCase, firstCase],
    ])
      expect(() => applyOwnerReview(source, { ...review, cases })).toThrow(
        "OWNER_REVIEW_CASE_COVERAGE_INVALID",
      );
    const none = createReportV2(
      reportInput([
        makeResult("none", {
          status: "skipped",
          invariant: { passed: false, checks: [] },
        }),
      ]),
    );
    expect(() => applyOwnerReview(none, ownerReview(none))).toThrow(
      "OWNER_REVIEW_NO_TRANSFORMED_CASES",
    );
    const finalReport = applyOwnerReview(source, review);
    expect(() => applyOwnerReview(finalReport, review)).toThrow(
      "OWNER_REVIEW_ALREADY_APPLIED",
    );
    expect(() => benchmarkReportSha256(finalReport)).toThrow(
      "OWNER_REVIEW_ALREADY_APPLIED",
    );
  });

  it("uses exact owner thresholds and requires manual and per-case acceptance", () => {
    const source = createReportV2(
      reportInput(
        Array.from({ length: 20 }, (_, index) => makeResult(`case-${index}`)),
        "owner",
      ),
    );
    const base = ownerReview(source);
    const boundaryCases = base.cases.map((item, index) => ({
      ...item,
      intentAltered: index === 0,
      clarity: index < 16 ? ("equal" as const) : ("less_clear" as const),
    }));
    const boundary = applyOwnerReview(source, {
      ...base,
      cases: boundaryCases,
    });
    expect(boundary.aggregates.ownerMaterialIntentAlterationRate).toEqual({
      value: 0.05,
      denominator: 20,
    });
    expect(boundary.aggregates.ownerClearerOrEqualRate).toEqual({
      value: 0.8,
      denominator: 20,
    });
    expect(boundary.thresholds.ownerMaterialAlteration.status).toBe("pass");
    expect(boundary.thresholds.ownerClarity.status).toBe("pass");
    for (const review of [
      { ...base, manualAcceptance: "fail" as const },
      {
        ...base,
        cases: base.cases.map((item, index) => ({
          ...item,
          accepted: index !== 0,
        })),
      },
    ])
      expect(
        applyOwnerReview(source, review).thresholds.ownerAcceptance,
      ).toEqual({ status: "fail", denominator: 1 });
  });

  it("keeps owner review placeholders unavailable and V2 comparisons tied without ranking literal diagnostics", () => {
    const a = createReportV2(
      reportInput(
        [
          makeResult("same", {
            invariant: {
              passed: false,
              checks: [{ name: "literal_goal_concepts", passed: false }],
            },
          }),
        ],
        "a",
      ),
    );
    const b = createReportV2(
      reportInput(
        [
          makeResult("same", {
            invariant: {
              passed: false,
              checks: [{ name: "literal_goal_concepts", passed: true }],
            },
          }),
        ],
        "b",
      ),
    );
    const comparison = compareReports(a, b);
    expect(a.thresholds.ownerAcceptance.status).toBe("unavailable");
    expect(comparison).toMatchObject({ winner: null, tie: true });
    expect(comparison.orderedProfiles.map((item) => item.profileId)).toEqual([
      "a",
      "b",
    ]);
    expect(comparison.deltas.invariantPassRate).toBeNull();
  });

  it("rejects mismatched, duplicate, and mixed corpus identities while accepting matching legacy reports", () => {
    const legacy = (results: ReturnType<typeof makeResult>[]) =>
      createReportV2(reportInput(results));
    expect(() =>
      compareReports(legacy([makeResult("a")]), legacy([makeResult("b")])),
    ).toThrow("BENCHMARK_CORPUS_MISMATCH");
    expect(() =>
      compareReports(
        legacy([makeResult("a"), makeResult("a")]),
        legacy([makeResult("a"), makeResult("a")]),
      ),
    ).toThrow("BENCHMARK_CORPUS_MISMATCH");
    expect(() =>
      compareReports(
        legacy([makeResult("a"), makeResult("b")]),
        legacy([makeResult("b"), makeResult("a")]),
      ),
    ).toThrow("BENCHMARK_CORPUS_MISMATCH");
    const cases = [makeCase("a"), makeCase("b")];
    const metadata = createCorpusMetadata(cases);
    const matching = (corpus?: typeof metadata) =>
      createReportV2({
        ...reportInput([makeResult("a"), makeResult("b")]),
        ...(corpus ? { corpus } : {}),
      });
    expect(() =>
      compareReports(matching(metadata), matching(metadata)),
    ).not.toThrow();
    expect(() => compareReports(matching(), matching(metadata))).toThrow(
      "BENCHMARK_CORPUS_MISMATCH",
    );
    expect(() =>
      compareReports(
        matching(metadata),
        matching({
          ...metadata,
          contentSha256: "0".repeat(64),
        }),
      ),
    ).toThrow("BENCHMARK_CORPUS_MISMATCH");
    expect(() =>
      compareReports(legacy([makeResult("a")]), legacy([makeResult("a")])),
    ).not.toThrow();
  });

  it("preserves only known corpus hashes while sanitizing Report V2 secrets", () => {
    const corpus = createCorpusMetadata([makeCase("a")]);
    const sentinel = ["token", "EXAMPLE_NOT_A_SECRET_LONG_VALUE"].join("=");
    const source = createReportV2({
      ...reportInput([
        makeResult("a", {
          title: sentinel,
        }),
      ]),
      corpus,
    });
    const sanitized = sanitize({
      ...source,
      arbitraryHash: corpus.contentSha256,
    });
    const { arbitraryHash, ...persisted } = sanitized;
    const parsed = parseBenchmarkReportV2(persisted);
    expect(parsed.corpus).toEqual(corpus);
    expect(parsed.results[0]?.title).toBe("[REDACTED]");
    expect(arbitraryHash).toBe("[REDACTED]");
    expect(JSON.stringify(parsed)).not.toContain(sentinel);
    expect(benchmarkReportSha256(parsed)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects tampered corpus totals and result ID hashes", async () => {
    const source = createReportV2({
      ...reportInput([makeResult("a"), makeResult("b")]),
      corpus: createCorpusMetadata([makeCase("a"), makeCase("b")]),
    });
    const badTotal = structuredClone(source);
    if (!badTotal.corpus) throw new Error("missing corpus metadata");
    badTotal.corpus.total = 1;
    expect(() => benchmarkReportSha256(badTotal)).toThrow(
      "BENCHMARK_REPORT_INCONSISTENT",
    );
    await expect(
      writeReport("/tmp/intent-bridge-inconsistent-corpus", badTotal),
    ).rejects.toThrow("BENCHMARK_REPORT_INCONSISTENT");

    const badIds = structuredClone(source);
    if (!badIds.corpus) throw new Error("missing corpus metadata");
    badIds.corpus.caseIdSequenceSha256 = "0".repeat(64);
    expect(() => compareReports(badIds, source)).toThrow(
      "BENCHMARK_REPORT_INCONSISTENT",
    );
    expect(() => benchmarkReportSha256(badIds)).toThrow(
      "BENCHMARK_REPORT_INCONSISTENT",
    );
  });

  it("rejects tampered V2 base metrics before comparison, hashing, review, or writing", async () => {
    const source = createReportV2(
      reportInput(
        Array.from({ length: 50 }, (_, index) => makeResult(`case-${index}`)),
      ),
    );
    const tampered = structuredClone(source);
    tampered.aggregates.total = 1;
    tampered.thresholds.structural = { status: "pass", denominator: 1 };
    expect(() => compareReports(tampered, source)).toThrow(
      "BENCHMARK_REPORT_INCONSISTENT",
    );
    expect(() => benchmarkReportSha256(tampered)).toThrow(
      "BENCHMARK_REPORT_INCONSISTENT",
    );
    expect(() => applyOwnerReview(tampered, ownerReview(source))).toThrow(
      "BENCHMARK_REPORT_INCONSISTENT",
    );
    await expect(
      writeReport("/tmp/intent-bridge-inconsistent", tampered),
    ).rejects.toThrow("BENCHMARK_REPORT_INCONSISTENT");
  });

  it("rejects cross-version comparisons", () => {
    expect(() =>
      compareReports(
        report([makeResult("v1")]),
        createReportV2(reportInput([makeResult("v2")])),
      ),
    ).toThrow("BENCHMARK_REPORT_VERSION_MISMATCH");
  });

  it("rejects V2 reports whose evaluator config differs", () => {
    const base = (evaluator: Record<string, unknown> | undefined, id = "p") =>
      createReportV2({
        ...reportInput([makeResult("one")], id),
        ...(evaluator ? { evaluator: evaluator as never } : {}),
      });
    const sharedEvaluator = {
      provider: "openai",
      model: "judge",
      promptVersion: "pi-benchmark-evaluator-v3" as const,
      reasoning: "medium" as const,
    };
    expect(() =>
      compareReports(base(sharedEvaluator, "a"), base(undefined, "b")),
    ).toThrow("BENCHMARK_EVALUATOR_CONFIG_MISMATCH");
    expect(() =>
      compareReports(base(undefined, "a"), base(sharedEvaluator, "b")),
    ).toThrow("BENCHMARK_EVALUATOR_CONFIG_MISMATCH");
    expect(() =>
      compareReports(
        base({ ...sharedEvaluator, provider: "other" }, "a"),
        base(sharedEvaluator, "b"),
      ),
    ).toThrow("BENCHMARK_EVALUATOR_CONFIG_MISMATCH");
    expect(() =>
      compareReports(
        base({ ...sharedEvaluator, model: "other-judge" }, "a"),
        base(sharedEvaluator, "b"),
      ),
    ).toThrow("BENCHMARK_EVALUATOR_CONFIG_MISMATCH");
    expect(() =>
      compareReports(
        base(
          { ...sharedEvaluator, promptVersion: "pi-benchmark-evaluator-v1" },
          "a",
        ),
        base(sharedEvaluator, "b"),
      ),
    ).toThrow("BENCHMARK_EVALUATOR_CONFIG_MISMATCH");
    expect(() =>
      compareReports(
        base({ ...sharedEvaluator, reasoning: "low" as const }, "a"),
        base(sharedEvaluator, "b"),
      ),
    ).toThrow("BENCHMARK_EVALUATOR_CONFIG_MISMATCH");
    expect(() =>
      compareReports(
        base(sharedEvaluator, "a"),
        base({ ...sharedEvaluator, reasoning: undefined }, "b"),
      ),
    ).toThrow("BENCHMARK_EVALUATOR_CONFIG_MISMATCH");
    expect(() =>
      compareReports(base(sharedEvaluator, "a"), base(sharedEvaluator, "b")),
    ).not.toThrow();
    const oldOldA = base(undefined, "a");
    const oldOldB = base(undefined, "b");
    expect(() => compareReports(oldOldA, oldOldB)).not.toThrow();
  });

  it("keeps sanitized benchmark reports schema-valid with token metrics", () => {
    const value = report([
      makeResult("full", {
        tokenUsage: { input: 10, output: 4, total: 14 },
      }),
    ]);
    expect(parseBenchmarkReportV1(sanitize(value))).toEqual(value);
  });

  it("preserves V1 rendering exactly and recursively sanitizes secrets and key names", () => {
    const value = report();
    expect(renderTerminal(value)).toBe(
      'profile (mock-model) 1/1 transformed; invariants {"value":1,"denominator":1}; p50 10',
    );
    expect(renderMarkdown(value)).toBe(
      '# Benchmark profile\n\nModel: mock-model\n\nprofile (mock-model) 1/1 transformed; invariants {"value":1,"denominator":1}; p50 10\n\nFailures: none\n',
    );
    const sanitized = sanitize({
      nested: {
        authorization: "anything",
        note: "token=EXAMPLE_NOT_A_SECRET_LONG_VALUE",
      },
      headers: { safe: "no" },
    });
    expect(JSON.stringify(sanitized)).not.toContain(
      "EXAMPLE_NOT_A_SECRET_LONG_VALUE",
    );
    expect(sanitized).toEqual({
      nested: { authorization: "[REDACTED]", note: "[REDACTED]" },
      headers: "[REDACTED]",
    });
  });
});
