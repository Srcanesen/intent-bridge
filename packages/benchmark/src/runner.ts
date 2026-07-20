import {
  InterpretationPipeline,
  PiCompilerV1,
  type BridgeTraceV1,
  type IntentProvider,
  type ProviderProfileV1,
  type RetryPolicyV1,
} from "@intent-bridge/core";
import { OpenAICompatibleProvider } from "@intent-bridge/provider-openai-compatible";
import {
  parseBenchmarkEvaluationV1,
  type BenchmarkCaseV1,
  type BenchmarkEvaluator,
  type BenchmarkResultV1,
} from "./contracts.js";
import { loadContextFixture } from "./fixtures.js";
import { evaluateInvariants } from "./invariants.js";

const BENCHMARK_NO_RETRY_POLICY: RetryPolicyV1 = {
  maxRetries: 0,
  baseDelayMs: 250,
  totalBudgetMs: 45000,
};

const skipped = (item: BenchmarkCaseV1): BenchmarkResultV1 => ({
  caseId: item.id,
  title: item.title,
  tags: item.tags,
  status: "skipped",
  invariant: { passed: false, checks: [{ name: "skipped", passed: false }] },
});
const failed = (
  item: BenchmarkCaseV1,
  errorCode: string,
): BenchmarkResultV1 => ({
  caseId: item.id,
  title: item.title,
  tags: item.tags,
  status: "fail_open",
  errorCode,
  invariant: {
    passed: false,
    checks: [{ name: "transformed", passed: false }],
  },
});

export async function runBenchmark(options: {
  profileId: string;
  profile: ProviderProfileV1;
  cases: BenchmarkCaseV1[];
  provider?: IntentProvider;
  evaluator?: BenchmarkEvaluator;
  concurrency?: number;
  signal?: AbortSignal;
  now?: () => Date;
  contextDir?: string;
}): Promise<BenchmarkResultV1[]> {
  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error("BENCHMARK_CONCURRENCY_INVALID");
  const provider =
    options.provider ?? new OpenAICompatibleProvider(options.profile);
  const results: BenchmarkResultV1[] = new Array(options.cases.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= options.cases.length) return;
      const item = options.cases[index];
      if (!item) return;
      if (options.signal?.aborted) {
        results[index] = skipped(item);
        continue;
      }
      try {
        const traces: BridgeTraceV1[] = [];
        const pipeline = new InterpretationPipeline(
          provider,
          new PiCompilerV1(),
          { append: async (trace) => void traces.push(trace) },
          options.now,
        );
        const project = await loadContextFixture(
          options.contextDir,
          item.contextFixture,
        );
        if (options.signal?.aborted) {
          results[index] = skipped(item);
          continue;
        }
        const out = await pipeline.run(
          {
            traceId: `benchmark-${options.profileId}-${item.id}`,
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
        const latest = pipeline.getLatest();
        const invariant = evaluateInvariants(
          item,
          out.status === "transformed" ? out.intent : undefined,
          out.status === "transformed" ? latest?.compiledTask : undefined,
        );
        const result: BenchmarkResultV1 = {
          caseId: item.id,
          title: item.title,
          tags: item.tags,
          status: out.status,
          ...(out.status === "fail_open" ? { errorCode: out.errorCode } : {}),
          ...(trace?.latencyMs === undefined
            ? {}
            : { latencyMs: trace.latencyMs }),
          ...(trace?.tokenUsage ? { tokenUsage: trace.tokenUsage } : {}),
          ...(trace?.estimatedCostUsd === undefined
            ? {}
            : { estimatedCostUsd: trace.estimatedCostUsd }),
          ...(trace?.quality ? { quality: trace.quality } : {}),
          invariant,
        };
        if (options.evaluator && out.status === "transformed") {
          try {
            const compiledTask = latest?.compiledTask;
            if (!compiledTask) throw new Error("EVALUATOR_FAILED");
            result.evaluation = parseBenchmarkEvaluationV1(
              await options.evaluator.evaluate({
                caseId: item.id,
                source: {
                  originalText: item.input,
                  sourceLanguage: item.language,
                  messageType: item.messageType,
                  attachmentSummary: {
                    imageCount: item.attachments?.imageCount ?? 0,
                  },
                  projectContext: project,
                },
                candidate: {
                  intent: out.intent,
                  compiledTask,
                },
              }),
            );
          } catch {
            result.evaluatorError = "EVALUATOR_FAILED";
          }
        }
        results[index] = result;
      } catch {
        results[index] = failed(item, "BENCHMARK_CASE_FAILED");
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, options.cases.length) }, () =>
      worker(),
    ),
  );
  return results;
}
