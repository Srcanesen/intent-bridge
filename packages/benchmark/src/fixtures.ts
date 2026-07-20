import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectContext } from "@intent-bridge/core";
import { parseBenchmarkCaseV1, type BenchmarkCaseV1 } from "./contracts.js";

export const REQUIRED_BENCHMARK_TAGS = [
  "clear",
  "vague",
  "bug-fix",
  "ui",
  "refactoring",
  "tests",
  "architecture",
  "multi-task",
  "explicit-constraints",
  "risky-assumptions",
  "steer",
  "follow_up",
  "paths-commands",
  "mixed-language",
  "prompt-injection-like",
  "secret-like",
] as const;
const normalize = (value: string) =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

export async function loadBenchmarkCases(
  dir: string,
): Promise<BenchmarkCaseV1[]> {
  const files = (await readdir(dir))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const cases = await Promise.all(
    files.map(async (file) =>
      parseBenchmarkCaseV1(JSON.parse(await readFile(join(dir, file), "utf8"))),
    ),
  );
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error("BENCHMARK_DUPLICATE_ID");
    ids.add(item.id);
  }
  return cases;
}

export function validateReviewedDataset(
  cases: readonly BenchmarkCaseV1[],
): void {
  const fail = (reason: string): never => {
    throw new Error(`BENCHMARK_DATASET_INVALID:${reason}`);
  };
  if (cases.length < 50) fail("case-count");
  if (new Set(cases.map((item) => normalize(item.input))).size !== cases.length)
    fail("duplicate-input");
  if (new Set(cases.map((item) => normalize(item.title))).size !== cases.length)
    fail("duplicate-title");
  for (const [language, count] of [
    ["tr", 20],
    ["en", 20],
    ["es", 10],
  ] as const)
    if (cases.filter((item) => item.language === language).length !== count)
      fail(`language-${language}`);
  const messageTypes = new Set(cases.map((item) => item.messageType));
  for (const type of ["initial", "normal", "steer", "follow_up"])
    if (!messageTypes.has(type as BenchmarkCaseV1["messageType"]))
      fail(`message-${type}`);
  const tags = new Set(cases.flatMap((item) => item.tags));
  for (const tag of REQUIRED_BENCHMARK_TAGS)
    if (!tags.has(tag)) fail(`tag-${tag}`);
  if (cases.some((item) => item.expected.requiredGoalConcepts.length === 0))
    fail("empty-goals");
  if (
    cases.filter((item) => item.expected.requiredConstraints.length > 0)
      .length < 20
  )
    fail("constraint-density");
  if (
    cases.filter((item) => item.expected.forbiddenAdditions.length > 0).length <
    12
  )
    fail("forbidden-density");
  for (const item of cases) {
    if (item.expected.responseLanguage !== item.language)
      fail(`response-language-${item.id}`);
    if (
      item.tags.includes("explicit-constraints") &&
      item.expected.requiredConstraints.length === 0
    )
      fail(`explicit-constraints-${item.id}`);
    if (
      item.expected.forbiddenAdditions.some((literal) =>
        normalize(item.input).includes(normalize(literal)),
      )
    )
      fail(`forbidden-present-${item.id}`);
    if (
      (item.tags.includes("vague") ||
        item.tags.includes("risky-assumptions")) &&
      item.expected.risk === undefined &&
      item.expected.clarificationRecommended === undefined
    )
      fail(`risk-annotation-${item.id}`);
    if (
      item.tags.includes("paths-commands") &&
      (!/[\\/]/.test(item.input) ||
        !/\b(?:pnpm|npm|git|pytest|cargo|docker)\b/i.test(item.input))
    )
      fail(`paths-commands-${item.id}`);
    if (
      item.tags.includes("mixed-language") &&
      !/\b(?:please|only|sin|pero|deploy|test|fix|review)\b/i.test(item.input)
    )
      fail(`mixed-language-${item.id}`);
    if (
      item.tags.includes("prompt-injection-like") &&
      !/ignore|system|instruction|instrucciones|talimat/i.test(item.input)
    )
      fail(`prompt-injection-${item.id}`);
    if (
      item.tags.includes("secret-like") &&
      !/EXAMPLE_NOT_A_SECRET_/i.test(item.input)
    )
      fail(`secret-like-${item.id}`);
  }
  const corpus = cases.map((item) => item.input).join("\n");
  if (
    /\b(?:sk|rk|pk)[_-][A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/.test(
      corpus,
    )
  )
    fail("credential-pattern");
}

export async function loadContextFixture(
  dir: string | undefined,
  name: string | undefined,
): Promise<ProjectContext> {
  if (!dir || !name) return { instructionExcerpts: [] };
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(name))
    throw new Error("BENCHMARK_CONTEXT_PATH_INVALID");
  const raw = JSON.parse(
    await readFile(join(dir, `${name}.json`), "utf8"),
  ) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("BENCHMARK_CONTEXT_INVALID");
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !["name", "summary", "instructionExcerpts"].includes(key),
    ) ||
    !Array.isArray(value.instructionExcerpts) ||
    value.instructionExcerpts.length > 10 ||
    value.instructionExcerpts.some(
      (entry) => typeof entry !== "string" || entry.length > 2000,
    ) ||
    (value.name !== undefined &&
      (typeof value.name !== "string" || value.name.length > 200)) ||
    (value.summary !== undefined &&
      (typeof value.summary !== "string" || value.summary.length > 2000))
  )
    throw new Error("BENCHMARK_CONTEXT_INVALID");
  return {
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    instructionExcerpts: value.instructionExcerpts as string[],
  };
}
