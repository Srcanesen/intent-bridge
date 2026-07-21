import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiCompilerV1 } from "@intent-bridge/core";
import { describe, expect, it } from "vitest";
import {
  computeCompilerAbAggregates,
  createCompilerAbReportV1,
  evaluateCompilerAbInvariants,
  parseCompilerAbReportV1,
  renderCompilerAbSummary,
  runCompilerAbBenchmark,
  type CompilerAbCaseResult,
  type CompilerAbModeResult,
} from "../src/index.js";
import { makeCase, makeIntent, providerWith } from "./helpers.js";

const sampleIntent = makeIntent();
const sampleCompiledTrue = new PiCompilerV1({
  includeOriginalRequest: true,
}).compile({
  intent: sampleIntent,
  originalText: "Fix login.",
  attachmentSummary: { imageCount: 0 },
});
const sampleCompiledFalse = new PiCompilerV1({
  includeOriginalRequest: false,
}).compile({
  intent: sampleIntent,
  originalText: "Fix login.",
  attachmentSummary: { imageCount: 0 },
});

function makeCaseResult(
  overrides: Partial<CompilerAbCaseResult> = {},
): CompilerAbCaseResult {
  return {
    caseId: "test-01",
    title: "Test case",
    status: "transformed",
    sharedProviderLatencyMs: 100,
    sharedTokenUsage: { input: 10, output: 20, total: 30 },
    sharedEstimatedCostUsd: 0.001,
    trueMode: {
      includeOriginalRequest: true,
      charCount: 500,
      byteCount: 510,
      compileLatencyMs: 2,
      invariant: { passed: true, checks: [] },
    },
    falseMode: {
      includeOriginalRequest: false,
      charCount: 400,
      byteCount: 405,
      compileLatencyMs: 1,
      invariant: { passed: true, checks: [] },
    },
    ...overrides,
  };
}

describe("compiler-ab invariants", () => {
  it("true mode: original_request_fenced passes when original text is present", () => {
    const result = evaluateCompilerAbInvariants(
      makeCase("test", { input: "Fix login." }),
      sampleIntent,
      sampleCompiledTrue,
      true,
    );
    const fenced = result.checks.find(
      (c) => c.name === "original_request_fenced",
    );
    expect(fenced?.passed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("false mode: original_request_omitted passes when heading and body are absent", () => {
    const result = evaluateCompilerAbInvariants(
      makeCase("test", { input: "Fix login." }),
      sampleIntent,
      sampleCompiledFalse,
      false,
    );
    const omitted = result.checks.find(
      (c) => c.name === "original_request_omitted",
    );
    expect(omitted?.passed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("true mode: fails original_request_fenced when content is missing", () => {
    const bad = {
      compilerVersion: "pi-v2" as const,
      responseLanguageCode: "en",
      text: "[INTENT BRIDGE TASK — v1]\n\nMessage type: initial\nRequired user-facing response language: en\n\n## Execution guidance\n- Do it.",
    };
    const result = evaluateCompilerAbInvariants(
      makeCase("test", { input: "Fix login." }),
      sampleIntent,
      bad,
      true,
    );
    const fenced = result.checks.find(
      (c) => c.name === "original_request_fenced",
    );
    expect(fenced?.passed).toBe(false);
  });

  it("false mode permits source wording outside the omitted section", () => {
    const intent = makeIntent({ goal: "Fix login." });
    const compiled = new PiCompilerV1({
      includeOriginalRequest: false,
    }).compile({
      intent,
      originalText: "Fix login.",
      attachmentSummary: { imageCount: 0 },
    });
    expect(
      evaluateCompilerAbInvariants(
        makeCase("same-text", { input: "Fix login." }),
        intent,
        compiled,
        false,
      ).passed,
    ).toBe(true);
  });

  it("false mode: fails original_request_omitted when heading is present", () => {
    const bad = {
      compilerVersion: "pi-v2" as const,
      responseLanguageCode: "en",
      text: "## Original user request\n```\nFix login.\n```",
    };
    const result = evaluateCompilerAbInvariants(
      makeCase("test", { input: "Fix login." }),
      sampleIntent,
      bad,
      false,
    );
    const omitted = result.checks.find(
      (c) => c.name === "original_request_omitted",
    );
    expect(omitted?.passed).toBe(false);
  });

  it("mode-aware invariants coexist without breaking standard checks", () => {
    const result = evaluateCompilerAbInvariants(
      makeCase("test", { input: "Fix login." }),
      sampleIntent,
      sampleCompiledTrue,
      true,
    );
    expect(result.checks.find((c) => c.name === "schema_valid")?.passed).toBe(
      true,
    );
    expect(result.checks.find((c) => c.name === "compiler_valid")?.passed).toBe(
      true,
    );
    expect(result.checks.find((c) => c.name === "message_type")?.passed).toBe(
      true,
    );
  });
});

describe("compiler-ab report parser", () => {
  it("parses a valid CompilerAbReportV1", () => {
    const report = createCompilerAbReportV1({
      profile: { id: "pi:test:model", model: "model" },
      corpus: { total: 1, contentSha256: "0".repeat(64) },
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:01.000Z",
      cases: [makeCaseResult()],
    });
    const parsed = parseCompilerAbReportV1(report);
    expect(parsed.version).toBe(1);
    expect(parsed.runnerVersion).toBe("compiler-ab-v1");
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.cases[0].trueMode.includeOriginalRequest).toBe(true);
    expect(parsed.cases[0].falseMode.includeOriginalRequest).toBe(false);
    expect(parsed.aggregates.total).toBe(1);
  });

  it("rejects unknown fields", () => {
    const report = {
      ...createCompilerAbReportV1({
        profile: { id: "pi:test:model", model: "model" },
        corpus: { total: 1, contentSha256: "0".repeat(64) },
        startedAt: "2025-01-01T00:00:00.000Z",
        completedAt: "2025-01-01T00:00:01.000Z",
        cases: [makeCaseResult()],
      }),
      unknownKey: true,
    };
    expect(() => parseCompilerAbReportV1(report)).toThrow();
  });

  it("rejects the misspelled evaluator metadata field", () => {
    const report = createCompilerAbReportV1({
      profile: { id: "pi:test:model", model: "model" },
      corpus: { total: 1, contentSha256: "0".repeat(64) },
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:01.000Z",
      cases: [makeCaseResult()],
    });
    expect(() =>
      parseCompilerAbReportV1({ ...report, evalutorMetadata: {} }),
    ).toThrow();
  });

  it("rejects raw content in case results", () => {
    const report = createCompilerAbReportV1({
      profile: { id: "pi:test:model", model: "model" },
      corpus: { total: 1, contentSha256: "0".repeat(64) },
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:01.000Z",
      cases: [makeCaseResult()],
    });
    report.cases[0] = {
      ...report.cases[0],
      rawContent: "SENTINEL_RAW_REQUEST",
    } as CompilerAbCaseResult;
    expect(() => parseCompilerAbReportV1(report)).toThrow();
  });
});

describe("compiler-ab aggregates", () => {
  it("computes paired char/byte deltas correctly", () => {
    const results = [
      makeCaseResult({
        trueMode: {
          includeOriginalRequest: true,
          charCount: 600,
          byteCount: 620,
          compileLatencyMs: 2,
          invariant: { passed: true, checks: [] },
        },
        falseMode: {
          includeOriginalRequest: false,
          charCount: 400,
          byteCount: 410,
          compileLatencyMs: 1,
          invariant: { passed: true, checks: [] },
        },
      }),
      makeCaseResult({
        trueMode: {
          includeOriginalRequest: true,
          charCount: 500,
          byteCount: 510,
          compileLatencyMs: 1,
          invariant: { passed: true, checks: [] },
        },
        falseMode: {
          includeOriginalRequest: false,
          charCount: 450,
          byteCount: 460,
          compileLatencyMs: 1,
          invariant: { passed: true, checks: [] },
        },
      }),
    ];
    const agg = computeCompilerAbAggregates(results);
    expect(agg.charDeltaMean).toBe((200 + 50) / 2);
    expect(agg.byteDeltaMean).toBe((210 + 50) / 2);
    // nearestRank with ceil(p*n)-1 gives lower median for even count
    expect(agg.charDeltaMedian).toBe(50); // sorted [50, 200], ceil(0.5*2)-1=0
    expect(agg.byteDeltaMedian).toBe(50); // sorted [50, 210], ceil(0.5*2)-1=0
    expect(agg.charReductionCount).toBe(2);
    expect(agg.byteReductionCount).toBe(2);
  });

  it("counts invariant passes per mode", () => {
    const results = [
      makeCaseResult({
        trueMode: {
          includeOriginalRequest: true,
          charCount: 500,
          byteCount: 510,
          compileLatencyMs: 1,
          invariant: { passed: true, checks: [] },
        },
        falseMode: {
          includeOriginalRequest: false,
          charCount: 400,
          byteCount: 405,
          compileLatencyMs: 1,
          invariant: { passed: true, checks: [] },
        },
      }),
      makeCaseResult({
        trueMode: {
          includeOriginalRequest: true,
          charCount: 600,
          byteCount: 620,
          compileLatencyMs: 1,
          invariant: { passed: false, checks: [] },
        },
        falseMode: {
          includeOriginalRequest: false,
          charCount: 450,
          byteCount: 460,
          compileLatencyMs: 1,
          invariant: { passed: false, checks: [] },
        },
      }),
    ];
    const agg = computeCompilerAbAggregates(results);
    expect(agg.trueInvariantPassCount).toBe(1);
    expect(agg.falseInvariantPassCount).toBe(1);
    expect(agg.trueInvariantPassRate).toBe(0.5);
    expect(agg.falseInvariantPassRate).toBe(0.5);
  });

  it("aggregates shared token usage and cost", () => {
    const results = [
      makeCaseResult({
        sharedTokenUsage: { input: 10, output: 20, total: 30 },
        sharedEstimatedCostUsd: 0.001,
      }),
      makeCaseResult({
        sharedTokenUsage: { input: 5, output: 10, total: 15 },
        sharedEstimatedCostUsd: 0.002,
      }),
    ];
    const agg = computeCompilerAbAggregates(results);
    expect(agg.sharedTotalInputTokens).toBe(15);
    expect(agg.sharedTotalOutputTokens).toBe(30);
    expect(agg.sharedTotalTokens).toBe(45);
    expect(agg.sharedTotalCostUsd).toBe(0.003);
  });

  it("sets evaluator counts correctly", () => {
    const results = [
      makeCaseResult({
        trueMode: {
          includeOriginalRequest: true,
          charCount: 500,
          byteCount: 510,
          compileLatencyMs: 1,
          invariant: { passed: true, checks: [] },
          evaluation: {
            version: 1,
            intentAltered: false,
            clarity: "clearer",
            rating: "good",
          },
        },
        falseMode: {
          includeOriginalRequest: false,
          charCount: 400,
          byteCount: 405,
          compileLatencyMs: 1,
          invariant: { passed: true, checks: [] },
          evaluation: {
            version: 1,
            intentAltered: false,
            clarity: "equal",
            rating: "bad",
          },
        },
      }),
    ];
    const agg = computeCompilerAbAggregates(results);
    expect(agg.evaluatorTrueAttempts).toBe(0);
    expect(agg.evaluatorFalseAttempts).toBe(0);
    expect(agg.evaluatorTrueGoodRatingCount).toBe(1);
    expect(agg.evaluatorFalseGoodRatingCount).toBe(0);
    expect(agg.evaluatorTrueClearerOrEqualCount).toBe(1);
    expect(agg.evaluatorFalseClearerOrEqualCount).toBe(1);
  });
});

describe("compiler-ab status aggregates", () => {
  it("retains fail-open and skipped cases outside paired metrics", () => {
    const aggregates = computeCompilerAbAggregates([
      makeCaseResult(),
      {
        caseId: "failed",
        title: "Failed",
        status: "fail_open",
        errorCode: "BENCHMARK_CASE_FAILED",
      },
      { caseId: "skipped", title: "Skipped", status: "skipped" },
    ]);
    expect(aggregates).toMatchObject({
      total: 3,
      attempted: 2,
      transformed: 1,
      failOpen: 1,
      skipped: 1,
      pairedCount: 1,
      evaluatorTrueAttempts: 0,
      evaluatorFalseAttempts: 0,
    });
  });
});

describe("compiler-ab char vs byte counts", () => {
  it("correctly measures non-ASCII characters", () => {
    const text = "Merhaba dünya! 🎉";
    const charCount = text.length;
    const byteCount = Buffer.byteLength(text, "utf8");
    expect(charCount).toBe(17);
    expect(byteCount).toBe(20); // ü=2 bytes, 🎉=4 bytes, rest ASCII 1-byte each
  });

  it("mode results contain correct char and byte counts", () => {
    const intent = makeIntent();
    const compilerTrue = new PiCompilerV1({ includeOriginalRequest: true });
    const compilerFalse = new PiCompilerV1({ includeOriginalRequest: false });
    const trueText = compilerTrue.compile({
      intent,
      originalText: "Merhaba dünya! 🎉",
      attachmentSummary: { imageCount: 0 },
    }).text;
    const falseText = compilerFalse.compile({
      intent,
      originalText: "Merhaba dünya! 🎉",
      attachmentSummary: { imageCount: 0 },
    }).text;
    const trueMode: CompilerAbModeResult = {
      includeOriginalRequest: true,
      charCount: trueText.length,
      byteCount: Buffer.byteLength(trueText, "utf8"),
      compileLatencyMs: 0,
      invariant: { passed: true, checks: [] },
    };
    const falseMode: CompilerAbModeResult = {
      includeOriginalRequest: false,
      charCount: falseText.length,
      byteCount: Buffer.byteLength(falseText, "utf8"),
      compileLatencyMs: 0,
      invariant: { passed: true, checks: [] },
    };
    expect(trueMode.charCount).toBeGreaterThan(falseMode.charCount);
    expect(trueMode.byteCount).toBeGreaterThan(falseMode.byteCount);
  });
});

describe("compiler-ab latency separation", () => {
  it("separates provider, compile, and evaluator latencies", () => {
    // Type structure keeps provider, compile, and evaluator measurements separate.
    const result: CompilerAbCaseResult = {
      caseId: "latency-test",
      title: "Latency test",
      sharedProviderLatencyMs: 500,
      trueMode: {
        includeOriginalRequest: true,
        charCount: 500,
        byteCount: 510,
        compileLatencyMs: 2,
        invariant: { passed: true, checks: [] },
      },
      falseMode: {
        includeOriginalRequest: false,
        charCount: 400,
        byteCount: 405,
        compileLatencyMs: 1,
        invariant: { passed: true, checks: [] },
      },
    };
    expect(result.sharedProviderLatencyMs).toBe(500);
    expect(result.trueMode.compileLatencyMs).toBe(2);
    expect(result.falseMode.compileLatencyMs).toBe(1);
  });
});

describe("compiler-ab runner one provider call two compiles", () => {
  it("performs one provider call and two local compiles per case", async () => {
    let interpretCount = 0;
    const provider = providerWith(async () => {
      interpretCount++;
      return {
        intent: makeIntent(),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        rawResponseHash: "0000",
        latencyMs: 100,
      };
    });
    const cases = [makeCase("case-1"), makeCase("case-2")];
    const results = await runCompilerAbBenchmark({
      profileId: "pi:mock:model",
      profile: { model: "mock-model" },
      cases,
      provider,
      injectClock: { nowMs: () => 1000 },
    });
    expect(interpretCount).toBe(2);
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.trueMode.includeOriginalRequest).toBe(true);
      expect(result.falseMode.includeOriginalRequest).toBe(false);
      expect(result.trueMode.compiledTask).toBeUndefined();
      expect(result.falseMode.compiledTask).toBeUndefined();
    }
  });

  it("does not call provider twice per case", async () => {
    let interpretCount = 0;
    const provider = providerWith(async () => {
      interpretCount++;
      return {
        intent: makeIntent(),
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
        rawResponseHash: "0000",
        latencyMs: 50,
      };
    });
    const results = await runCompilerAbBenchmark({
      profileId: "pi:mock:model",
      profile: { model: "mock-model" },
      cases: [makeCase("single")],
      provider,
      injectClock: { nowMs: () => 1000 },
    });
    expect(interpretCount).toBe(1);
    expect(results).toHaveLength(1);
  });

  it("keeps aborted cases ordered as skipped", async () => {
    const controller = new AbortController();
    controller.abort();
    const results = await runCompilerAbBenchmark({
      profileId: "pi:mock:model",
      profile: { model: "mock-model" },
      cases: [makeCase("first"), makeCase("second")],
      provider: providerWith(async () => {
        throw new Error("must not run");
      }),
      signal: controller.signal,
    });
    expect(results.map((result) => [result.caseId, result.status])).toEqual([
      ["first", "skipped"],
      ["second", "skipped"],
    ]);
  });

  it("has no evaluator when not configured", async () => {
    const provider = providerWith(async () => ({
      intent: makeIntent(),
      usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
      rawResponseHash: "0000",
      latencyMs: 50,
    }));
    const results = await runCompilerAbBenchmark({
      profileId: "pi:mock:model",
      profile: { model: "mock-model" },
      cases: [makeCase("no-eval")],
      provider,
      injectClock: { nowMs: () => 1000 },
    });
    expect(results[0].trueMode.evaluation).toBeUndefined();
    expect(results[0].trueMode.evaluatorError).toBeUndefined();
    expect(results[0].falseMode.evaluation).toBeUndefined();
    expect(results[0].falseMode.evaluatorError).toBeUndefined();
  });
});

describe("compiler-ab context plumbing", () => {
  it("passes a loaded fixture to the pipeline provider and evaluator", async () => {
    const dir = await mkdtemp(join(tmpdir(), "compiler-ab-context-"));
    await writeFile(
      join(dir, "fixture.json"),
      JSON.stringify({ instructionExcerpts: ["SENTINEL_CONTEXT"] }),
    );
    let providerContext: unknown;
    let evaluatorContext: unknown;
    await runCompilerAbBenchmark({
      profileId: "pi:mock:model",
      profile: { model: "mock-model" },
      cases: [makeCase("context", { contextFixture: "fixture" })],
      contextDir: dir,
      provider: providerWith(async (request) => {
        providerContext = request.projectContext;
        return { intent: makeIntent(), latencyMs: 1 };
      }),
      evaluator: {
        async evaluate(input) {
          evaluatorContext = input.source.projectContext;
          return { version: 1, intentAltered: false, clarity: "equal" };
        },
      },
    });
    expect(providerContext).toEqual({
      instructionExcerpts: ["SENTINEL_CONTEXT"],
    });
    expect(evaluatorContext).toEqual(providerContext);
  });
});

describe("compiler-ab evaluator integration", () => {
  it("calls evaluator exactly twice per transformed case (once per mode)", async () => {
    let evalCount = 0;
    const provider = providerWith(async () => ({
      intent: makeIntent(),
      usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
      rawResponseHash: "0000",
      latencyMs: 50,
    }));
    const evaluator = {
      async evaluate() {
        evalCount++;
        return {
          version: 1 as const,
          intentAltered: false,
          clarity: "equal" as const,
        };
      },
    };
    const results = await runCompilerAbBenchmark({
      profileId: "pi:mock:model",
      profile: { model: "mock-model" },
      cases: [makeCase("eval-test")],
      provider,
      evaluator,
      injectClock: { nowMs: () => 1000 },
    });
    expect(evalCount).toBe(2);
    expect(results[0].trueMode.evaluation).toBeDefined();
    expect(results[0].falseMode.evaluation).toBeDefined();
  });

  it("marks evaluator error as unavailable not zero/pass", async () => {
    const provider = providerWith(async () => ({
      intent: makeIntent(),
      usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
      rawResponseHash: "0000",
      latencyMs: 50,
    }));
    const evaluator = {
      async evaluate() {
        throw new Error("evaluator error");
      },
    };
    const results = await runCompilerAbBenchmark({
      profileId: "pi:mock:model",
      profile: { model: "mock-model" },
      cases: [makeCase("eval-fail")],
      provider,
      evaluator,
      injectClock: { nowMs: () => 1000 },
    });
    expect(results[0].trueMode.evaluatorError).toBe("EVALUATOR_FAILED");
    expect(results[0].trueMode.evaluation).toBeUndefined();
    expect(results[0].falseMode.evaluatorError).toBe("EVALUATOR_FAILED");
    expect(results[0].falseMode.evaluation).toBeUndefined();
  });
});

describe("compiler-ab render", () => {
  it("renderCompilerAbSummary produces sanitized output without raw content", () => {
    const report = createCompilerAbReportV1({
      profile: { id: "pi:test:model", model: "model" },
      corpus: { total: 1, contentSha256: "0".repeat(64) },
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:01.000Z",
      cases: [makeCaseResult()],
    });
    const summary = JSON.parse(renderCompilerAbSummary(report));
    expect(summary.profile).toEqual({ id: "pi:test:model", model: "model" });
    expect(summary).not.toHaveProperty("cases");
    expect(summary).not.toHaveProperty("rawContent");
    expect(summary.total).toBe(1);
    expect(summary.charDeltaMean).toBeGreaterThan(0);
  });
});
