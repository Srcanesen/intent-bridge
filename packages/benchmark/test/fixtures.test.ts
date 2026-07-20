import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  loadBenchmarkCases,
  loadContextFixture,
  validateReviewedDataset,
} from "../src/index.js";
import { makeCase } from "./helpers.js";

const temp = () => mkdtemp(join(tmpdir(), "intent-bridge-benchmark-"));
const put = (dir: string, name: string, value: unknown) =>
  writeFile(join(dir, name), JSON.stringify(value));

describe("fixture loading", () => {
  it("loads JSON files in deterministic filename order", async () => {
    const dir = await temp();
    await put(dir, "z.json", makeCase("z"));
    await put(dir, "a.json", makeCase("a"));
    await writeFile(join(dir, "ignored.txt"), "no");
    expect((await loadBenchmarkCases(dir)).map((item) => item.id)).toEqual([
      "a",
      "z",
    ]);
  });

  it("rejects duplicate ids", async () => {
    const dir = await temp();
    await put(dir, "a.json", makeCase("same"));
    await put(dir, "b.json", makeCase("same"));
    await expect(loadBenchmarkCases(dir)).rejects.toThrow(
      "BENCHMARK_DUPLICATE_ID",
    );
  });

  it("rejects malformed JSON and malformed cases", async () => {
    const malformed = await temp();
    await writeFile(join(malformed, "a.json"), "{");
    await expect(loadBenchmarkCases(malformed)).rejects.toThrow();
    const invalid = await temp();
    await put(invalid, "a.json", { ...makeCase(), version: 2 });
    await expect(loadBenchmarkCases(invalid)).rejects.toThrow(
      "BENCHMARK_INVALID",
    );
  });

  it("loads only safe, strict context fixture ids", async () => {
    const dir = await temp();
    await put(dir, "safe_fixture.json", {
      name: "Safe",
      instructionExcerpts: ["Use pnpm."],
    });
    await expect(loadContextFixture(dir, "safe_fixture")).resolves.toEqual({
      name: "Safe",
      instructionExcerpts: ["Use pnpm."],
    });
    for (const name of [
      "../outside",
      "/absolute",
      "nested/file",
      "nested\\file",
      "..",
    ])
      await expect(loadContextFixture(dir, name)).rejects.toThrow(
        "BENCHMARK_CONTEXT_PATH_INVALID",
      );
    await put(dir, "unknown.json", { instructionExcerpts: [], extra: true });
    await expect(loadContextFixture(dir, "unknown")).rejects.toThrow(
      "BENCHMARK_CONTEXT_INVALID",
    );
  });

  it("returns empty project context when no fixture is selected", async () => {
    await expect(loadContextFixture("unused", undefined)).resolves.toEqual({
      instructionExcerpts: [],
    });
  });

  it("quality validation rejects placeholder-style corpora", () => {
    expect(() =>
      validateReviewedDataset(
        Array.from({ length: 50 }, () => makeCase("same")),
      ),
    ).toThrow("BENCHMARK_DATASET_INVALID:duplicate-input");
  });
});
