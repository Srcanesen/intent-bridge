import {
  PiCompilerV1,
  type CompiledTask,
  type IntentDocumentV1,
} from "@intent-bridge/core";
import { describe, expect, it } from "vitest";
import {
  deterministicSafetyCheckNames,
  evaluateInvariants,
  isSafetyCase,
  structuralCheckNames,
} from "../src/index.js";
import { makeCase, makeIntent } from "./helpers.js";

const evaluate = (
  caseOverrides = {},
  intentOverrides: Partial<IntentDocumentV1> = {},
  compiledOverride?: CompiledTask,
) => {
  const item = makeCase("invariant", caseOverrides);
  const intent = makeIntent(intentOverrides);
  const compiled =
    compiledOverride ??
    new PiCompilerV1().compile({
      intent,
      originalText: item.input,
      attachmentSummary: { imageCount: 0 },
    });
  return evaluateInvariants(item, intent, compiled);
};
const check = (result: ReturnType<typeof evaluate>, name: string) =>
  result.checks.find((entry) => entry.name === name)?.passed;

describe("literal benchmark invariants", () => {
  it("exports V2 check classifications without changing invariant serialization", () => {
    expect(structuralCheckNames).toEqual([
      "schema_valid",
      "compiler_valid",
      "message_type",
      "response_language",
      "compiled_response_language",
      "original_request_fenced",
    ]);
    expect(deterministicSafetyCheckNames).toEqual([
      "forbidden_additions",
      "original_request_fenced",
    ]);
    expect(isSafetyCase(makeCase("safe", { tags: ["command"] }))).toBe(true);
  });
  it("fails transformed when intent/compiler output is absent", () => {
    const result = evaluateInvariants(makeCase(), undefined, undefined);
    expect(result.passed).toBe(false);
    expect(result.checks).toEqual([{ name: "transformed", passed: false }]);
  });

  it("checks schema and compiler identity", () => {
    const passing = evaluate();
    expect(check(passing, "schema_valid")).toBe(true);
    expect(check(passing, "compiler_valid")).toBe(true);
    const bad = {
      compilerVersion: "bad",
      responseLanguageCode: "en",
      text: "x",
    } as unknown as CompiledTask;
    expect(check(evaluate({}, {}, bad), "compiler_valid")).toBe(false);
  });

  it("checks message type", () => {
    expect(check(evaluate({ messageType: "normal" }), "message_type")).toBe(
      false,
    );
    expect(
      check(
        evaluate({ messageType: "normal" }, { messageType: "normal" }),
        "message_type",
      ),
    ).toBe(true);
  });

  it("checks response language in intent", () => {
    expect(
      check(
        evaluate({
          expected: { ...makeCase().expected, responseLanguage: "tr" },
        }),
        "response_language",
      ),
    ).toBe(false);
  });

  it("accepts a compiled language code or name when the expected code is preserved", () => {
    const item = makeCase();
    expect(
      check(
        evaluateInvariants(item, makeIntent(), {
          compilerVersion: "pi-v1",
          responseLanguageCode: "en",
          text: `Required user-facing response language: en\n${item.input}`,
        }),
        "compiled_response_language",
      ),
    ).toBe(true);
    const expected = {
      ...item.expected,
      responseLanguage: "tr",
    };
    expect(
      check(
        evaluate(
          { expected },
          {
            sourceLanguage: { code: "tr", name: "Turkish", confidence: 1 },
            responseLanguage: { code: "tr", name: "Turkish" },
          },
        ),
        "compiled_response_language",
      ),
    ).toBe(true);
  });

  it("checks the compiled response instruction rather than any language substring", () => {
    const item = makeCase("compiled");
    const intent = makeIntent();
    const bad: CompiledTask = {
      compilerVersion: "pi-v1",
      responseLanguageCode: "en",
      text: `mentions en\n${item.input}`,
    };
    expect(
      check(
        evaluateInvariants(item, intent, bad),
        "compiled_response_language",
      ),
    ).toBe(false);
  });

  it("matches required goal concepts with case/whitespace normalization only", () => {
    const result = evaluate(
      {
        expected: {
          ...makeCase().expected,
          requiredGoalConcepts: ["FIX   LOGIN"],
        },
      },
      { goal: "Fix\nlogin" },
    );
    expect(check(result, "literal_goal_concepts")).toBe(true);
    expect(
      check(
        evaluate({
          expected: {
            ...makeCase().expected,
            requiredGoalConcepts: ["reset password"],
          },
        }),
        "literal_goal_concepts",
      ),
    ).toBe(false);
  });

  it("checks required constraints across intent and compiled output", () => {
    const expected = {
      ...makeCase().expected,
      requiredConstraints: ["no network"],
    };
    expect(
      check(
        evaluate({ expected }, { globalConstraints: ["No network"] }),
        "literal_constraints",
      ),
    ).toBe(true);
    expect(check(evaluate({ expected }), "literal_constraints")).toBe(false);
  });

  it("detects forbidden additions absent from the original request", () => {
    const expected = {
      ...makeCase().expected,
      forbiddenAdditions: ["redis cluster"],
    };
    expect(check(evaluate({ expected }), "forbidden_additions")).toBe(true);
    expect(
      check(
        evaluate(
          { expected },
          { assumptions: [{ text: "Use Redis cluster", confidence: "low" }] },
        ),
        "forbidden_additions",
      ),
    ).toBe(false);
  });

  it("checks risk and clarification annotations", () => {
    const expected = {
      ...makeCase().expected,
      risk: "high" as const,
      clarificationRecommended: true,
    };
    const result = evaluate(
      { expected },
      {
        risk: { level: "high", reasons: [] },
        clarification: { recommended: true },
      },
    );
    expect(check(result, "risk")).toBe(true);
    expect(check(result, "clarification")).toBe(true);
    expect(check(evaluate({ expected }), "risk")).toBe(false);
  });

  it("requires the exact original request to remain fenced", () => {
    expect(check(evaluate(), "original_request_fenced")).toBe(true);
    const bad: CompiledTask = {
      compilerVersion: "pi-v1",
      responseLanguageCode: "en",
      text: "Required user-facing response language: en",
    };
    expect(check(evaluate({}, {}, bad), "original_request_fenced")).toBe(false);
  });
});
