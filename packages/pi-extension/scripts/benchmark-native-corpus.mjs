#!/usr/bin/env node
import { mkdir, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  benchmarkReportSha256,
  createCompilerAbReportV1,
  createCorpusMetadata,
  createReportV2,
  loadBenchmarkCases,
  parseBenchmarkReportV2,
  parseCompilerAbReportV1,
  renderCompilerAbSummary,
  runBenchmark,
  runCompilerAbBenchmark,
  sanitize,
  writeReport,
} from "../../benchmark/dist/index.js";
import {
  createPiProvider,
  PI_NATIVE_PROMPT_VERSION,
} from "../dist/pi-native-provider.js";
import {
  createPiBenchmarkEvaluator,
  parseEvaluatorReasoning,
  PI_BENCHMARK_EVALUATOR_PROMPT_VERSION,
} from "./pi-benchmark-evaluator.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(dirname(scriptDir)));
const defaultCasesDir = join(repoRoot, "benchmarks", "cases");
const defaultContextDir = join(repoRoot, "benchmarks", "contexts");

export function parseArgs(argv) {
  const out = { concurrency: 2, "compiler-ab": false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg || arg === "--") continue;
    if (arg === "--help" || arg === "-h") return { help: true };
    if (!arg.startsWith("--")) throw new Error("CONFIG_INVALID");
    const key = arg.slice(2);
    if (key === "compiler-ab") {
      out["compiler-ab"] = true;
    } else if (
      [
        "provider",
        "model",
        "evaluator-provider",
        "evaluator-model",
        "evaluator-reasoning",
        "out",
        "review-bundle",
        "ids",
        "cases",
        "contexts",
        "concurrency",
      ].includes(key)
    ) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--"))
        throw new Error("CONFIG_INVALID");
      out[key === "concurrency" ? "concurrency" : key] = value;
    } else throw new Error("CONFIG_INVALID");
  }
  if (out.help) return out;
  if (!out.provider || !out.model) throw new Error("CONFIG_INVALID");
  const hasEvaluatorProvider = Boolean(out["evaluator-provider"]);
  const hasEvaluatorModel = Boolean(out["evaluator-model"]);
  const hasEvaluatorReasoning = Boolean(out["evaluator-reasoning"]);
  if (
    hasEvaluatorProvider !== hasEvaluatorModel ||
    (hasEvaluatorReasoning && !hasEvaluatorProvider) ||
    (out["review-bundle"] && !hasEvaluatorProvider)
  )
    throw new Error("CONFIG_INVALID");
  if (
    hasEvaluatorProvider &&
    out.provider === out["evaluator-provider"] &&
    out.model === out["evaluator-model"]
  )
    throw new Error("CONFIG_INVALID");
  const concurrency = Number(out.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("CONFIG_INVALID");
  }
  out.concurrency = concurrency;
  if (hasEvaluatorReasoning)
    out["evaluator-reasoning"] = parseEvaluatorReasoning(
      out["evaluator-reasoning"],
    );
  return out;
}

export function selectCases(cases, idsRaw) {
  if (!idsRaw) return cases;
  const wanted = new Set(
    String(idsRaw)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!wanted.size) throw new Error("CONFIG_INVALID");
  const filtered = cases.filter((item) => wanted.has(item.id));
  if (filtered.length !== wanted.size) throw new Error("CONFIG_INVALID");
  return filtered;
}

export const HELP = `Usage: benchmark-native-corpus --provider <name> --model <id> [--evaluator-provider <name> --evaluator-model <id> [--evaluator-reasoning <off|minimal|low|medium|high|xhigh|max>] [--review-bundle <file>]] [--concurrency 1..4] [--ids id1,id2,...] [--out <dir>] [--cases <dir>] [--contexts <dir>] [--compiler-ab]

Requires INTENT_BRIDGE_LIVE_TESTS=1. Uses one Pi ModelRuntime and writes a sanitized Benchmark Report V2 directory. Context fixtures default to benchmarks/contexts; a missing context directory is harmless for cases without a contextFixture. The optional evaluator arguments are required together; --review-bundle has no default and requires them. The exact candidate provider/model pair is rejected, while the same provider with a different model is allowed. Each transformed case is transmitted once to the explicitly selected second evaluator provider with no retries, reasoning selected by --evaluator-reasoning (default off, bounded to Pi ModelThinkingLevel values), no cache retention, and a 30s timeout. The model output is not human review.

With --compiler-ab, runs the Compiler A/B benchmark: one interpretation call per case, then compiles twice locally (includeOriginalRequest=true|false) from the same intent. Up to two evaluator calls per transformed case (one per mode) when --evaluator-* is configured. Reports character (JS string length) and UTF-8 byte deltas between modes, mode-aware invariant results, and optional evaluator summaries. Characters/bytes are NOT token counts. Provider token usage is shared and interpreter-only. Does not measure downstream Pi coding outcome.

Default behavior (no --compiler-ab) remains exactly as documented above.

Stdout contains only safe candidate/evaluator identity, V2 structural, deterministic safety, evaluator, explicitly labeled literal diagnostic and language rates, latency/token/cost aggregates, and thresholds. No legacy invariantPassRate, case results, IDs, titles, corpus request/intent/compiled-task text, provider error bodies, or review-bundle content/path are written to stdout. Without an evaluator, Report V2 is still emitted and evaluator thresholds remain unavailable.`;

export function runCorpusBenchmark(options, execute = runBenchmark) {
  return execute(options);
}

export function wrapEvaluatorForReview(evaluator, evidence) {
  return {
    evaluate(input) {
      evidence.push(input);
      return evaluator.evaluate(input);
    },
  };
}

export function canonicalizePersistedReport(report) {
  return parseBenchmarkReportV2(sanitize(parseBenchmarkReportV2(report)));
}

export function buildReviewBundle({ report, evidence, generatedAt }) {
  const source = parseBenchmarkReportV2(report);
  const transformed = source.results.filter(
    (result) => result.status === "transformed",
  );
  const expectedIds = transformed.map((result) => result.caseId);
  const capturedIds = evidence.map((input) => input?.caseId);
  if (
    new Set(expectedIds).size !== expectedIds.length ||
    new Set(capturedIds).size !== capturedIds.length ||
    capturedIds.length !== expectedIds.length ||
    capturedIds.some((caseId) => !expectedIds.includes(caseId))
  )
    throw new Error("REVIEW_BUNDLE_EVIDENCE_INVALID");
  if (
    transformed.some(
      (result) => Boolean(result.evaluation) === Boolean(result.evaluatorError),
    )
  )
    throw new Error("REVIEW_BUNDLE_EVIDENCE_INVALID");
  const byId = new Map(evidence.map((input) => [input.caseId, input]));
  const sourceReportSha256 = benchmarkReportSha256(source);
  return {
    version: "pi-native-review-bundle-v1",
    generatedAt,
    sourceReportSha256,
    profile: source.profile,
    evaluator: source.evaluator,
    cases: transformed.map((result) => {
      const input = byId.get(result.caseId);
      if (!input) throw new Error("REVIEW_BUNDLE_EVIDENCE_INVALID");
      return {
        caseId: result.caseId,
        source: input.source,
        candidate: input.candidate,
        ...(result.evaluation
          ? { modelEvaluation: result.evaluation }
          : { evaluatorError: result.evaluatorError ?? "EVALUATOR_FAILED" }),
      };
    }),
    reviewArtifactTemplateIncomplete: true,
    reviewArtifactTemplate: {
      version: 1,
      sourceReportSha256,
      reviewerKind: "owner-human",
      reviewedAt: null,
      manualAcceptance: null,
      cases: transformed.map((result) => ({
        profileId: source.profile.id,
        caseId: result.caseId,
        intentAltered: null,
        clarity: null,
        accepted: null,
      })),
    },
  };
}

export async function writeReviewBundle(path, bundle) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const file = await open(path, "w", 0o600);
    try {
      await file.chmod(0o600);
      await file.writeFile(`${JSON.stringify(bundle, null, 2)}\n`);
    } finally {
      await file.close();
    }
  } catch {
    throw new Error("REVIEW_BUNDLE_WRITE_FAILED");
  }
}

export async function runCorpus({
  provider,
  model,
  concurrency,
  cases,
  evaluatorProvider,
  evaluatorModel,
  evaluatorReasoning,
  casesDir = defaultCasesDir,
  contextDir = defaultContextDir,
  outDir,
  reviewBundle,
}) {
  if (process.env.INTENT_BRIDGE_LIVE_TESTS !== "1") {
    throw new Error("BENCHMARK_LIVE_TESTS_REQUIRED");
  }
  if (!provider || !model) throw new Error("CONFIG_INVALID");
  if (
    Boolean(evaluatorProvider) !== Boolean(evaluatorModel) ||
    (reviewBundle && !evaluatorProvider)
  )
    throw new Error("CONFIG_INVALID");
  if (provider === evaluatorProvider && model === evaluatorModel)
    throw new Error("CONFIG_INVALID");
  const reasoning = parseEvaluatorReasoning(evaluatorReasoning);
  const runtime = await ModelRuntime.create();
  const available = await runtime.getAvailable();
  const selectModel = (providerName, modelId) => {
    const selected = available.find(
      (item) => item.provider === providerName && item.id === modelId,
    );
    if (!selected || selected.thinkingLevelMap?.off === null)
      throw new Error("CONFIG_INVALID");
    return selected;
  };
  const selected = selectModel(provider, model);
  const evaluatorSelected = evaluatorProvider
    ? selectModel(evaluatorProvider, evaluatorModel)
    : undefined;
  const allCases = await loadBenchmarkCases(casesDir);
  const finalCases = cases ?? allCases;
  if (!finalCases.length) throw new Error("CONFIG_INVALID");
  const pricing =
    selected.cost &&
    Number.isFinite(selected.cost.input) &&
    Number.isFinite(selected.cost.output)
      ? {
          inputPerMillion: selected.cost.input,
          outputPerMillion: selected.cost.output,
        }
      : undefined;
  const profileId = `pi:${provider}:${model}`;
  const startedAt = new Date().toISOString();
  const reviewEvidence = [];
  const evaluator = evaluatorSelected
    ? createPiBenchmarkEvaluator(runtime, evaluatorSelected, {
        reasoning,
      })
    : undefined;
  const results = await runCorpusBenchmark({
    profileId,
    profile: { model, ...(pricing ? { pricing } : {}) },
    cases: finalCases,
    provider: createPiProvider(runtime, selected),
    ...(evaluator
      ? {
          evaluator: reviewBundle
            ? wrapEvaluatorForReview(evaluator, reviewEvidence)
            : evaluator,
        }
      : {}),
    concurrency,
    contextDir,
  });
  const report = createReportV2({
    profile: { id: profileId, model },
    schemaVersion: "2",
    promptVersion: PI_NATIVE_PROMPT_VERSION,
    compilerVersion: "pi-v2",
    startedAt,
    completedAt: new Date().toISOString(),
    concurrency,
    results,
    corpus: createCorpusMetadata(finalCases),
    ...(evaluatorSelected
      ? {
          evaluator: {
            provider: evaluatorSelected.provider,
            model: evaluatorSelected.id,
            promptVersion: PI_BENCHMARK_EVALUATOR_PROMPT_VERSION,
            reasoning,
          },
        }
      : {}),
  });
  const persistedReport = canonicalizePersistedReport(report);
  const directory = outDir ?? join(repoRoot, "benchmarks", "out", profileId);
  await writeReport(directory, persistedReport);
  if (reviewBundle) {
    const bundle = buildReviewBundle({
      report: persistedReport,
      evidence: reviewEvidence,
      generatedAt: new Date().toISOString(),
    });
    await writeReviewBundle(reviewBundle, bundle);
  }
  return persistedReport;
}

export function renderAggregate(report) {
  return JSON.stringify({
    profile: report.profile,
    evaluator: report.evaluator ?? null,
    structuralPassRate: report.aggregates.structuralPassRate,
    deterministicSafetyPassRate: report.aggregates.deterministicSafetyPassRate,
    evaluatorCoverageRate: report.aggregates.evaluatorCoverageRate,
    evaluatorMaterialIntentAlterationRate:
      report.aggregates.evaluatorMaterialIntentAlterationRate,
    evaluatorClearerOrEqualRate: report.aggregates.evaluatorClearerOrEqualRate,
    literalGoalDiagnosticRate: report.aggregates.literalGoalDiagnosticRate,
    literalConstraintDiagnosticRate:
      report.aggregates.literalConstraintDiagnosticRate,
    languagePreservationRate: report.aggregates.languagePreservationRate,
    latencyP50: report.aggregates.latencyP50,
    latencyP95: report.aggregates.latencyP95,
    inputTokens: report.aggregates.inputTokens,
    outputTokens: report.aggregates.outputTokens,
    totalTokens: report.aggregates.totalTokens,
    maxOutputTokens: Math.max(
      0,
      ...report.results.map((item) => item.tokenUsage?.output ?? 0),
    ),
    totalCostUsd: report.aggregates.totalCostUsd,
    thresholds: report.thresholds,
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch {
    process.stderr.write("CONFIG_INVALID\n");
    process.exit(2);
    return;
  }
  if (args.help || !args.provider || !args.model) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (process.env.INTENT_BRIDGE_LIVE_TESTS !== "1") {
    process.stderr.write("BENCHMARK_LIVE_TESTS_REQUIRED\n");
    process.exit(2);
    return;
  }
  try {
    const casesDir = args.cases
      ? resolve(repoRoot, args.cases)
      : defaultCasesDir;
    const contextDir = args.contexts
      ? resolve(repoRoot, args.contexts)
      : defaultContextDir;
    const allCases = await loadBenchmarkCases(casesDir);
    const finalCases = selectCases(allCases, args.ids);

    if (args["compiler-ab"]) {
      // A/B benchmark path: one provider call, two local compiles per case
      process.stderr.write(
        "WARNING: Compiler A/B benchmark — one interpretation call + up to two evaluator calls " +
          "per transformed case. Characters/bytes are NOT token counts. " +
          "Downstream Pi coding outcome is not measured.\n",
      );
      const runtime = await ModelRuntime.create();
      const available = await runtime.getAvailable();
      const selected = available.find(
        (item) => item.provider === args.provider && item.id === args.model,
      );
      if (!selected) throw new Error("CONFIG_INVALID");
      const evaluatorSelected = args["evaluator-provider"]
        ? available.find(
            (item) =>
              item.provider === args["evaluator-provider"] &&
              item.id === args["evaluator-model"],
          )
        : undefined;
      const provider = createPiProvider(runtime, selected);
      const evaluator = evaluatorSelected
        ? createPiBenchmarkEvaluator(runtime, evaluatorSelected, {
            reasoning: args["evaluator-reasoning"],
          })
        : undefined;
      const pricing =
        selected.cost &&
        Number.isFinite(selected.cost.input) &&
        Number.isFinite(selected.cost.output)
          ? {
              inputPerMillion: selected.cost.input,
              outputPerMillion: selected.cost.output,
            }
          : undefined;
      const profileId = `pi:${args.provider}:${args.model}`;
      const startedAt = new Date().toISOString();
      const results = await runCompilerAbBenchmark({
        profileId,
        profile: { model: args.model, ...(pricing ? { pricing } : {}) },
        cases: finalCases,
        provider,
        ...(evaluator ? { evaluator } : {}),
        contextDir,
        concurrency: args.concurrency,
      });
      const corpus = createCorpusMetadata(finalCases);
      const abReport = createCompilerAbReportV1({
        profile: { id: profileId, model: args.model },
        corpus: { total: corpus.total, contentSha256: corpus.contentSha256 },
        ...(evaluatorSelected
          ? {
              evaluatorMetadata: {
                provider: evaluatorSelected.provider,
                model: evaluatorSelected.id,
                promptVersion: PI_BENCHMARK_EVALUATOR_PROMPT_VERSION,
                reasoning: args["evaluator-reasoning"],
              },
            }
          : {}),
        startedAt,
        completedAt: new Date().toISOString(),
        cases: results,
      });
      const persistedAbReport = parseCompilerAbReportV1(abReport);
      const outDir = args.out || "benchmarks/out";
      const outPath = resolve(
        outDir.startsWith("/") ? outDir : join(repoRoot, outDir),
        `compiler-ab-${profileId.replace(/[^a-z0-9_-]/gi, "-")}-report.json`,
      );
      await mkdir(dirname(outPath), { recursive: true });
      const fs = await open(outPath, "w", 0o600);
      try {
        await fs.writeFile(`${JSON.stringify(persistedAbReport, null, 2)}\n`);
        await fs.chmod(0o600);
      } finally {
        await fs.close();
      }
      process.stdout.write(`${renderCompilerAbSummary(persistedAbReport)}\n`);
    } else {
      const report = await runCorpus({
        provider: args.provider,
        model: args.model,
        concurrency: args.concurrency,
        evaluatorProvider: args["evaluator-provider"],
        evaluatorModel: args["evaluator-model"],
        evaluatorReasoning: args["evaluator-reasoning"],
        cases: finalCases,
        casesDir,
        contextDir,
        ...(args.out ? { outDir: args.out } : {}),
        ...(args["review-bundle"]
          ? { reviewBundle: args["review-bundle"] }
          : {}),
      });
      process.stdout.write(`${renderAggregate(report)}\n`);
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "BENCHMARK_FAILED"}\n`,
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
