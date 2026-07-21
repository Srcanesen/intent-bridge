import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadLayeredConfig } from "@intent-bridge/core";
import {
  parseBenchmarkReport,
  parseBenchmarkReportV2,
  parseOwnerReviewV1,
} from "./contracts.js";
import { loadBenchmarkCases, validateReviewedDataset } from "./fixtures.js";
import {
  applyOwnerReview,
  compareReports,
  createReportV2,
  sanitize,
  writeReport,
} from "./report.js";
import { runBenchmark } from "./runner.js";
import { exportTraces } from "./trace-export.js";
import {
  validatePtV1Corpus,
  parsePtV1Manifest,
  parsePtV1GoldAnnotation,
} from "./pt-v1-validator.js";
import { summarizePtV1 } from "./pt-v1-summarizer.js";

const help = `benchmark validate-fixtures [--cases dir]
benchmark run --profile id [--cases dir] [--contexts dir] [--out dir] [--concurrency 2]
benchmark compare a.json b.json [--out file]
benchmark apply-review report.json review.json --out final.json
benchmark export-traces trace.jsonl --out dir [--trace-id id]
benchmark pt-v1 validate [--cases dir] [--smoke dir] [--manifest path] [--annotations path] [--smoke-annotations path]
benchmark pt-v1 audit [--cases dir] [--smoke dir] [--manifest path] [--annotations path] [--smoke-annotations path]
benchmark pt-v1 summarize <report.json> <manifest.json> <annotations.json> [--out file]
`;
const value = (args: string[], key: string, fallback?: string) => {
  const index = args.indexOf(key);
  if (index < 0) return fallback;
  const found = args[index + 1];
  if (!found || found.startsWith("--"))
    throw new Error("BENCHMARK_ARGUMENTS_INVALID");
  return found;
};

export async function main(input = process.argv.slice(2)) {
  const args = input[0] === "--" ? input.slice(1) : input;
  const command = args[0];
  if (!command || command === "help" || command === "--help") {
    console.log(help);
    return;
  }
  if (command === "validate-fixtures") {
    const casesDir = value(args, "--cases", "benchmarks/cases");
    if (!casesDir) throw new Error("BENCHMARK_ARGUMENTS_INVALID");
    const cases = await loadBenchmarkCases(casesDir);
    validateReviewedDataset(cases);
    console.log(`validated ${cases.length} reviewed cases`);
    return;
  }
  if (command === "compare") {
    const leftPath = args[1];
    const rightPath = args[2];
    if (
      !leftPath ||
      !rightPath ||
      leftPath.startsWith("--") ||
      rightPath.startsWith("--")
    )
      throw new Error("BENCHMARK_ARGUMENTS_INVALID");
    const comparison = sanitize(
      compareReports(
        parseBenchmarkReport(await readJson(leftPath)),
        parseBenchmarkReport(await readJson(rightPath)),
      ),
    );
    const output = `${JSON.stringify(comparison, null, 2)}\n`;
    const out = value(args, "--out");
    if (out) await writeFile(out, output);
    else console.log(output.trimEnd());
    return;
  }
  if (command === "apply-review") {
    const reportPath = args[1];
    const reviewPath = args[2];
    const out = value(args, "--out");
    if (
      !reportPath ||
      !reviewPath ||
      reportPath.startsWith("--") ||
      reviewPath.startsWith("--") ||
      !out
    )
      throw new Error("BENCHMARK_ARGUMENTS_INVALID");
    const source = parseBenchmarkReport(await readJson(reportPath));
    if (source.version !== 2) throw new Error("BENCHMARK_REPORT_V2_REQUIRED");
    const finalReport = parseBenchmarkReportV2(
      sanitize(
        applyOwnerReview(
          source,
          parseOwnerReviewV1(await readJson(reviewPath)),
        ),
      ),
    );
    await writeFile(out, `${JSON.stringify(finalReport, null, 2)}\n`);
    console.log(`wrote ${out}`);
    return;
  }
  if (command === "export-traces") {
    const path = args[1];
    const out = value(args, "--out");
    if (!path || path.startsWith("--") || !out)
      throw new Error("BENCHMARK_ARGUMENTS_INVALID");
    const ids = args.flatMap((arg, index) => {
      if (arg !== "--trace-id") return [];
      const id = args[index + 1];
      if (!id || id.startsWith("--"))
        throw new Error("BENCHMARK_ARGUMENTS_INVALID");
      return [id];
    });
    await exportTraces(path, out, ids);
    return;
  }
  if (command === "pt-v1" && args[1] === "validate") {
    const result = await validatePtV1Corpus(
      value(args, "--cases"),
      value(args, "--smoke"),
      value(args, "--manifest"),
      value(args, "--annotations"),
      value(args, "--smoke-annotations"),
      value(args, "--rubric"),
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) {
      console.error(`\nPT_V1_CORPUS_INVALID: ${result.errors.length} error(s)`);
      for (const err of result.errors) console.error(`  - ${err}`);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "pt-v1" && args[1] === "audit") {
    const result = await validatePtV1Corpus(
      value(args, "--cases"),
      value(args, "--smoke"),
      value(args, "--manifest"),
      value(args, "--annotations"),
      value(args, "--smoke-annotations"),
      value(args, "--rubric"),
    );
    console.log(
      JSON.stringify(
        {
          valid: result.valid,
          confirmatory: result.annotationCoverage.confirmatory,
          smoke: result.annotationCoverage.smoke,
        },
        null,
        2,
      ),
    );
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (command === "pt-v1" && args[1] === "summarize") {
    const reportPath = args[2];
    const manifestPath = args[3];
    const annotationsPath = args[4];
    if (
      !reportPath ||
      reportPath.startsWith("--") ||
      !manifestPath ||
      manifestPath.startsWith("--") ||
      !annotationsPath ||
      annotationsPath.startsWith("--")
    )
      throw new Error("BENCHMARK_ARGUMENTS_INVALID");
    const report = parseBenchmarkReport(await readJson(reportPath));
    if (report.version !== 2) throw new Error("BENCHMARK_REPORT_V2_REQUIRED");
    const manifest = parsePtV1Manifest(await readJson(manifestPath));
    const annotationsRaw = await readJson(annotationsPath);
    if (!Array.isArray(annotationsRaw))
      throw new Error("BENCHMARK_ANNOTATIONS_INVALID");
    const annotations = annotationsRaw.map((item) =>
      parsePtV1GoldAnnotation(item),
    );
    const output = sanitize(summarizePtV1({ report, manifest, annotations }));
    const json = `${JSON.stringify(output, null, 2)}\n`;
    const out = value(args, "--out");
    if (out) await writeFile(out, json);
    else console.log(json.trimEnd());
    return;
  }
  if (command === "run") {
    if (process.env.INTENT_BRIDGE_LIVE_TESTS !== "1")
      throw new Error("BENCHMARK_LIVE_TESTS_REQUIRED");
    const id = value(args, "--profile");
    if (!id) throw new Error("BENCHMARK_PROFILE_REQUIRED");
    const config = await loadLayeredConfig({ projectTrusted: false });
    const profile = config.profiles[id];
    if (!profile) throw new Error("BENCHMARK_PROFILE_MISSING");
    const casesDir = value(args, "--cases", "benchmarks/cases");
    const contextDir = value(args, "--contexts", "benchmarks/contexts");
    const concurrency = Number(value(args, "--concurrency", "2"));
    if (!casesDir || !contextDir)
      throw new Error("BENCHMARK_ARGUMENTS_INVALID");
    const startedAt = new Date().toISOString();
    const results = await runBenchmark({
      profileId: id,
      profile,
      cases: await loadBenchmarkCases(casesDir),
      concurrency,
      contextDir,
    });
    await writeReport(
      value(args, "--out", "benchmarks/out") ?? "benchmarks/out",
      createReportV2({
        profile: { id, model: profile.model },
        schemaVersion: "2",
        promptVersion: "openai-compatible-v2",
        compilerVersion: "pi-v2",
        startedAt,
        completedAt: new Date().toISOString(),
        concurrency,
        results,
      }),
    );
    return;
  }
  throw new Error("BENCHMARK_COMMAND_INVALID");
}
async function readJson(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error("BENCHMARK_JSON_INVALID");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "BENCHMARK_FAILED");
    process.exitCode = 1;
  });
