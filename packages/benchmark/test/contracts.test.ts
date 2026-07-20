import { describe, expect, it } from "vitest";
import {
  compareReports,
  createReport,
  createReportV2,
  parseBenchmarkCaseV1,
  parseBenchmarkEvaluationV1,
  parseBenchmarkReportV1,
  parseBenchmarkReportV2,
  parseOwnerReviewV1,
} from "../src/index.js";
import { makeCase, makeResult, reportInput } from "./helpers.js";

describe("benchmark contracts", () => {
  it("keeps case schema exact at every level", () => {
    expect(parseBenchmarkCaseV1(makeCase())).toEqual(makeCase());
    expect(() => parseBenchmarkCaseV1({ ...makeCase(), extra: true })).toThrow(
      "BENCHMARK_INVALID",
    );
    expect(() =>
      parseBenchmarkCaseV1({
        ...makeCase(),
        expected: { ...makeCase().expected, extra: true },
      }),
    ).toThrow();
    expect(() =>
      parseBenchmarkCaseV1({
        ...makeCase(),
        attachments: { imageCount: 1, extra: true },
      }),
    ).toThrow();
  });

  it("accepts empty annotations for trace review cases", () => {
    const item = makeCase("trace", {
      expected: {
        requiredGoalConcepts: [],
        requiredConstraints: [],
        forbiddenAdditions: [],
        responseLanguage: "en",
      },
      tags: ["trace-export", "needs-review"],
    });
    expect(parseBenchmarkCaseV1(item).expected.requiredGoalConcepts).toEqual(
      [],
    );
  });

  it("validates evaluator version, booleans, clarity, rating, and unknown keys", () => {
    expect(
      parseBenchmarkEvaluationV1({
        version: 1,
        intentAltered: false,
        clarity: "equal",
        rating: "good",
      }).rating,
    ).toBe("good");
    for (const invalid of [
      { version: 2, intentAltered: false, clarity: "equal" },
      {
        version: "pi-benchmark-evaluator-v2",
        intentAltered: false,
        clarity: "equal",
      },
      { version: 1, intentAltered: "no", clarity: "equal" },
      { version: 1, intentAltered: false, clarity: "better" },
      { version: 1, intentAltered: false, clarity: "equal", rating: "ok" },
      { version: 1, intentAltered: false, clarity: "equal", extra: true },
    ])
      expect(() => parseBenchmarkEvaluationV1(invalid)).toThrow();
  });

  it("strictly parses bounded owner review artifacts and metadata", () => {
    const review = {
      version: 1,
      sourceReportSha256: "a".repeat(64),
      reviewerKind: "owner-human",
      reviewedAt: "2025-01-02T03:04:05.000Z",
      manualAcceptance: "pass",
      cases: [
        {
          profileId: "profile",
          caseId: "one",
          intentAltered: false,
          clarity: "equal",
          accepted: true,
        },
      ],
    } as const;
    expect(parseOwnerReviewV1(review)).toEqual(review);
    for (const invalid of [
      { ...review, unknown: true },
      { ...review, sourceReportSha256: "A".repeat(64) },
      { ...review, reviewedAt: "2025-01-02" },
      { ...review, reviewerKind: "model" },
      { ...review, manualAcceptance: "yes" },
      { ...review, cases: [{ ...review.cases[0], caseId: "" }] },
      { ...review, cases: [{ ...review.cases[0], raw: "forbidden" }] },
    ])
      expect(() => parseOwnerReviewV1(invalid)).toThrow("BENCHMARK_INVALID");
  });

  it("round-trips a complete generated report", () => {
    const report = createReport(reportInput([makeResult("one")]));
    expect(parseBenchmarkReportV1(report)).toEqual(report);
  });

  it("rejects missing and unknown report fields recursively", () => {
    const report = createReport(reportInput([makeResult("one")]));
    const missing = structuredClone(report) as Record<string, unknown>;
    delete missing.thresholds;
    expect(() => parseBenchmarkReportV1(missing)).toThrow();
    expect(() =>
      parseBenchmarkReportV1({ ...report, unknown: true }),
    ).toThrow();
    expect(() =>
      parseBenchmarkReportV1({
        ...report,
        profile: { ...report.profile, secret: "x" },
      }),
    ).toThrow();
    expect(() =>
      parseBenchmarkReportV1({
        ...report,
        results: [{ ...report.results[0], raw: "x" }],
      }),
    ).toThrow();
  });

  it("round-trips strict V2 evaluator metadata", () => {
    const input = {
      ...reportInput([makeResult("one")]),
      evaluator: {
        provider: "openai",
        model: "gpt-evaluator",
        promptVersion: "pi-benchmark-evaluator-v2" as const,
      },
    };
    const report = createReportV2(input);
    expect(parseBenchmarkReportV2(report)).toEqual(report);
    expect(report.evaluator).toEqual(input.evaluator);
    expect(
      parseBenchmarkReportV2({
        ...report,
        evaluator: {
          ...input.evaluator,
          promptVersion: "pi-benchmark-evaluator-v1",
        },
      }).evaluator?.promptVersion,
    ).toBe("pi-benchmark-evaluator-v1");
    expect(
      parseBenchmarkReportV2({
        ...report,
        evaluator: {
          ...input.evaluator,
          promptVersion: "pi-benchmark-evaluator-v3",
        },
      }).evaluator?.promptVersion,
    ).toBe("pi-benchmark-evaluator-v3");
    const reviewed = {
      ...report,
      ownerReview: {
        sourceReportSha256: "b".repeat(64),
        reviewerKind: "owner-human" as const,
        reviewedAt: "2025-01-02T03:04:05.000Z",
        manualAcceptance: "pass" as const,
      },
    };
    expect(parseBenchmarkReportV2(reviewed)).toEqual(reviewed);
    expect(() =>
      parseBenchmarkReportV2({
        ...reviewed,
        ownerReview: { ...reviewed.ownerReview, cases: [] },
      }),
    ).toThrow("BENCHMARK_INVALID");
    for (const evaluator of [
      { ...input.evaluator, promptVersion: "pi-benchmark-evaluator-v9" },
      { ...input.evaluator, promptVersion: "" },
      { ...input.evaluator, promptVersion: "pi-benchmark-evaluator-v2-rc" },
      { ...input.evaluator, unknown: true },
      { provider: "openai", promptVersion: "pi-benchmark-evaluator-v1" },
    ])
      expect(() => parseBenchmarkReportV2({ ...report, evaluator })).toThrow(
        "BENCHMARK_INVALID",
      );
  });

  it("round-trips V2 evaluator metadata with bounded reasoning and keeps old reports parseable", () => {
    const baseEvaluator = {
      provider: "openai",
      model: "gpt-evaluator",
      promptVersion: "pi-benchmark-evaluator-v3" as const,
    };
    const noReasoning = createReportV2({
      ...reportInput([makeResult("one")]),
      evaluator: { ...baseEvaluator },
    });
    expect(noReasoning.evaluator).toEqual(baseEvaluator);
    expect(parseBenchmarkReportV2(noReasoning)).toEqual(noReasoning);
    const withReasoning = createReportV2({
      ...reportInput([makeResult("one")]),
      evaluator: { ...baseEvaluator, reasoning: "medium" as const },
    });
    expect(withReasoning.evaluator?.reasoning).toBe("medium");
    expect(parseBenchmarkReportV2(withReasoning)).toEqual(withReasoning);
    expect(parseBenchmarkReportV2(noReasoning).evaluator).not.toHaveProperty(
      "reasoning",
    );
    for (const reasoning of [
      "minimal",
      "low",
      "high",
      "xhigh",
      "max",
    ] as const) {
      const report = createReportV2({
        ...reportInput([makeResult("one")]),
        evaluator: { ...baseEvaluator, reasoning },
      });
      expect(parseBenchmarkReportV2(report).evaluator?.reasoning).toBe(
        reasoning,
      );
    }
    for (const reasoning of ["", "auto", "very_high", "MEDIUM", "default"]) {
      expect(() =>
        parseBenchmarkReportV2({
          ...noReasoning,
          evaluator: { ...baseEvaluator, reasoning },
        }),
      ).toThrow("BENCHMARK_INVALID");
    }
  });

  it("round-trips V2 without V1-only aggregate fields and rejects them", () => {
    const report = createReportV2(reportInput([makeResult("one")]));
    expect(parseBenchmarkReportV2(report)).toEqual(report);
    expect(report).not.toHaveProperty("evaluator");
    expect(report.aggregates).not.toHaveProperty("invariantPassRate");
    expect(report.aggregates).not.toHaveProperty("humanRatingRate");
    expect(report.aggregates).not.toHaveProperty("userRatingRate");
    expect(JSON.stringify(report)).not.toMatch(
      /invariantPassRate|humanRatingRate|userRatingRate/,
    );
    for (const key of [
      "invariantPassRate",
      "humanRatingRate",
      "userRatingRate",
    ])
      expect(() =>
        parseBenchmarkReportV2({
          ...report,
          aggregates: {
            ...report.aggregates,
            [key]: { value: 1, denominator: 1 },
          },
        }),
      ).toThrow("BENCHMARK_INVALID");
    expect(() => parseBenchmarkReportV2({ ...report, unknown: true })).toThrow(
      "BENCHMARK_INVALID",
    );
    expect(() =>
      parseBenchmarkReportV2({
        ...report,
        thresholds: {
          ...report.thresholds,
          unknown: { status: "pass", denominator: 1 },
        },
      }),
    ).toThrow("BENCHMARK_INVALID");
  });

  it("rejects malformed dates, enums, nonfinite numbers, and invalid rates", () => {
    const report = createReport(reportInput([makeResult("one")]));
    expect(() =>
      parseBenchmarkReportV1({ ...report, startedAt: "not-a-date" }),
    ).toThrow();
    expect(() =>
      parseBenchmarkReportV1({ ...report, concurrency: 9 }),
    ).toThrow();
    expect(() =>
      parseBenchmarkReportV1({
        ...report,
        aggregates: { ...report.aggregates, latencyP50: Number.NaN },
      }),
    ).toThrow();
    expect(() =>
      parseBenchmarkReportV1({
        ...report,
        aggregates: {
          ...report.aggregates,
          invariantPassRate: { value: 1.1, denominator: 1 },
        },
      }),
    ).toThrow();
    expect(() =>
      parseBenchmarkReportV1({
        ...report,
        results: [
          {
            ...report.results[0],
            quality: { ...report.results[0]?.quality, providerConfidence: 1.1 },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseBenchmarkReportV1({
        ...report,
        thresholds: {
          ...report.thresholds,
          safety: { status: "maybe", denominator: 1 },
        },
      }),
    ).toThrow();
    expect(() => compareReports({} as never, report)).toThrow();
  });
});
