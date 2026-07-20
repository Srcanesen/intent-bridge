import { describe, expect, it } from "vitest";
import {
  loadBenchmarkCases,
  REQUIRED_BENCHMARK_TAGS,
  validateReviewedDataset,
} from "../src/index.js";

const normalize = (value: string) =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

describe("reviewed benchmark dataset", () => {
  it("contains 50 unique, annotated, multilingual, structurally honest seed cases", async () => {
    const cases = await loadBenchmarkCases("benchmarks/cases");
    expect(() => validateReviewedDataset(cases)).not.toThrow();
    expect(cases).toHaveLength(50);
    expect(cases.filter((item) => item.language === "tr")).toHaveLength(20);
    expect(cases.filter((item) => item.language === "en")).toHaveLength(20);
    expect(cases.filter((item) => item.language === "es")).toHaveLength(10);
    expect(new Set(cases.map((item) => normalize(item.input))).size).toBe(50);
    expect(new Set(cases.map((item) => normalize(item.title))).size).toBe(50);
    expect(new Set(cases.map((item) => item.id)).size).toBe(50);
    expect(new Set(cases.map((item) => item.messageType)).size).toBe(4);
    const tags = new Set(cases.flatMap((item) => item.tags));
    for (const tag of REQUIRED_BENCHMARK_TAGS) expect(tags).toContain(tag);
    expect(
      cases.every((item) => item.expected.requiredGoalConcepts.length > 0),
    ).toBe(true);
    expect(
      cases.filter((item) => item.expected.requiredConstraints.length > 0)
        .length,
    ).toBeGreaterThanOrEqual(20);
    expect(
      cases.filter((item) => item.expected.forbiddenAdditions.length > 0)
        .length,
    ).toBeGreaterThanOrEqual(12);
    expect(
      cases
        .filter((item) => item.tags.includes("explicit-constraints"))
        .every((item) => item.expected.requiredConstraints.length > 0),
    ).toBe(true);
    expect(
      cases
        .flatMap((item) =>
          item.expected.forbiddenAdditions.map(
            (literal) => [item.input, literal] as const,
          ),
        )
        .every(
          ([input, literal]) => !normalize(input).includes(normalize(literal)),
        ),
    ).toBe(true);
    expect(
      cases
        .filter((item) => item.tags.includes("paths-commands"))
        .every(
          (item) =>
            /[\\/]/.test(item.input) &&
            /\b(?:pnpm|npm|git|docker)\b/i.test(item.input),
        ),
    ).toBe(true);
    expect(
      cases
        .filter((item) => item.tags.includes("secret-like"))
        .every((item) => /EXAMPLE_NOT_A_SECRET_/.test(item.input)),
    ).toBe(true);
    expect(cases.map((item) => item.input).join("\n")).not.toMatch(
      /\b(?:sk|rk|pk)[_-][A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/,
    );
  });
});
