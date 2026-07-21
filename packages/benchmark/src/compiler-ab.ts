import {
  InterpretationPipeline,
  PiCompilerV1,
  type BridgeTraceV1,
  type CompiledTask,
  type IntentDocumentV1,
  type IntentProvider,
  type RetryPolicyV1,
} from "@intent-bridge/core";
import type {
  BenchmarkCaseV1,
  BenchmarkEvaluationV1,
  BenchmarkEvaluator,
  InvariantResult,
} from "./contracts.js";
import { parseBenchmarkEvaluationV1 } from "./contracts.js";
import { loadContextFixture } from "./fixtures.js";
import { evaluateInvariants } from "./invariants.js";

const BENCHMARK_NO_RETRY_POLICY: RetryPolicyV1 = {
  maxRetries: 0,
  baseDelayMs: 250,
  totalBudgetMs: 45000,
};
const SAFE_CASE_ERROR = "BENCHMARK_CASE_FAILED";

export interface CompilerAbModeResult {
  includeOriginalRequest: boolean;
  charCount: number;
  byteCount: number;
  compileLatencyMs: number;
  invariant: InvariantResult;
  evaluation?: BenchmarkEvaluationV1;
  evaluatorError?: "EVALUATOR_FAILED";
  evaluatorLatencyMs?: number;
}
export type CompilerAbCaseResult =
  | { caseId: string; title: string; status: "skipped" }
  | {
      caseId: string;
      title: string;
      status: "fail_open";
      errorCode: "BENCHMARK_CASE_FAILED";
      sharedProviderLatencyMs?: number;
      sharedTokenUsage?: { input?: number; output?: number; total?: number };
      sharedEstimatedCostUsd?: number;
    }
  | {
      caseId: string;
      title: string;
      status: "transformed";
      sharedProviderLatencyMs?: number;
      sharedTokenUsage?: { input?: number; output?: number; total?: number };
      sharedEstimatedCostUsd?: number;
      trueMode: CompilerAbModeResult;
      falseMode: CompilerAbModeResult;
    };
export interface CompilerAbAggregates {
  total: number;
  attempted: number;
  transformed: number;
  failOpen: number;
  skipped: number;
  pairedCount: number;
  charDeltaMean: number | null;
  charDeltaMedian: number | null;
  byteDeltaMean: number | null;
  byteDeltaMedian: number | null;
  charReductionCount: number;
  byteReductionCount: number;
  trueInvariantPassCount: number;
  falseInvariantPassCount: number;
  trueInvariantPassRate: number | null;
  falseInvariantPassRate: number | null;
  falseOriginalOmissionPassCount: number;
  evaluatorTrueAttempts: number;
  evaluatorTrueSuccesses: number;
  evaluatorTrueErrors: number;
  evaluatorFalseAttempts: number;
  evaluatorFalseSuccesses: number;
  evaluatorFalseErrors: number;
  evaluatorTrueGoodRatingCount: number;
  evaluatorFalseGoodRatingCount: number;
  evaluatorTrueClearerOrEqualCount: number;
  evaluatorFalseClearerOrEqualCount: number;
  sharedTotalInputTokens: number;
  sharedTotalOutputTokens: number;
  sharedTotalTokens: number;
  sharedTotalCostUsd: number | null;
}
export interface CompilerAbReportV1 {
  version: 1;
  runnerVersion: "compiler-ab-v1";
  profile: { id: string; model: string };
  corpus: { total: number; contentSha256: string };
  evaluatorMetadata?: {
    provider: string;
    model: string;
    promptVersion: string;
    reasoning?: string;
  };
  startedAt: string;
  completedAt: string;
  cases: CompilerAbCaseResult[];
  aggregates: CompilerAbAggregates;
}

function fail(message = "COMPILER_AB_REPORT_INVALID"): never {
  throw new Error(message);
}
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
const text = (v: unknown, max = 4000): string =>
  typeof v === "string" && v.trim() && v.length <= max ? v : fail();
const finite = (v: unknown, min = 0, max = Number.POSITIVE_INFINITY): number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fail();
const integer = (
  v: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number => {
  const n = finite(v, min, max);
  return Number.isInteger(n) ? n : fail();
};
const boolean = (v: unknown): boolean => (typeof v === "boolean" ? v : fail());
const enumValue = <T extends string>(v: unknown, values: readonly T[]): T =>
  typeof v === "string" && values.includes(v as T) ? (v as T) : fail();
const date = (v: unknown): string => {
  const value = text(v, 40);
  return Number.isFinite(Date.parse(value)) ? value : fail();
};
const sha256 = (v: unknown): string =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail();

function parseInvariant(value: unknown): InvariantResult {
  const o = strict(value, ["passed", "checks"]);
  const entries = Array.isArray(o.checks) ? o.checks : fail();
  if (entries.length > 30) fail();
  return {
    passed: boolean(o.passed),
    checks: entries.map((entry) => {
      const raw = object(entry);
      const keys = ["name", "passed"];
      if ("detail" in raw) keys.push("detail");
      const check = strict(raw, keys);
      return {
        name: text(check.name, 100),
        passed: boolean(check.passed),
        ...(check.detail === undefined
          ? {}
          : { detail: text(check.detail, 160) }),
      };
    }),
  };
}
function parseEvaluation(value: unknown): BenchmarkEvaluationV1 {
  const raw = object(value);
  const keys = ["version", "intentAltered", "clarity"];
  if ("rating" in raw) keys.push("rating");
  const o = strict(raw, keys);
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
function parseModeResult(
  value: unknown,
  expected: boolean,
): CompilerAbModeResult {
  const raw = object(value);
  const keys = [
    "includeOriginalRequest",
    "charCount",
    "byteCount",
    "compileLatencyMs",
    "invariant",
  ];
  for (const key of ["evaluation", "evaluatorError", "evaluatorLatencyMs"])
    if (key in raw) keys.push(key);
  const o = strict(raw, keys);
  if (boolean(o.includeOriginalRequest) !== expected) fail();
  if (
    (o.evaluation !== undefined || o.evaluatorError !== undefined) !==
    (o.evaluatorLatencyMs !== undefined)
  )
    fail();
  if (o.evaluation !== undefined && o.evaluatorError !== undefined) fail();
  return {
    includeOriginalRequest: expected,
    charCount: integer(o.charCount, 0, 100000),
    byteCount: integer(o.byteCount, 0, 200000),
    compileLatencyMs: finite(o.compileLatencyMs),
    invariant: parseInvariant(o.invariant),
    ...(o.evaluation === undefined
      ? {}
      : { evaluation: parseEvaluation(o.evaluation) }),
    ...(o.evaluatorError === undefined
      ? {}
      : {
          evaluatorError: enumValue(o.evaluatorError, [
            "EVALUATOR_FAILED",
          ] as const),
        }),
    ...(o.evaluatorLatencyMs === undefined
      ? {}
      : { evaluatorLatencyMs: finite(o.evaluatorLatencyMs) }),
  };
}
function parseShared(o: Record<string, unknown>) {
  const keys: string[] = [];
  for (const key of [
    "sharedProviderLatencyMs",
    "sharedTokenUsage",
    "sharedEstimatedCostUsd",
  ])
    if (key in o) keys.push(key);
  const shared = strict(
    Object.fromEntries(keys.map((key) => [key, o[key]])),
    keys,
  );
  const usage =
    shared.sharedTokenUsage === undefined
      ? undefined
      : (() => {
          const u = object(shared.sharedTokenUsage);
          const usageKeys = ["input", "output", "total"].filter(
            (key) => key in u,
          );
          if (!usageKeys.length) fail();
          const parsed = strict(u, usageKeys);
          return {
            ...(parsed.input === undefined
              ? {}
              : { input: integer(parsed.input) }),
            ...(parsed.output === undefined
              ? {}
              : { output: integer(parsed.output) }),
            ...(parsed.total === undefined
              ? {}
              : { total: integer(parsed.total) }),
          };
        })();
  return {
    ...(shared.sharedProviderLatencyMs === undefined
      ? {}
      : { sharedProviderLatencyMs: finite(shared.sharedProviderLatencyMs) }),
    ...(usage === undefined ? {} : { sharedTokenUsage: usage }),
    ...(shared.sharedEstimatedCostUsd === undefined
      ? {}
      : { sharedEstimatedCostUsd: finite(shared.sharedEstimatedCostUsd) }),
  };
}
function parseCaseResult(value: unknown): CompilerAbCaseResult {
  const raw = object(value);
  const status = enumValue(raw.status, [
    "transformed",
    "fail_open",
    "skipped",
  ] as const);
  const keys =
    status === "transformed"
      ? ["caseId", "title", "status", "trueMode", "falseMode"]
      : status === "fail_open"
        ? ["caseId", "title", "status", "errorCode"]
        : ["caseId", "title", "status"];
  for (const key of [
    "sharedProviderLatencyMs",
    "sharedTokenUsage",
    "sharedEstimatedCostUsd",
  ])
    if (key in raw) keys.push(key);
  const o = strict(raw, keys);
  const base = {
    caseId: text(o.caseId, 100),
    title: text(o.title, 200),
    ...parseShared(o),
  };
  if (status === "skipped") {
    if (Object.keys(parseShared(o)).length) fail();
    return { ...base, status };
  }
  if (status === "fail_open")
    return {
      ...base,
      status,
      errorCode: enumValue(o.errorCode, [SAFE_CASE_ERROR] as const),
    };
  return {
    ...base,
    status,
    trueMode: parseModeResult(o.trueMode, true),
    falseMode: parseModeResult(o.falseMode, false),
  };
}

const aggregateKeys = [
  "total",
  "attempted",
  "transformed",
  "failOpen",
  "skipped",
  "pairedCount",
  "charDeltaMean",
  "charDeltaMedian",
  "byteDeltaMean",
  "byteDeltaMedian",
  "charReductionCount",
  "byteReductionCount",
  "trueInvariantPassCount",
  "falseInvariantPassCount",
  "trueInvariantPassRate",
  "falseInvariantPassRate",
  "falseOriginalOmissionPassCount",
  "evaluatorTrueAttempts",
  "evaluatorTrueSuccesses",
  "evaluatorTrueErrors",
  "evaluatorFalseAttempts",
  "evaluatorFalseSuccesses",
  "evaluatorFalseErrors",
  "evaluatorTrueGoodRatingCount",
  "evaluatorFalseGoodRatingCount",
  "evaluatorTrueClearerOrEqualCount",
  "evaluatorFalseClearerOrEqualCount",
  "sharedTotalInputTokens",
  "sharedTotalOutputTokens",
  "sharedTotalTokens",
  "sharedTotalCostUsd",
] as const;
function parseAggregates(value: unknown): CompilerAbAggregates {
  const o = strict(value, aggregateKeys);
  const nullable = (v: unknown) =>
    v === null ? null : finite(v, -100000, 100000);
  return {
    total: integer(o.total),
    attempted: integer(o.attempted),
    transformed: integer(o.transformed),
    failOpen: integer(o.failOpen),
    skipped: integer(o.skipped),
    pairedCount: integer(o.pairedCount),
    charDeltaMean: nullable(o.charDeltaMean),
    charDeltaMedian: nullable(o.charDeltaMedian),
    byteDeltaMean: nullable(o.byteDeltaMean),
    byteDeltaMedian: nullable(o.byteDeltaMedian),
    charReductionCount: integer(o.charReductionCount),
    byteReductionCount: integer(o.byteReductionCount),
    trueInvariantPassCount: integer(o.trueInvariantPassCount),
    falseInvariantPassCount: integer(o.falseInvariantPassCount),
    trueInvariantPassRate:
      o.trueInvariantPassRate === null
        ? null
        : finite(o.trueInvariantPassRate, 0, 1),
    falseInvariantPassRate:
      o.falseInvariantPassRate === null
        ? null
        : finite(o.falseInvariantPassRate, 0, 1),
    falseOriginalOmissionPassCount: integer(o.falseOriginalOmissionPassCount),
    evaluatorTrueAttempts: integer(o.evaluatorTrueAttempts),
    evaluatorTrueSuccesses: integer(o.evaluatorTrueSuccesses),
    evaluatorTrueErrors: integer(o.evaluatorTrueErrors),
    evaluatorFalseAttempts: integer(o.evaluatorFalseAttempts),
    evaluatorFalseSuccesses: integer(o.evaluatorFalseSuccesses),
    evaluatorFalseErrors: integer(o.evaluatorFalseErrors),
    evaluatorTrueGoodRatingCount: integer(o.evaluatorTrueGoodRatingCount),
    evaluatorFalseGoodRatingCount: integer(o.evaluatorFalseGoodRatingCount),
    evaluatorTrueClearerOrEqualCount: integer(
      o.evaluatorTrueClearerOrEqualCount,
    ),
    evaluatorFalseClearerOrEqualCount: integer(
      o.evaluatorFalseClearerOrEqualCount,
    ),
    sharedTotalInputTokens: integer(o.sharedTotalInputTokens),
    sharedTotalOutputTokens: integer(o.sharedTotalOutputTokens),
    sharedTotalTokens: integer(o.sharedTotalTokens),
    sharedTotalCostUsd:
      o.sharedTotalCostUsd === null ? null : finite(o.sharedTotalCostUsd),
  };
}
export function parseCompilerAbReportV1(value: unknown): CompilerAbReportV1 {
  const raw = object(value);
  const keys = [
    "version",
    "runnerVersion",
    "profile",
    "corpus",
    "startedAt",
    "completedAt",
    "cases",
    "aggregates",
  ];
  if ("evaluatorMetadata" in raw) keys.push("evaluatorMetadata");
  const o = strict(raw, keys);
  if (o.version !== 1 || o.runnerVersion !== "compiler-ab-v1") fail();
  const profile = strict(o.profile, ["id", "model"]);
  const corpus = strict(o.corpus, ["total", "contentSha256"]);
  const casesRaw = Array.isArray(o.cases) ? o.cases : fail();
  if (casesRaw.length > 1000) fail();
  const cases = casesRaw.map(parseCaseResult);
  const metadata =
    o.evaluatorMetadata === undefined
      ? undefined
      : (() => {
          const r = object(o.evaluatorMetadata);
          const metadataKeys = ["provider", "model", "promptVersion"];
          if ("reasoning" in r) metadataKeys.push("reasoning");
          const m = strict(r, metadataKeys);
          return {
            provider: text(m.provider, 100),
            model: text(m.model, 200),
            promptVersion: text(m.promptVersion, 100),
            ...(m.reasoning === undefined
              ? {}
              : { reasoning: text(m.reasoning, 50) }),
          };
        })();
  const aggregates = parseAggregates(o.aggregates);
  if (
    integer(corpus.total, 0, 1000) !== cases.length ||
    JSON.stringify(aggregates) !==
      JSON.stringify(computeCompilerAbAggregates(cases))
  )
    fail();
  return {
    version: 1,
    runnerVersion: "compiler-ab-v1",
    profile: { id: text(profile.id, 100), model: text(profile.model, 200) },
    corpus: {
      total: integer(corpus.total, 0, 1000),
      contentSha256: sha256(corpus.contentSha256),
    },
    ...(metadata ? { evaluatorMetadata: metadata } : {}),
    startedAt: date(o.startedAt),
    completedAt: date(o.completedAt),
    cases,
    aggregates,
  };
}

export function evaluateCompilerAbInvariants(
  caseItem: BenchmarkCaseV1,
  intent: IntentDocumentV1 | undefined,
  compiled: CompiledTask | undefined,
  includeOriginalRequest: boolean,
): InvariantResult {
  const result = evaluateInvariants(caseItem, intent, compiled);
  if (includeOriginalRequest || !compiled) return result;
  const checks = result.checks.map((check) =>
    check.name === "original_request_fenced"
      ? {
          name: "original_request_omitted",
          passed: !compiled.text.includes("## Original user request"),
          ...(!compiled.text.includes("## Original user request") ||
          check.detail === undefined
            ? {}
            : { detail: "heading present" }),
        }
      : check,
  );
  return { passed: checks.every((check) => check.passed), checks };
}

export interface CompilerAbRunOptions {
  profileId: string;
  profile: {
    model: string;
    pricing?: { inputPerMillion?: number; outputPerMillion?: number };
  };
  cases: BenchmarkCaseV1[];
  provider: IntentProvider;
  evaluator?: BenchmarkEvaluator;
  concurrency?: number;
  signal?: AbortSignal;
  now?: () => Date;
  contextDir?: string;
  injectClock?: { nowMs: () => number };
}
async function evaluate(
  evaluator: BenchmarkEvaluator,
  caseItem: BenchmarkCaseV1,
  project: Awaited<ReturnType<typeof loadContextFixture>>,
  intent: IntentDocumentV1,
  compiled: CompiledTask,
  nowMs: () => number,
): Promise<
  Pick<
    CompilerAbModeResult,
    "evaluation" | "evaluatorError" | "evaluatorLatencyMs"
  >
> {
  const started = nowMs();
  try {
    return {
      evaluation: parseBenchmarkEvaluationV1(
        await evaluator.evaluate({
          caseId: caseItem.id,
          source: {
            originalText: caseItem.input,
            sourceLanguage: caseItem.language,
            messageType: caseItem.messageType,
            attachmentSummary: {
              imageCount: caseItem.attachments?.imageCount ?? 0,
            },
            projectContext: project,
          },
          candidate: { intent, compiledTask: compiled },
        }),
      ),
      evaluatorLatencyMs: nowMs() - started,
    };
  } catch {
    return {
      evaluatorError: "EVALUATOR_FAILED",
      evaluatorLatencyMs: nowMs() - started,
    };
  }
}
function shared(trace: BridgeTraceV1 | undefined) {
  return {
    ...(trace?.latencyMs === undefined
      ? {}
      : { sharedProviderLatencyMs: trace.latencyMs }),
    ...(trace?.tokenUsage ? { sharedTokenUsage: trace.tokenUsage } : {}),
    ...(trace?.estimatedCostUsd === undefined
      ? {}
      : { sharedEstimatedCostUsd: trace.estimatedCostUsd }),
  };
}
export async function runCompilerAbBenchmark(
  options: CompilerAbRunOptions,
): Promise<CompilerAbCaseResult[]> {
  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error("BENCHMARK_CONCURRENCY_INVALID");
  const clock = options.injectClock?.nowMs ?? Date.now;
  const results: CompilerAbCaseResult[] = new Array(options.cases.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= options.cases.length) return;
      const item = options.cases[index];
      if (!item) return;
      if (options.signal?.aborted) {
        results[index] = {
          caseId: item.id,
          title: item.title,
          status: "skipped",
        };
        continue;
      }
      try {
        const traces: BridgeTraceV1[] = [];
        const project = await loadContextFixture(
          options.contextDir,
          item.contextFixture,
        );
        if (options.signal?.aborted) {
          results[index] = {
            caseId: item.id,
            title: item.title,
            status: "skipped",
          };
          continue;
        }
        let trueCompileLatencyMs = 0;
        const trueCompiler = new PiCompilerV1({ includeOriginalRequest: true });
        const pipeline = new InterpretationPipeline(
          options.provider,
          {
            compile(input: Parameters<PiCompilerV1["compile"]>[0]) {
              const started = clock();
              try {
                return trueCompiler.compile(input);
              } finally {
                trueCompileLatencyMs = clock() - started;
              }
            },
          },
          { append: async (trace) => void traces.push(trace) },
          options.now,
        );
        const out = await pipeline.run(
          {
            traceId: `compiler-ab-${options.profileId}-${item.id}`,
            receivedAt: (options.now ?? (() => new Date()))().toISOString(),
            harness: "pi",
            messageType: item.messageType,
            source: "rpc",
            originalText: item.input,
            attachmentSummary: {
              imageCount: item.attachments?.imageCount ?? 0,
            },
            project,
          },
          {
            mode: "auto",
            logging: { mode: "full", retentionDays: 1 },
            providerProfileId: options.profileId,
            model: options.profile.model,
            ...(options.profile.pricing
              ? { pricing: options.profile.pricing }
              : {}),
            promptVersion: "openai-compatible-v1",
            retryPolicy: BENCHMARK_NO_RETRY_POLICY,
            ...(options.signal ? { signal: options.signal } : {}),
          },
        );
        const trace = traces[0];
        if (options.signal?.aborted) {
          results[index] = {
            caseId: item.id,
            title: item.title,
            status: "skipped",
          };
          continue;
        }
        if (out.status !== "transformed") {
          results[index] = {
            caseId: item.id,
            title: item.title,
            status: "fail_open",
            errorCode: SAFE_CASE_ERROR,
            ...shared(trace),
          };
          continue;
        }
        const latest = pipeline.getLatest();
        if (!latest) throw new Error(SAFE_CASE_ERROR);
        const falseStarted = clock();
        const compiledFalse = new PiCompilerV1({
          includeOriginalRequest: false,
        }).compile({
          intent: out.intent,
          originalText: item.input,
          attachmentSummary: { imageCount: item.attachments?.imageCount ?? 0 },
          assessment: out.assessment,
        });
        const falseCompileLatencyMs = clock() - falseStarted;
        const compiledTrue = latest.compiledTask;
        const trueMode: CompilerAbModeResult = {
          includeOriginalRequest: true,
          charCount: compiledTrue.text.length,
          byteCount: Buffer.byteLength(compiledTrue.text, "utf8"),
          compileLatencyMs: trueCompileLatencyMs,
          invariant: evaluateCompilerAbInvariants(
            item,
            out.intent,
            compiledTrue,
            true,
          ),
        };
        const falseMode: CompilerAbModeResult = {
          includeOriginalRequest: false,
          charCount: compiledFalse.text.length,
          byteCount: Buffer.byteLength(compiledFalse.text, "utf8"),
          compileLatencyMs: falseCompileLatencyMs,
          invariant: evaluateCompilerAbInvariants(
            item,
            out.intent,
            compiledFalse,
            false,
          ),
        };
        if (options.evaluator) {
          Object.assign(
            trueMode,
            await evaluate(
              options.evaluator,
              item,
              project,
              out.intent,
              compiledTrue,
              clock,
            ),
          );
          Object.assign(
            falseMode,
            await evaluate(
              options.evaluator,
              item,
              project,
              out.intent,
              compiledFalse,
              clock,
            ),
          );
        }
        results[index] = {
          caseId: item.id,
          title: item.title,
          status: "transformed",
          ...shared(trace),
          trueMode,
          falseMode,
        };
      } catch {
        results[index] = {
          caseId: item.id,
          title: item.title,
          status: options.signal?.aborted ? "skipped" : "fail_open",
          ...(options.signal?.aborted ? {} : { errorCode: SAFE_CASE_ERROR }),
        } as CompilerAbCaseResult;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, options.cases.length) }, worker),
  );
  return results;
}

function nearestRank(values: readonly number[]): number | null {
  return values.length
    ? (values[Math.max(0, Math.ceil(values.length * 0.5) - 1)] ?? null)
    : null;
}
export function computeCompilerAbAggregates(
  results: CompilerAbCaseResult[],
): CompilerAbAggregates {
  const transformed = results.filter(
    (
      result,
    ): result is Extract<CompilerAbCaseResult, { status: "transformed" }> =>
      result.status === "transformed",
  );
  const charDeltas: number[] = transformed.map(
    (r) => r.trueMode.charCount - r.falseMode.charCount,
  );
  const byteDeltas: number[] = transformed.map(
    (r) => r.trueMode.byteCount - r.falseMode.byteCount,
  );
  const chars = [...charDeltas].sort((a, b) => a - b);
  const bytes = [...byteDeltas].sort((a, b) => a - b);
  const count = transformed.length;
  const mode = (key: "trueMode" | "falseMode") =>
    transformed.map((result) => result[key]);
  const trueModes = mode("trueMode"),
    falseModes = mode("falseMode");
  const sum = (values: number[]) =>
    values.reduce((total, value) => total + value, 0);
  const attempted = results.filter(
    (result) => result.status !== "skipped",
  ).length;
  const token = (key: "input" | "output" | "total") =>
    sum(
      results.map((r) =>
        r.status === "skipped" ? 0 : (r.sharedTokenUsage?.[key] ?? 0),
      ),
    );
  const costs = results.flatMap((r) =>
    r.status === "skipped" || r.sharedEstimatedCostUsd === undefined
      ? []
      : [r.sharedEstimatedCostUsd],
  );
  const attempts = (modes: CompilerAbModeResult[]) =>
    modes.filter((m) => m.evaluatorLatencyMs !== undefined);
  const trueAttempts = attempts(trueModes),
    falseAttempts = attempts(falseModes);
  return {
    total: results.length,
    attempted,
    transformed: count,
    failOpen: results.filter((r) => r.status === "fail_open").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    pairedCount: count,
    charDeltaMean: count ? sum(chars) / count : null,
    charDeltaMedian: nearestRank(chars),
    byteDeltaMean: count ? sum(bytes) / count : null,
    byteDeltaMedian: nearestRank(bytes),
    charReductionCount: chars.filter((v) => v > 0).length,
    byteReductionCount: bytes.filter((v) => v > 0).length,
    trueInvariantPassCount: trueModes.filter((m) => m.invariant.passed).length,
    falseInvariantPassCount: falseModes.filter((m) => m.invariant.passed)
      .length,
    trueInvariantPassRate: count
      ? trueModes.filter((m) => m.invariant.passed).length / count
      : null,
    falseInvariantPassRate: count
      ? falseModes.filter((m) => m.invariant.passed).length / count
      : null,
    falseOriginalOmissionPassCount: falseModes.filter((m) =>
      m.invariant.checks.some(
        (check) => check.name === "original_request_omitted" && check.passed,
      ),
    ).length,
    evaluatorTrueAttempts: trueAttempts.length,
    evaluatorTrueSuccesses: trueAttempts.filter(
      (m) => m.evaluation !== undefined,
    ).length,
    evaluatorTrueErrors: trueAttempts.filter(
      (m) => m.evaluatorError !== undefined,
    ).length,
    evaluatorFalseAttempts: falseAttempts.length,
    evaluatorFalseSuccesses: falseAttempts.filter(
      (m) => m.evaluation !== undefined,
    ).length,
    evaluatorFalseErrors: falseAttempts.filter(
      (m) => m.evaluatorError !== undefined,
    ).length,
    evaluatorTrueGoodRatingCount: trueModes.filter(
      (m) => m.evaluation?.rating === "good",
    ).length,
    evaluatorFalseGoodRatingCount: falseModes.filter(
      (m) => m.evaluation?.rating === "good",
    ).length,
    evaluatorTrueClearerOrEqualCount: trueModes.filter(
      (m) =>
        m.evaluation?.clarity !== undefined &&
        m.evaluation.clarity !== "less_clear",
    ).length,
    evaluatorFalseClearerOrEqualCount: falseModes.filter(
      (m) =>
        m.evaluation?.clarity !== undefined &&
        m.evaluation.clarity !== "less_clear",
    ).length,
    sharedTotalInputTokens: token("input"),
    sharedTotalOutputTokens: token("output"),
    sharedTotalTokens: token("total"),
    sharedTotalCostUsd: costs.length ? sum(costs) : null,
  };
}
export function createCompilerAbReportV1(input: {
  profile: { id: string; model: string };
  corpus: { total: number; contentSha256: string };
  evaluatorMetadata?: CompilerAbReportV1["evaluatorMetadata"];
  startedAt: string;
  completedAt: string;
  cases: CompilerAbCaseResult[];
}): CompilerAbReportV1 {
  return parseCompilerAbReportV1({
    version: 1,
    runnerVersion: "compiler-ab-v1",
    profile: input.profile,
    corpus: input.corpus,
    ...(input.evaluatorMetadata
      ? { evaluatorMetadata: input.evaluatorMetadata }
      : {}),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    cases: input.cases,
    aggregates: computeCompilerAbAggregates(input.cases),
  });
}
export function renderCompilerAbSummary(report: CompilerAbReportV1): string {
  const a = report.aggregates;
  return JSON.stringify({
    profile: report.profile,
    evaluator: report.evaluatorMetadata ?? null,
    total: a.total,
    attempted: a.attempted,
    transformed: a.transformed,
    failOpen: a.failOpen,
    skipped: a.skipped,
    pairedCount: a.pairedCount,
    charDeltaMean: a.charDeltaMean,
    charDeltaMedian: a.charDeltaMedian,
    byteDeltaMean: a.byteDeltaMean,
    byteDeltaMedian: a.byteDeltaMedian,
    trueInvariantPassRate: a.trueInvariantPassRate,
    falseInvariantPassRate: a.falseInvariantPassRate,
    falseOriginalOmissionPassCount: a.falseOriginalOmissionPassCount,
    evaluatorTrueAttempts: a.evaluatorTrueAttempts,
    evaluatorTrueSuccesses: a.evaluatorTrueSuccesses,
    evaluatorTrueErrors: a.evaluatorTrueErrors,
    evaluatorFalseAttempts: a.evaluatorFalseAttempts,
    evaluatorFalseSuccesses: a.evaluatorFalseSuccesses,
    evaluatorFalseErrors: a.evaluatorFalseErrors,
    sharedTotalTokens: a.sharedTotalTokens,
    sharedTotalCostUsd: a.sharedTotalCostUsd,
  });
}
