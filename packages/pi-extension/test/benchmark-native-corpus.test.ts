import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REDACTION_MARKER } from "@intent-bridge/core";
import {
  benchmarkReportSha256,
  createReportV2,
} from "../../benchmark/dist/index.js";
import { describe, expect, it, vi } from "vitest";

import {
  HELP,
  buildReviewBundle,
  canonicalizePersistedReport,
  parseArgs,
  renderAggregate,
  runCorpusBenchmark,
  selectCases,
  wrapEvaluatorForReview,
  writeReviewBundle,
} from "../scripts/benchmark-native-corpus.mjs";

const cases = [
  { id: "en-01", title: "Fix duplicate checkout" },
  { id: "en-02", title: "Refactor auth helper" },
  { id: "tr-01", title: "Profil sayfasını düzelt" },
];

describe("benchmark-native-corpus argument parsing", () => {
  it("requires --provider and --model and defaults concurrency to 2", () => {
    expect(() => parseArgs([])).toThrow("CONFIG_INVALID");
    expect(() => parseArgs(["--provider", "codex"])).toThrow("CONFIG_INVALID");
    const parsed = parseArgs([
      "--provider",
      "codex",
      "--model",
      "gpt-5.4-mini",
    ]);
    expect(parsed).toEqual({
      concurrency: 2,
      provider: "codex",
      model: "gpt-5.4-mini",
    });
  });

  it("rejects concurrency outside 1..4", () => {
    expect(() =>
      parseArgs([
        "--provider",
        "codex",
        "--model",
        "gpt-5.4-mini",
        "--concurrency",
        "0",
      ]),
    ).toThrow("CONFIG_INVALID");
    expect(() =>
      parseArgs([
        "--provider",
        "codex",
        "--model",
        "gpt-5.4-mini",
        "--concurrency",
        "5",
      ]),
    ).toThrow("CONFIG_INVALID");
    expect(() =>
      parseArgs([
        "--provider",
        "codex",
        "--model",
        "gpt-5.4-mini",
        "--concurrency",
        "two",
      ]),
    ).toThrow("CONFIG_INVALID");
  });

  it("requires paired independent evaluator args and allows a different model from the same provider", () => {
    const base = ["--provider", "codex", "--model", "candidate"];
    expect(() =>
      parseArgs([...base, "--evaluator-provider", "openai"]),
    ).toThrow("CONFIG_INVALID");
    expect(() => parseArgs([...base, "--evaluator-model", "judge"])).toThrow(
      "CONFIG_INVALID",
    );
    expect(() =>
      parseArgs([
        ...base,
        "--evaluator-provider",
        "codex",
        "--evaluator-model",
        "candidate",
      ]),
    ).toThrow("CONFIG_INVALID");
    expect(
      parseArgs([
        ...base,
        "--evaluator-provider",
        "codex",
        "--evaluator-model",
        "judge",
      ]),
    ).toMatchObject({
      "evaluator-provider": "codex",
      "evaluator-model": "judge",
    });
    expect(HELP).toMatch(
      /Report V2|no retries|exact candidate provider\/model/,
    );
  });

  it("accepts a review bundle only with paired evaluator args", () => {
    const base = ["--provider", "codex", "--model", "candidate"];
    expect(() =>
      parseArgs([...base, "--review-bundle", "/tmp/raw.json"]),
    ).toThrow("CONFIG_INVALID");
    expect(
      parseArgs([
        ...base,
        "--evaluator-provider",
        "openai",
        "--evaluator-model",
        "judge",
        "--review-bundle",
        "/tmp/raw.json",
      ]),
    ).toMatchObject({ "review-bundle": "/tmp/raw.json" });
  });

  it("accepts csv case ids, --out, --cases, --contexts, and --help", () => {
    const parsed = parseArgs([
      "--provider",
      "codex",
      "--model",
      "gpt-5.4-mini",
      "--ids",
      "en-01,tr-01",
      "--out",
      "/tmp/native",
      "--cases",
      "benchmarks/cases",
      "--contexts",
      "benchmarks/contexts",
    ]);
    expect(parsed).toMatchObject({
      provider: "codex",
      model: "gpt-5.4-mini",
      ids: "en-01,tr-01",
      out: "/tmp/native",
      cases: "benchmarks/cases",
      contexts: "benchmarks/contexts",
      concurrency: 2,
    });
    expect(parseArgs(["--help"])).toEqual({ help: true });
    expect(() => parseArgs(["--unknown"])).toThrow("CONFIG_INVALID");
    expect(() => parseArgs(["--provider", "--model", "x"])).toThrow(
      "CONFIG_INVALID",
    );
  });

  it("requires --evaluator-reasoning only with the paired evaluator args and bounds it to canonical ModelThinkingLevel values", () => {
    const base = ["--provider", "codex", "--model", "candidate"];
    expect(() =>
      parseArgs([...base, "--evaluator-reasoning", "medium"]),
    ).toThrow("CONFIG_INVALID");
    expect(
      parseArgs([
        ...base,
        "--evaluator-provider",
        "codex",
        "--evaluator-model",
        "judge",
      ]),
    ).not.toHaveProperty("evaluator-reasoning");
    expect(
      parseArgs([
        ...base,
        "--evaluator-provider",
        "codex",
        "--evaluator-model",
        "judge",
        "--evaluator-reasoning",
        "medium",
      ]),
    ).toMatchObject({ "evaluator-reasoning": "medium" });
    for (const value of [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]) {
      expect(
        parseArgs([
          ...base,
          "--evaluator-provider",
          "codex",
          "--evaluator-model",
          "judge",
          "--evaluator-reasoning",
          value,
        ]),
      ).toMatchObject({ "evaluator-reasoning": value });
    }
    for (const value of ["auto", "MEDIUM", "very_high", "default"])
      expect(() =>
        parseArgs([
          ...base,
          "--evaluator-provider",
          "codex",
          "--evaluator-model",
          "judge",
          "--evaluator-reasoning",
          value,
        ]),
      ).toThrow("CONFIG_INVALID");
    expect(HELP).toMatch(
      /--evaluator-reasoning|reasoning selected by --evaluator-reasoning|default off/,
    );
  });
});

describe("benchmark-native-corpus context plumbing", () => {
  it("passes a supplied context directory to the benchmark runner without a provider call", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    await runCorpusBenchmark(
      {
        profileId: "pi:mock:model",
        profile: { model: "model" },
        cases: [],
        provider: { id: "unused" },
        contextDir: "/tmp/benchmark-contexts",
      },
      execute,
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ contextDir: "/tmp/benchmark-contexts" }),
    );
  });
});

describe("benchmark-native-corpus case selection", () => {
  it("returns all cases when no ids are provided", () => {
    expect(selectCases(cases, undefined)).toEqual(cases);
    expect(selectCases(cases, "")).toEqual(cases);
  });

  it("filters by csv ids, throwing on unknown or empty selections", () => {
    expect(selectCases(cases, "en-01,tr-01")).toEqual([cases[0], cases[2]]);
    expect(() => selectCases(cases, "en-01,nope")).toThrow("CONFIG_INVALID");
    expect(() => selectCases(cases, ",")).toThrow("CONFIG_INVALID");
  });
});

const reviewReport = (caseIds = ["case-b", "case-a"], failed = false) =>
  createReportV2({
    profile: { id: "pi-candidate-model", model: "candidate-model" },
    evaluator: {
      provider: "judge-provider",
      model: "judge-model",
      promptVersion: "pi-benchmark-evaluator-v1",
    },
    schemaVersion: "1",
    promptVersion: "pi-native-v1",
    compilerVersion: "pi-v1",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    concurrency: 2,
    results: caseIds.map((caseId, index) => ({
      caseId,
      title: `title-${index}`,
      tags: [],
      status: "transformed" as const,
      invariant: { passed: true, checks: [] },
      ...(failed && index === 0
        ? { evaluatorError: "EVALUATOR_FAILED" as const }
        : {
            evaluation: {
              version: 1 as const,
              intentAltered: false,
              clarity: "clearer" as const,
            },
          }),
    })),
  });

const evidence = (caseId: string, sentinel = caseId) => ({
  caseId,
  source: {
    originalText: `RAW_SOURCE_${sentinel}`,
    sourceLanguage: "en",
    messageType: "initial",
    attachmentSummary: { imageCount: 0 },
    projectContext: { files: [`RAW_CONTEXT_${sentinel}`] },
  },
  candidate: {
    intent: { raw: `RAW_INTENT_${sentinel}` },
    compiledTask: { raw: `RAW_COMPILED_${sentinel}` },
  },
});

const makeBundle = (report = canonicalizePersistedReport(reviewReport())) =>
  buildReviewBundle({
    report,
    evidence: [evidence("case-a"), evidence("case-b")],
    generatedAt: "2026-01-01T00:00:02.000Z",
  });

describe("benchmark-native-corpus raw review bundle", () => {
  it("hashes the strict persisted report and emits evidence in report order", () => {
    const persisted = canonicalizePersistedReport(reviewReport());
    const bundle = makeBundle(persisted);
    expect(bundle.sourceReportSha256).toBe(benchmarkReportSha256(persisted));
    expect(bundle.cases.map((item: { caseId: string }) => item.caseId)).toEqual(
      ["case-b", "case-a"],
    );
  });

  it("preserves the canonical DeepSeek profile ID through sanitization", () => {
    const persisted = canonicalizePersistedReport({
      ...reviewReport(),
      profile: {
        id: "pi:opencode-go:deepseek-v4-flash",
        model: "deepseek-v4-flash",
      },
    });
    expect(persisted.profile.id).toBe("pi:opencode-go:deepseek-v4-flash");
    expect(persisted.profile.id).not.toBe(REDACTION_MARKER);
  });

  it("captures before evaluator failure and retains bounded evaluator errors", async () => {
    const captured: unknown[] = [];
    const input = evidence("case-b", "FAILED");
    const evaluator = wrapEvaluatorForReview(
      { evaluate: async () => Promise.reject(new Error("raw provider error")) },
      captured,
    );
    await expect(evaluator.evaluate(input)).rejects.toThrow(
      "raw provider error",
    );
    expect(captured).toEqual([input]);

    const persisted = canonicalizePersistedReport(
      reviewReport(undefined, true),
    );
    const bundle = buildReviewBundle({
      report: persisted,
      evidence: [input, evidence("case-a")],
      generatedAt: "2026-01-01T00:00:02.000Z",
    });
    expect(bundle.cases[0]).toMatchObject({
      caseId: "case-b",
      evaluatorError: "EVALUATOR_FAILED",
    });
    expect(bundle.cases[0]).not.toHaveProperty("modelEvaluation");
  });

  it("rejects duplicate or missing captured evidence with a fixed error", () => {
    const persisted = canonicalizePersistedReport(reviewReport());
    for (const invalid of [
      [evidence("case-a"), evidence("case-a")],
      [evidence("case-a")],
    ])
      expect(() =>
        buildReviewBundle({
          report: persisted,
          evidence: invalid,
          generatedAt: "2026-01-01T00:00:02.000Z",
        }),
      ).toThrow("REVIEW_BUNDLE_EVIDENCE_INVALID");
  });

  it("keeps raw sentinels only in the bundle and the template bounded", () => {
    const persisted = canonicalizePersistedReport(reviewReport());
    const bundle = makeBundle(persisted);
    const raw = JSON.stringify(bundle);
    expect(raw).toContain("RAW_SOURCE_case-a");
    expect(JSON.stringify(persisted)).not.toContain("RAW_SOURCE_");
    expect(renderAggregate(persisted)).not.toContain("RAW_SOURCE_");
    expect(bundle.reviewArtifactTemplateIncomplete).toBe(true);
    expect(bundle.reviewArtifactTemplate).toEqual({
      version: 1,
      sourceReportSha256: bundle.sourceReportSha256,
      reviewerKind: "owner-human",
      reviewedAt: null,
      manualAcceptance: null,
      cases: ["case-b", "case-a"].map((caseId) => ({
        profileId: "pi-candidate-model",
        caseId,
        intentAltered: null,
        clarity: null,
        accepted: null,
      })),
    });
    expect(JSON.stringify(bundle.reviewArtifactTemplate)).not.toContain("RAW_");
  });

  it("creates parent directories with mode 0600 and resets existing mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "intent-bridge-review-"));
    const path = join(root, "nested", "review-bundle.json");
    const bundle = makeBundle();
    await writeReviewBundle(path, bundle);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(bundle);

    await chmod(path, 0o666);
    await writeFile(path, "old");
    await writeReviewBundle(path, bundle);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(bundle);
  });
});

describe("benchmark-native-corpus aggregate rendering", () => {
  const report = (evaluator?: object) => ({
    version: 2,
    profile: { id: "pi:codex:gpt", model: "gpt" },
    ...(evaluator ? { evaluator } : {}),
    aggregates: {
      structuralPassRate: { value: 1, denominator: 1 },
      deterministicSafetyPassRate: { value: 1, denominator: 1 },
      evaluatorCoverageRate: { value: null, denominator: 0 },
      evaluatorMaterialIntentAlterationRate: { value: null, denominator: 0 },
      evaluatorClearerOrEqualRate: { value: null, denominator: 0 },
      literalGoalDiagnosticRate: { value: 0, denominator: 1 },
      literalConstraintDiagnosticRate: { value: 0.5, denominator: 1 },
      languagePreservationRate: { value: 1, denominator: 1 },
      latencyP50: 8400,
      latencyP95: 12652,
      inputTokens: 1234,
      outputTokens: 766,
      totalTokens: 2000,
      totalCostUsd: 0.01,
      invariantPassRate: { value: 0, denominator: 1 },
    },
    results: [
      {
        caseId: "en-01",
        title: "SENTINEL_CASE_TITLE",
        request: "SENTINEL_REQUEST",
        intent: "SENTINEL_INTENT",
        compiledTask: "SENTINEL_COMPILED_TASK",
        providerError: "SENTINEL_PROVIDER_ERROR",
        tokenUsage: { output: 766 },
      },
    ],
    thresholds: {
      evaluatorCoverage: { status: "unavailable", denominator: 0 },
    },
  });

  it("emits safe V2 identities and aggregate fields only", () => {
    const evaluator = {
      provider: "openai",
      model: "judge",
      promptVersion: "pi-benchmark-evaluator-v1",
    };
    const rendered = JSON.parse(renderAggregate(report(evaluator)));
    expect(rendered).toMatchObject({
      profile: { id: "pi:codex:gpt", model: "gpt" },
      evaluator,
      structuralPassRate: { value: 1, denominator: 1 },
      deterministicSafetyPassRate: { value: 1, denominator: 1 },
      literalGoalDiagnosticRate: { value: 0, denominator: 1 },
      literalConstraintDiagnosticRate: { value: 0.5, denominator: 1 },
      languagePreservationRate: { value: 1, denominator: 1 },
      latencyP50: 8400,
      latencyP95: 12652,
      inputTokens: 1234,
      outputTokens: 766,
      totalTokens: 2000,
      maxOutputTokens: 766,
      totalCostUsd: 0.01,
    });
    expect(rendered).not.toHaveProperty("results");
    expect(rendered).not.toHaveProperty("invariantPassRate");
  });

  it("passes bounded reasoning through the aggregate and keeps stdout/report privacy unchanged", () => {
    const evaluator = {
      provider: "openai",
      model: "judge",
      promptVersion: "pi-benchmark-evaluator-v3",
      reasoning: "medium",
    };
    const rendered = JSON.parse(renderAggregate(report(evaluator)));
    expect(rendered.evaluator).toEqual(evaluator);
    const persisted = canonicalizePersistedReport(reviewReport());
    const withReasoning = {
      ...persisted,
      evaluator: {
        provider: "judge-provider",
        model: "judge-model",
        promptVersion: "pi-benchmark-evaluator-v3",
        reasoning: "medium" as const,
      },
    };
    const sanitized = JSON.parse(JSON.stringify(withReasoning));
    const persistedText = JSON.stringify(sanitized);
    for (const sentinel of [
      "SENTINEL_REQUEST",
      "SENTINEL_INTENT",
      "SENTINEL_COMPILED_TASK",
      "SENTINEL_CONTEXT",
    ])
      expect(persistedText).not.toContain(sentinel);
    expect(renderAggregate(withReasoning)).not.toContain("SENTINEL_");
    expect(renderAggregate(withReasoning)).toContain('"reasoning":"medium"');
  });

  it("emits unavailable evaluator V2 fields without metadata or leaks", () => {
    const rendered = renderAggregate(report());
    const parsed = JSON.parse(rendered);
    expect(parsed.evaluator).toBeNull();
    expect(parsed.evaluatorCoverageRate).toEqual({
      value: null,
      denominator: 0,
    });
    expect(parsed.thresholds.evaluatorCoverage.status).toBe("unavailable");
    for (const sentinel of [
      "en-01",
      "SENTINEL_CASE_TITLE",
      "SENTINEL_REQUEST",
      "SENTINEL_INTENT",
      "SENTINEL_COMPILED_TASK",
      "SENTINEL_PROVIDER_ERROR",
      "invariantPassRate",
    ])
      expect(rendered).not.toContain(sentinel);
  });
});
