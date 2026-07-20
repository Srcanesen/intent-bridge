import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import {
  benchmarkReportSha256,
  createReport,
  createReportV2,
  parseBenchmarkReportV2,
} from "../src/index.js";
import { makeResult, reportInput } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.INTENT_BRIDGE_LIVE_TESTS;
});

describe("benchmark CLI", () => {
  it("prints help including contexts and compare output options", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await main(["help"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("--contexts dir"));
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("compare a.json b.json [--out file]"),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "apply-review report.json review.json --out final.json",
      ),
    );
  });

  it("performs reviewed dataset quality validation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await main(["validate-fixtures", "--cases", "benchmarks/cases"]);
    expect(log).toHaveBeenCalledWith("validated 50 reviewed cases");
  });

  it("writes compare output when --out is provided and otherwise prints it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "intent-bridge-cli-"));
    const left = join(dir, "left.json");
    const right = join(dir, "right.json");
    const out = join(dir, "comparison.json");
    await writeFile(
      left,
      JSON.stringify(createReport(reportInput([makeResult("same")], "a"))),
    );
    await writeFile(
      right,
      JSON.stringify(
        createReport(reportInput([makeResult("same", { latencyMs: 20 })], "b")),
      ),
    );
    await main(["compare", left, right, "--out", out]);
    const comparison = JSON.parse(await readFile(out, "utf8")) as {
      winner: string;
      orderedProfiles: { profileId: string }[];
    };
    expect(comparison.winner).toBe("a");
    expect(comparison.orderedProfiles[0]?.profileId).toBe("a");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await main(["compare", left, right]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"winner": "a"'));
  });

  it("rejects cross-version report comparisons clearly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "intent-bridge-cli-"));
    const left = join(dir, "left.json");
    const right = join(dir, "right.json");
    await writeFile(
      left,
      JSON.stringify(createReport(reportInput([makeResult("v1")]))),
    );
    await writeFile(
      right,
      JSON.stringify(createReportV2(reportInput([makeResult("v2")]))),
    );
    await expect(main(["compare", left, right])).rejects.toThrow(
      "BENCHMARK_REPORT_VERSION_MISMATCH",
    );
  });

  it("applies owner review to V2 and writes a strict bounded final report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "intent-bridge-cli-"));
    const reportPath = join(dir, "report.json");
    const reviewPath = join(dir, "review.json");
    const out = join(dir, "final.json");
    const source = createReportV2(reportInput([makeResult("one")], "owner"));
    await writeFile(reportPath, JSON.stringify(source));
    await writeFile(
      reviewPath,
      JSON.stringify({
        version: 1,
        sourceReportSha256: benchmarkReportSha256(source),
        reviewerKind: "owner-human",
        reviewedAt: "2025-01-02T03:04:05.000Z",
        manualAcceptance: "pass",
        cases: [
          {
            profileId: "owner",
            caseId: "one",
            intentAltered: false,
            clarity: "clearer",
            accepted: true,
          },
        ],
      }),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await main(["apply-review", reportPath, reviewPath, "--out", out]);
    const text = await readFile(out, "utf8");
    const finalReport = parseBenchmarkReportV2(JSON.parse(text));
    expect(text).toBe(`${JSON.stringify(finalReport, null, 2)}\n`);
    expect(finalReport.thresholds.ownerAcceptance.status).toBe("pass");
    expect(finalReport.ownerReview).not.toHaveProperty("cases");
    expect(log).toHaveBeenCalledWith(`wrote ${out}`);
  });

  it("rejects V1, bad hashes, and missing --out without leaking content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "intent-bridge-cli-"));
    const reportPath = join(dir, "report.json");
    const reviewPath = join(dir, "review.json");
    const sentinel = "SENTINEL_RAW_CONTENT_MUST_NOT_LEAK";
    const v1 = createReport(reportInput([makeResult("one")]));
    await writeFile(reportPath, JSON.stringify(v1));
    await writeFile(reviewPath, "{}");
    await expect(
      main(["apply-review", reportPath, reviewPath, "--out", join(dir, "x")]),
    ).rejects.toThrow("BENCHMARK_REPORT_V2_REQUIRED");

    const source = createReportV2(reportInput([makeResult(sentinel)], "owner"));
    await writeFile(reportPath, JSON.stringify(source));
    await writeFile(
      reviewPath,
      JSON.stringify({
        version: 1,
        sourceReportSha256: "0".repeat(64),
        reviewerKind: "owner-human",
        reviewedAt: "2025-01-02T03:04:05.000Z",
        manualAcceptance: "pass",
        cases: [
          {
            profileId: "owner",
            caseId: sentinel,
            intentAltered: false,
            clarity: "equal",
            accepted: true,
          },
        ],
      }),
    );
    const error = await main([
      "apply-review",
      reportPath,
      reviewPath,
      "--out",
      join(dir, "x"),
    ]).catch((value: unknown) => value);
    expect(String(error)).toContain("OWNER_REVIEW_HASH_MISMATCH");
    expect(String(error)).not.toContain(sentinel);
    await expect(
      main(["apply-review", reportPath, reviewPath]),
    ).rejects.toThrow("BENCHMARK_ARGUMENTS_INVALID");
  });

  it("rejects live run before loading config or constructing a provider", async () => {
    await expect(main(["run", "--profile", "missing"])).rejects.toThrow(
      "BENCHMARK_LIVE_TESTS_REQUIRED",
    );
  });
});
