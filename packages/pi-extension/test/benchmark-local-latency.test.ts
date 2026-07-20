import { describe, expect, it } from "vitest";

import {
  byteLength,
  durations,
  parseArgs,
} from "../scripts/benchmark-local-latency.mjs";

describe("benchmark-local-latency helpers", () => {
  it("measures byte length of strings and JSON values", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength({ a: 1 })).toBe(7);
  });

  it("rejects non-integer or out-of-range run counts", async () => {
    await expect(durations(0, async () => {})).rejects.toThrow(
      "CONFIG_INVALID",
    );
    await expect(durations(1.5, async () => {})).rejects.toThrow(
      "CONFIG_INVALID",
    );
  });

  it("returns min, p50, p95, max for repeated synchronous-like work", async () => {
    const report = await durations(7, async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
    expect(report.minMs).toBeGreaterThanOrEqual(0);
    expect(report.medianMs).toBeGreaterThanOrEqual(report.minMs);
    expect(report.p95Ms).toBeGreaterThanOrEqual(report.medianMs);
    expect(report.maxMs).toBeGreaterThanOrEqual(report.p95Ms);
  });

  it("parses known options and rejects unknown or malformed flags", () => {
    const parsed = parseArgs([
      "--out",
      "/tmp/report.json",
      "--config-runs",
      "20",
      "--corpus-passes",
      "30",
      "--cases",
      "benchmarks/cases",
    ]);
    expect(parsed).toEqual({
      out: "/tmp/report.json",
      "config-runs": 20,
      "corpus-passes": 30,
      cases: "benchmarks/cases",
    });
    expect(() => parseArgs(["--unknown", "value"])).toThrow("CONFIG_INVALID");
    expect(() => parseArgs(["--out"])).toThrow("CONFIG_INVALID");
    expect(() => parseArgs(["--config-runs", "0"])).toThrow("CONFIG_INVALID");
    expect(() => parseArgs(["--corpus-passes", "abc"])).toThrow(
      "CONFIG_INVALID",
    );
  });
});
