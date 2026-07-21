import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  PiCompilerV1,
  type IntentDocumentV1,
  type TransformationAssessment,
} from "../src/index.js";
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

function compileWithAssessment(
  intent: IntentDocumentV1,
  assessment: TransformationAssessment,
  originalText = "Original text",
) {
  return compiler.compile({
    intent,
    originalText,
    attachmentSummary: { imageCount: 0 },
    assessment,
  });
}

const cleanAssessment: TransformationAssessment = {
  policyVersion: "quality-policy-v1",
  outcome: "accept",
  reasons: [],
  observedConfidence: 0.9,
};

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

  it("bump compiler version to pi-v2 while keeping trace readers compatible", () => {
    for (const fixture of compilerFixtures) {
      const compiled = compileFixture(fixture.name);
      expect(compiled.compilerVersion).toBe("pi-v2");
    }
  });

  it("omits the advisory for a clean compact follow-up intent", () => {
    const fixture = compilerFixtures.find(
      (candidate) => candidate.name === "follow-up-compact",
    )!;
    const text = compiler.compile({
      intent: fixture.intent,
      originalText: fixture.originalText,
      attachmentSummary: { imageCount: 0 },
      assessment: cleanAssessment,
    }).text;
    expect(text).not.toContain("Interpreter advisory");
  });

  it("omits the advisory for a clean default intent even when an accept assessment is provided", () => {
    const fixture = compilerFixtures.find(
      (candidate) => candidate.name === "no-constraints",
    )!;
    const text = compiler.compile({
      intent: fixture.intent,
      originalText: fixture.originalText,
      attachmentSummary: { imageCount: 0 },
      assessment: cleanAssessment,
    }).text;
    expect(text).not.toContain("Interpreter advisory");
  });

  it("emits a separate advisory heading for high risk without placing it under user constraints", () => {
    const fixture = compilerFixtures.find(
      (candidate) => candidate.name === "multiple-tasks",
    )!;
    const intent: IntentDocumentV1 = {
      ...fixture.intent,
      risk: { level: "high", reasons: ["dangerous operation"] },
    };
    const text = compileWithAssessment(intent, {
      policyVersion: "quality-policy-v1",
      outcome: "review",
      reasons: ["high_risk"],
      observedConfidence: 0.9,
    }).text;
    const userIdx = text.indexOf("## User-stated constraints");
    const advisoryIdx = text.indexOf(
      "## Interpreter advisory — not user requirements",
    );
    expect(advisoryIdx).toBeGreaterThan(0);
    expect(userIdx).toBeGreaterThan(-1);
    expect(advisoryIdx).toBeGreaterThan(userIdx);
    expect(text).toContain("Assessment outcome: review (high_risk)");
    expect(text).toContain("Risk: high");
    expect(text).toContain("dangerous operation");
    expect(text).toContain(
      "This section is interpreter advisory, not user-stated requirements",
    );
  });

  it("emits high-risk advisory for an accept assessment when review flags are disabled upstream", () => {
    const fixture = compilerFixtures.find(
      (candidate) => candidate.name === "multiple-tasks",
    )!;
    const text = compileWithAssessment(
      {
        ...fixture.intent,
        risk: { level: "high", reasons: ["dangerous operation"] },
      },
      cleanAssessment,
    ).text;
    expect(text).toContain("## Interpreter advisory — not user requirements");
    expect(text).toContain("Assessment outcome: accept");
    expect(text).toContain("Risk: high");
  });

  it("emits the advisory for clarification recommended and material ask_user ambiguity", () => {
    const fixture = compilerFixtures.find(
      (candidate) => candidate.name === "material-ambiguity",
    )!;
    const intent: IntentDocumentV1 = {
      ...fixture.intent,
      clarification: {
        recommended: true,
        reason: "needs billing provider",
      },
    };
    const text = compileWithAssessment(intent, {
      policyVersion: "quality-policy-v1",
      outcome: "review",
      reasons: [
        "clarification_recommended",
        "material_ambiguity_requires_user",
      ],
      observedConfidence: 0.9,
    }).text;
    expect(text).toContain("## Interpreter advisory — not user requirements");
    expect(text).toContain(
      "Assessment outcome: review (clarification_recommended, material_ambiguity_requires_user)",
    );
    expect(text).toContain("Clarification recommended");
    expect(text).toContain("needs billing provider");
    expect(text).toContain("Material ask_user ambiguity");
    expect(text).toContain("The billing provider is not specified");
  });

  it("surfaces confidence-only review without inventing risk/clarification prose", () => {
    const fixture = compilerFixtures.find(
      (candidate) => candidate.name === "initial-english",
    )!;
    const text = compileWithAssessment(fixture.intent, {
      policyVersion: "quality-policy-v1",
      outcome: "review",
      reasons: ["confidence_below_threshold"],
      observedConfidence: 0.4,
    }).text;
    expect(text).toContain("## Interpreter advisory — not user requirements");
    expect(text).toContain("confidence_below_threshold");
    expect(text).toContain("Observed confidence: 0.4");
    expect(text).not.toContain("Risk: high");
    expect(text).not.toContain("Clarification recommended");
  });

  it("escapes and fences raw risk reasons without leaking secrets in advisory prose", () => {
    const fixture = compilerFixtures[0]!;
    const intent: IntentDocumentV1 = {
      ...fixture.intent,
      risk: {
        level: "high",
        reasons: ["api_key=SENTINEL_SECRET", "```\nfence\n```"],
      },
    };
    const text = compileWithAssessment(intent, {
      policyVersion: "quality-policy-v1",
      outcome: "review",
      reasons: ["high_risk"],
      observedConfidence: 0.9,
    }).text;
    expect(text).not.toContain("SENTINEL_SECRET");
    expect(text).not.toContain("```\nfence\n```");
  });
});
