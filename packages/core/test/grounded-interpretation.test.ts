import {
  type GroundingEvidenceV1,
  GroundedInterpretationEnvelopeV1JsonSchema,
  IntentDocumentV2JsonSchema,
  parseGroundedInterpretationV1,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

const sources = {
  originalText:
    "Build bridge. Handle user input. Tests pass. Ship provider cutover. No live calls. Bundle works.",
  project: {
    summary: "Core package and provider package are in scope.",
    instructionExcerpts: ["Keep changes atomic.", "Preserve original bytes."],
  },
};

const user = (quote: string) => ({
  source: "user_original" as const,
  quote,
});
const summary = (quote: string) => ({
  source: "project_summary" as const,
  quote,
});
const instruction = (quote: string, instructionIndex: number) => ({
  source: "project_instruction" as const,
  quote,
  instructionIndex,
});
const text = (value: string, evidence: GroundingEvidenceV1) => ({
  value,
  evidence,
});

const envelope = () => ({
  version: 1 as const,
  groundedIntent: {
    schemaVersion: "2",
    sourceLanguage: { code: "en", confidence: 1 },
    responseLanguage: { code: "en", source: "source_language_default" },
    messageType: "initial",
    goal: text("Build bridge", user("Build bridge")),
    tasks: [
      {
        id: "core",
        objective: text("Handle user input", user("Handle user input")),
        scope: [text("Core package", summary("Core package"))],
        constraints: [
          text("Keep changes atomic", instruction("Keep changes atomic", 0)),
        ],
        successCriteria: [text("Tests pass", user("Tests pass"))],
      },
      {
        id: "providers",
        objective: text("Ship provider cutover", user("Ship provider cutover")),
        scope: [text("provider package", summary("provider package"))],
        constraints: [text("No live calls", user("No live calls"))],
        successCriteria: [text("Bundle works", user("Bundle works"))],
      },
    ],
    globalConstraints: [
      text(
        "Preserve original bytes",
        instruction("Preserve original bytes", 1),
      ),
    ],
    assumptions: [],
    ambiguities: [],
    risk: { level: "low", reasons: [] },
    confidence: 1,
    clarification: { recommended: false },
  },
});

const parse = (value: unknown, overrides = {}) =>
  parseGroundedInterpretationV1(value, {
    expectedMessageType: "initial",
    ...sources,
    ...overrides,
  });
const clone = () => structuredClone(envelope());
const record = (value: object) => value as Record<string, unknown>;
const schemaAt = (
  schema: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> => {
  let value: unknown = schema;
  for (const key of keys) value = (value as Record<string, unknown>)[key];
  return value as Record<string, unknown>;
};
const invalid = (value: unknown, overrides = {}) =>
  expect(() => parse(value, overrides)).toThrowError(
    expect.objectContaining({
      code: "INTENT_SCHEMA_INVALID",
      retryable: false,
    }),
  );

describe("parseGroundedInterpretationV1", () => {
  it("unwraps two tasks in deterministic executable-field order", () => {
    const result = parse(envelope());
    expect(result.intent).toMatchObject({
      goal: "Build bridge",
      tasks: [
        {
          objective: "Handle user input",
          scope: ["Core package"],
          constraints: ["Keep changes atomic"],
          successCriteria: ["Tests pass"],
        },
        {
          objective: "Ship provider cutover",
          scope: ["provider package"],
          constraints: ["No live calls"],
          successCriteria: ["Bundle works"],
        },
      ],
      globalConstraints: ["Preserve original bytes"],
    });
    expect(result.evidence.items.map(({ path }) => path)).toEqual([
      "/goal",
      "/tasks/0/objective",
      "/tasks/0/scope/0",
      "/tasks/0/constraints/0",
      "/tasks/0/successCriteria/0",
      "/tasks/1/objective",
      "/tasks/1/scope/0",
      "/tasks/1/constraints/0",
      "/tasks/1/successCriteria/0",
      "/globalConstraints/0",
    ]);
    expect(new Set(result.evidence.items.map(({ source }) => source))).toEqual(
      new Set(["user_original", "project_summary", "project_instruction"]),
    );
  });

  it("rejects missing, extra, unknown, legacy, and message-type mismatches", () => {
    const missing = clone();
    delete record(missing.groundedIntent.goal).evidence;
    invalid(missing);
    const extra = clone();
    record(extra.groundedIntent.goal).unknown = true;
    invalid(extra);
    const unknown = clone();
    record(unknown.groundedIntent.goal.evidence).source = "system";
    invalid(unknown);
    const legacy = clone();
    record(legacy.groundedIntent).goal = "Build bridge";
    invalid(legacy);
    const mismatch = clone();
    record(mismatch.groundedIntent).messageType = "steer";
    invalid(mismatch);
  });

  it("rejects invalid instruction indexes, absent sources, and inexact quotes", () => {
    for (const mutate of [
      (value: ReturnType<typeof envelope>) =>
        delete record(value.groundedIntent.tasks[0].constraints[0].evidence)
          .instructionIndex,
      (value: ReturnType<typeof envelope>) =>
        (record(value.groundedIntent.goal.evidence).instructionIndex = 0),
      (value: ReturnType<typeof envelope>) =>
        (record(
          value.groundedIntent.tasks[0].constraints[0].evidence,
        ).instructionIndex = 9),
      (value: ReturnType<typeof envelope>) =>
        (value.groundedIntent.goal.evidence.quote = "build bridge"),
      (value: ReturnType<typeof envelope>) =>
        (value.groundedIntent.goal.evidence.quote = "Build  bridge"),
      (value: ReturnType<typeof envelope>) =>
        (value.groundedIntent.goal.evidence.quote = "Build bridgé"),
    ]) {
      const value = clone();
      mutate(value);
      invalid(value);
    }
    const noSummary = clone();
    noSummary.groundedIntent.tasks[0].scope[0].evidence =
      summary("Core package");
    invalid(noSummary, {
      project: { instructionExcerpts: sources.project.instructionExcerpts },
    });
  });

  it("publishes only embedded grounding while retaining canonical limits", () => {
    const schema = GroundedInterpretationEnvelopeV1JsonSchema;
    const canonical = IntentDocumentV2JsonSchema;
    const properties = schemaAt(schema, "properties");
    const groundedProperties = schemaAt(
      schema,
      "properties",
      "groundedIntent",
      "properties",
    );
    const groundedTasks = schemaAt(groundedProperties, "tasks");
    const canonicalTasks = schemaAt(canonical, "properties", "tasks");
    expect(Object.keys(properties)).toEqual(["version", "groundedIntent"]);
    expect(JSON.stringify(schema)).not.toContain('"path"');
    expect(groundedProperties).not.toHaveProperty("evidence");
    expect(groundedTasks.maxItems).toBe(canonicalTasks.maxItems);
    expect(groundedTasks.minItems).toBe(canonicalTasks.minItems);
    expect(
      schemaAt(groundedTasks, "items", "properties", "scope").maxItems,
    ).toBe(schemaAt(canonicalTasks, "items", "properties", "scope").maxItems);
    expect(
      schemaAt(groundedProperties, "goal", "properties", "value").maxLength,
    ).toBe(schemaAt(canonical, "properties", "goal").maxLength);
  });
});
