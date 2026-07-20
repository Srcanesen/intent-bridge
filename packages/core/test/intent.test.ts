import { describe, expect, it } from "vitest";

import {
  BridgeError,
  INTENT_LIMITS,
  IntentDocumentV1JsonSchema,
  parseIntentDocumentV1,
  validateIntentDocumentV1,
} from "../src/index.js";
import { invalidIntentFixtures } from "./fixtures/invalid-intent.js";
import { validIntent } from "./fixtures/intent.js";

const invalidSchema = (input: unknown) => {
  try {
    parseIntentDocumentV1(input);
  } catch (error) {
    return error;
  }
  throw new Error("Expected schema validation to fail.");
};

describe("IntentDocumentV1", () => {
  it("accepts a valid minimal intent", () => {
    expect(parseIntentDocumentV1(validIntent()).intent).toEqual(validIntent());
  });

  it("exposes a plain strict JSON Schema", () => {
    const schema = JSON.parse(JSON.stringify(IntentDocumentV1JsonSchema)) as {
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.required).toContain("tasks");
    expect(schema.additionalProperties).toBe(false);
  });

  it("accepts multiple tasks", () => {
    const input = validIntent();
    input.tasks.push({
      id: "api-copy",
      objective: "Update the API copy.",
      scope: ["API"],
      constraints: [],
      successCriteria: ["Copy is updated."],
    });
    expect(parseIntentDocumentV1(input).intent.tasks).toHaveLength(2);
  });

  it.each([
    ["Turkish", "tr"],
    ["English", "en"],
    ["another language", "ja"],
  ])("accepts %s source language", (_, code) => {
    const input = validIntent();
    input.sourceLanguage.code = code;
    expect(parseIntentDocumentV1(input).intent.sourceLanguage.code).toBe(code);
  });

  it("rejects invalid confidence", () => {
    expect(
      invalidSchema(invalidIntentFixtures.invalidConfidence()),
    ).toBeInstanceOf(BridgeError);
  });

  it("rejects missing or empty tasks", () => {
    expect(invalidSchema(invalidIntentFixtures.missingTasks())).toBeInstanceOf(
      BridgeError,
    );

    const empty = validIntent();
    empty.tasks = [];
    expect(invalidSchema(empty)).toBeInstanceOf(BridgeError);
  });

  it("rejects an expected message-type mismatch", () => {
    expect(() =>
      parseIntentDocumentV1(validIntent(), { expectedMessageType: "steer" }),
    ).toThrow(BridgeError);
  });

  it("rejects wrongly typed constraints", () => {
    const input = validIntent();
    input.tasks[0]!.constraints = "do not use a framework" as never;
    expect(invalidSchema(input)).toBeInstanceOf(BridgeError);
  });

  it("rejects an unknown schema version", () => {
    expect(
      invalidSchema(invalidIntentFixtures.unknownSchemaVersion()),
    ).toBeInstanceOf(BridgeError);
  });

  it("rejects oversized fields", () => {
    const input = validIntent();
    input.goal = "x".repeat(INTENT_LIMITS.goalLength + 1);
    expect(invalidSchema(input)).toBeInstanceOf(BridgeError);
  });

  it("trims and removes duplicate list items in first-seen order", () => {
    const input = validIntent();
    input.globalConstraints = [
      "  Preserve API  ",
      "Preserve API",
      "Keep tests",
    ];
    const result = parseIntentDocumentV1(input);
    expect(result.intent.globalConstraints).toEqual([
      "Preserve API",
      "Keep tests",
    ]);
    expect(result.diagnostics.duplicateItemsRemoved).toEqual([
      "globalConstraints[1]",
    ]);
  });

  it("normalizes language casing and replaces invalid or duplicate task IDs", () => {
    const input = validIntent();
    input.sourceLanguage.code = "TR";
    input.responseLanguage.code = "en-US";
    input.tasks = [
      { ...input.tasks[0]!, id: " bad id " },
      { ...input.tasks[0]!, id: "same" },
      { ...input.tasks[0]!, id: "same" },
    ];
    const result = parseIntentDocumentV1(input);
    expect(result.intent.sourceLanguage.code).toBe("tr");
    expect(result.intent.responseLanguage.code).toBe("en-us");
    expect(result.intent.tasks.map((task) => task.id)).toEqual([
      "t01",
      "t02",
      "t03",
    ]);
    expect(result.diagnostics.replacedTaskIds).toHaveLength(3);
  });

  it("rejects unknown top-level and nested fields", () => {
    const topLevel = validIntent() as Record<string, unknown>;
    topLevel.extra = true;
    expect(invalidSchema(topLevel)).toBeInstanceOf(BridgeError);

    const nested = validIntent();
    (nested.tasks[0]! as Record<string, unknown>).extra = true;
    expect(invalidSchema(nested)).toBeInstanceOf(BridgeError);
  });

  it("returns a safe typed error without provider content", () => {
    const error = invalidSchema({ providerContent: "secret response" });
    expect(error).toMatchObject({
      code: "INTENT_SCHEMA_INVALID",
      safeMessage:
        "The provider response did not match the required intent schema.",
      retryable: false,
    });
    expect((error as Error).message).not.toContain("secret response");
  });

  it("normalizes deterministically", () => {
    const input = validIntent();
    input.tasks[0]!.id = "not valid";
    input.tasks[0]!.scope = ["  ui ", "ui"];
    expect(parseIntentDocumentV1(input)).toEqual(parseIntentDocumentV1(input));
  });

  it("validates already-normalized documents", () => {
    const parsed = parseIntentDocumentV1(validIntent());
    expect(validateIntentDocumentV1(parsed.intent)).toEqual(parsed.intent);
  });
});
