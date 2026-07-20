import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PiCompilerV1 } from "../src/index.js";
import { compilerFixtures, largeIntent } from "./fixtures/compiler.js";

const compiler = new PiCompilerV1();

function compileFixture(name: string) {
  const fixture = compilerFixtures.find((candidate) => candidate.name === name);
  if (!fixture) {
    throw new Error(`Unknown compiler fixture: ${name}`);
  }
  return compiler.compile({
    intent: fixture.intent,
    originalText: fixture.originalText,
    attachmentSummary: { imageCount: fixture.imageCount ?? 0 },
  });
}

function golden(name: string): string {
  const fixture = readFileSync(
    new URL(`./fixtures/compiler/${name}.md`, import.meta.url),
    "utf8",
  );
  expect(fixture.endsWith("\n")).toBe(true);
  return fixture.slice(0, -1);
}

describe("PiCompilerV1", () => {
  it.each(
    compilerFixtures.map((fixture) => fixture.name),
  )("matches the %s golden output", (name) => {
    expect(compileFixture(name).text).toBe(golden(name));
  });

  it("preserves the original request verbatim inside its safe delimiter", () => {
    const fixture = compilerFixtures.find(
      (candidate) => candidate.name === "adversarial-delimiter",
    )!;
    const text = compileFixture(fixture.name).text;
    const fence = "`".repeat(5);
    expect(text).toContain(
      `## Original user request\n${fence}\n${fixture.originalText}\n${fence}`,
    );
  });

  it("is pure and deterministic", () => {
    const fixture = compilerFixtures[0]!;
    const input = {
      intent: structuredClone(fixture.intent),
      originalText: fixture.originalText,
      attachmentSummary: { imageCount: 1 },
    };
    const before = structuredClone(input);
    expect(compiler.compile(input)).toEqual(compiler.compile(input));
    expect(input).toEqual(before);
  });

  it("omits empty optional sections", () => {
    const text = compileFixture("no-constraints").text;
    expect(text).not.toContain("## Scope");
    expect(text).not.toContain("## User-stated constraints");
    expect(text).not.toContain("## Success criteria");
    expect(text).not.toContain("## Assumptions — not requirements");
    expect(text).not.toContain("## Unresolved ambiguities");
    expect(text).not.toContain("## Attached material");
  });

  it("compiles a large valid intent deterministically", () => {
    const input = {
      intent: largeIntent(),
      originalText: "Complete all tasks.",
      attachmentSummary: { imageCount: 0 },
    };
    const first = compiler.compile(input);
    expect(first).toEqual(compiler.compile(input));
    expect(first.text).toContain("`task-1`");
    expect(first.text).toContain("`task-20`");
  });
});
