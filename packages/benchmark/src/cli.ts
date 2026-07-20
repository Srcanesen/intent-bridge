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
  createReport,
  sanitize,
  writeReport,
} from "./report.js";
import { runBenchmark } from "./runner.js";
import { exportTraces } from "./trace-export.js";

const help = `benchmark validate-fixtures [--cases dir]
benchmark run --profile id [--cases dir] [--contexts dir] [--out dir] [--concurrency 2]
benchmark compare a.json b.json [--out file]
benchmark apply-review report.json review.json --out final.json
benchmark export-traces trace.jsonl --out dir [--trace-id id]
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
      createReport({
        profile: { id, model: profile.model },
        schemaVersion: "1",
        promptVersion: "openai-compatible-v1",
        compilerVersion: "pi-v1",
        runnerVersion: "benchmark-v1",
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
