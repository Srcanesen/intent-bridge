import { Type, type Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";

import type { BridgeMessageType } from "./contracts.js";
import { BridgeError } from "./errors.js";

export const INTENT_LIMITS = {
  goalLength: 2_000,
  listStringLength: 1_000,
  languageCodeLength: 32,
  languageNameLength: 64,
  clarificationReasonLength: 500,
  listCount: 20,
  riskReasonCount: 10,
} as const;

export const TASK_ID_PATTERN = "^[a-z][a-z0-9_-]{0,63}$";
export const LANGUAGE_CODE_PATTERN = "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$";

const requiredString = (maxLength: number) =>
  Type.String({ minLength: 1, maxLength });
const stringList = (maxItems: number = INTENT_LIMITS.listCount) =>
  Type.Array(requiredString(INTENT_LIMITS.listStringLength), {
    maxItems,
  });

const languageCode = requiredString(INTENT_LIMITS.languageCodeLength);
const languageName = Type.Optional(
  requiredString(INTENT_LIMITS.languageNameLength),
);

const sourceLanguage = Type.Object(
  {
    code: languageCode,
    name: languageName,
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

const responseLanguage = Type.Object(
  {
    code: languageCode,
    name: languageName,
  },
  { additionalProperties: false },
);

const responseLanguageV2 = Type.Object(
  {
    code: languageCode,
    name: languageName,
    source: Type.Union([
      Type.Literal("user_explicit"),
      Type.Literal("source_language_default"),
    ]),
  },
  { additionalProperties: false },
);

const task = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64, pattern: TASK_ID_PATTERN }),
    objective: requiredString(INTENT_LIMITS.goalLength),
    scope: stringList(),
    constraints: stringList(),
    successCriteria: stringList(),
  },
  { additionalProperties: false },
);

const assumption = Type.Object(
  {
    text: requiredString(INTENT_LIMITS.listStringLength),
    confidence: Type.Union([
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
    ]),
  },
  { additionalProperties: false },
);

const ambiguity = Type.Object(
  {
    description: requiredString(INTENT_LIMITS.listStringLength),
    material: Type.Boolean(),
    preferredResolution: Type.Union([
      Type.Literal("inspect_repository"),
      Type.Literal("ask_user"),
      Type.Literal("none"),
    ]),
  },
  { additionalProperties: false },
);

export const IntentDocumentV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("1"),
    sourceLanguage,
    responseLanguage,
    messageType: Type.Union([
      Type.Literal("initial"),
      Type.Literal("normal"),
      Type.Literal("steer"),
      Type.Literal("follow_up"),
    ]),
    goal: requiredString(INTENT_LIMITS.goalLength),
    tasks: Type.Array(task, { minItems: 1, maxItems: INTENT_LIMITS.listCount }),
    globalConstraints: stringList(),
    assumptions: Type.Array(assumption, { maxItems: INTENT_LIMITS.listCount }),
    ambiguities: Type.Array(ambiguity, { maxItems: INTENT_LIMITS.listCount }),
    risk: Type.Object(
      {
        level: Type.Union([
          Type.Literal("low"),
          Type.Literal("medium"),
          Type.Literal("high"),
        ]),
        reasons: stringList(INTENT_LIMITS.riskReasonCount),
      },
      { additionalProperties: false },
    ),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    clarification: Type.Object(
      {
        recommended: Type.Boolean(),
        reason: Type.Optional(
          requiredString(INTENT_LIMITS.clarificationReasonLength),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const IntentDocumentV2Schema = Type.Object(
  {
    ...IntentDocumentV1Schema.properties,
    schemaVersion: Type.Literal("2"),
    responseLanguage: responseLanguageV2,
  },
  { additionalProperties: false },
);

export const IntentDocumentV1JsonSchema = JSON.parse(
  JSON.stringify(IntentDocumentV1Schema),
) as Record<string, unknown>;
export const IntentDocumentV2JsonSchema = JSON.parse(
  JSON.stringify(IntentDocumentV2Schema),
) as Record<string, unknown>;
export type IntentDocumentV1 = Static<typeof IntentDocumentV1Schema>;
export type IntentDocumentV2 = Static<typeof IntentDocumentV2Schema>;
export type IntentDocument = IntentDocumentV1 | IntentDocumentV2;

export interface NormalizationDiagnostics {
  trimmed: string[];
  duplicateItemsRemoved: string[];
  normalizedLanguageCodes: string[];
  replacedTaskIds: Array<{ index: number; from?: unknown; to: string }>;
}

export interface NormalizationResult {
  value: unknown;
  diagnostics: NormalizationDiagnostics;
}

export interface ParseIntentDocumentV1Options {
  expectedMessageType?: BridgeMessageType;
}

export interface ParsedIntentDocumentV1 {
  intent: IntentDocumentV1;
  diagnostics: NormalizationDiagnostics;
}

export interface ParsedIntentDocument {
  intent: IntentDocument;
  diagnostics: NormalizationDiagnostics;
}

const compiledIntentDocumentV1 = TypeCompiler.Compile(IntentDocumentV1Schema);
const compiledIntentDocumentV2 = TypeCompiler.Compile(IntentDocumentV2Schema);
const languageCodeExpression = new RegExp(LANGUAGE_CODE_PATTERN);
const taskIdExpression = new RegExp(TASK_ID_PATTERN);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimString(
  value: unknown,
  path: string,
  diagnostics: NormalizationDiagnostics,
): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed !== value) {
    diagnostics.trimmed.push(path);
  }
  return trimmed;
}

function normalizeStringList(
  value: unknown,
  path: string,
  diagnostics: NormalizationDiagnostics,
): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  const seen = new Set<string>();
  const normalized: unknown[] = [];
  for (const [index, item] of value.entries()) {
    const trimmed = trimString(item, `${path}[${index}]`, diagnostics);
    if (typeof trimmed === "string" && seen.has(trimmed)) {
      diagnostics.duplicateItemsRemoved.push(`${path}[${index}]`);
      continue;
    }
    if (typeof trimmed === "string") {
      seen.add(trimmed);
    }
    normalized.push(trimmed);
  }
  return normalized;
}

function normalizeLanguage(
  value: unknown,
  path: string,
  diagnostics: NormalizationDiagnostics,
): unknown {
  const trimmed = trimString(value, path, diagnostics);
  if (typeof trimmed !== "string" || !languageCodeExpression.test(trimmed)) {
    return trimmed;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized !== trimmed) {
    diagnostics.normalizedLanguageCodes.push(path);
  }
  return normalized;
}

function generatedTaskId(index: number, used: Set<string>): string {
  let number = index + 1;
  let candidate = `t${String(number).padStart(2, "0")}`;
  while (used.has(candidate)) {
    number += 1;
    candidate = `t${String(number).padStart(2, "0")}`;
  }
  return candidate;
}

function normalizeTaskIds(
  tasks: unknown,
  diagnostics: NormalizationDiagnostics,
): unknown {
  if (!Array.isArray(tasks)) {
    return tasks;
  }
  const counts = new Map<string, number>();
  for (const taskValue of tasks) {
    const id = isRecord(taskValue) ? taskValue.id : undefined;
    if (typeof id === "string" && taskIdExpression.test(id)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const used = new Set(
    [...counts].filter(([, count]) => count === 1).map(([id]) => id),
  );
  const normalized = tasks.map((taskValue, index) => {
    if (!isRecord(taskValue)) {
      return taskValue;
    }
    const id = taskValue.id;
    if (
      typeof id === "string" &&
      taskIdExpression.test(id) &&
      counts.get(id) === 1
    ) {
      return taskValue;
    }
    const replacement = generatedTaskId(index, used);
    used.add(replacement);
    diagnostics.replacedTaskIds.push({ index, from: id, to: replacement });
    return { ...taskValue, id: replacement };
  });
  return normalized;
}

export function normalizeIntentDocumentV1(input: unknown): NormalizationResult {
  const diagnostics: NormalizationDiagnostics = {
    trimmed: [],
    duplicateItemsRemoved: [],
    normalizedLanguageCodes: [],
    replacedTaskIds: [],
  };
  if (!isRecord(input)) {
    return { value: input, diagnostics };
  }

  const value = { ...input };
  value.schemaVersion = trimString(
    value.schemaVersion,
    "schemaVersion",
    diagnostics,
  );
  value.messageType = trimString(value.messageType, "messageType", diagnostics);
  value.goal = trimString(value.goal, "goal", diagnostics);
  value.globalConstraints = normalizeStringList(
    value.globalConstraints,
    "globalConstraints",
    diagnostics,
  );

  if (isRecord(value.sourceLanguage)) {
    value.sourceLanguage = {
      ...value.sourceLanguage,
      code: normalizeLanguage(
        value.sourceLanguage.code,
        "sourceLanguage.code",
        diagnostics,
      ),
      name: trimString(
        value.sourceLanguage.name,
        "sourceLanguage.name",
        diagnostics,
      ),
    };
  }
  if (isRecord(value.responseLanguage)) {
    value.responseLanguage = {
      ...value.responseLanguage,
      code: normalizeLanguage(
        value.responseLanguage.code,
        "responseLanguage.code",
        diagnostics,
      ),
      name: trimString(
        value.responseLanguage.name,
        "responseLanguage.name",
        diagnostics,
      ),
    };
  }
  if (isRecord(value.risk)) {
    value.risk = {
      ...value.risk,
      level: trimString(value.risk.level, "risk.level", diagnostics),
      reasons: normalizeStringList(
        value.risk.reasons,
        "risk.reasons",
        diagnostics,
      ),
    };
  }
  if (isRecord(value.clarification)) {
    value.clarification = {
      ...value.clarification,
      reason: trimString(
        value.clarification.reason,
        "clarification.reason",
        diagnostics,
      ),
    };
  }
  if (Array.isArray(value.tasks)) {
    value.tasks = normalizeTaskIds(
      value.tasks.map((taskValue, index) => {
        if (!isRecord(taskValue)) {
          return taskValue;
        }
        return {
          ...taskValue,
          id: trimString(taskValue.id, `tasks[${index}].id`, diagnostics),
          objective: trimString(
            taskValue.objective,
            `tasks[${index}].objective`,
            diagnostics,
          ),
          scope: normalizeStringList(
            taskValue.scope,
            `tasks[${index}].scope`,
            diagnostics,
          ),
          constraints: normalizeStringList(
            taskValue.constraints,
            `tasks[${index}].constraints`,
            diagnostics,
          ),
          successCriteria: normalizeStringList(
            taskValue.successCriteria,
            `tasks[${index}].successCriteria`,
            diagnostics,
          ),
        };
      }),
      diagnostics,
    );
  }
  if (Array.isArray(value.assumptions)) {
    value.assumptions = value.assumptions.map((assumptionValue, index) =>
      isRecord(assumptionValue)
        ? {
            ...assumptionValue,
            text: trimString(
              assumptionValue.text,
              `assumptions[${index}].text`,
              diagnostics,
            ),
            confidence: trimString(
              assumptionValue.confidence,
              `assumptions[${index}].confidence`,
              diagnostics,
            ),
          }
        : assumptionValue,
    );
  }
  if (Array.isArray(value.ambiguities)) {
    value.ambiguities = value.ambiguities.map((ambiguityValue, index) =>
      isRecord(ambiguityValue)
        ? {
            ...ambiguityValue,
            description: trimString(
              ambiguityValue.description,
              `ambiguities[${index}].description`,
              diagnostics,
            ),
            preferredResolution: trimString(
              ambiguityValue.preferredResolution,
              `ambiguities[${index}].preferredResolution`,
              diagnostics,
            ),
          }
        : ambiguityValue,
    );
  }
  return { value, diagnostics };
}

function validateIntent(
  input: unknown,
  options: ParseIntentDocumentV1Options,
  check: (value: unknown) => boolean,
): void {
  if (
    !check(input) ||
    (options.expectedMessageType !== undefined &&
      (!isRecord(input) || input.messageType !== options.expectedMessageType))
  )
    throw new BridgeError({
      code: "INTENT_SCHEMA_INVALID",
      safeMessage:
        "The provider response did not match the required intent schema.",
      retryable: false,
    });
}

export function validateIntentDocumentV1(
  input: unknown,
  options: ParseIntentDocumentV1Options = {},
): IntentDocumentV1 {
  validateIntent(
    input,
    options,
    compiledIntentDocumentV1.Check.bind(compiledIntentDocumentV1),
  );
  return input as IntentDocumentV1;
}

export function validateIntentDocumentV2(
  input: unknown,
  options: ParseIntentDocumentV1Options = {},
): IntentDocumentV2 {
  validateIntent(
    input,
    options,
    compiledIntentDocumentV2.Check.bind(compiledIntentDocumentV2),
  );
  return input as IntentDocumentV2;
}

export function parseIntentDocumentV1(
  input: unknown,
  options: ParseIntentDocumentV1Options = {},
): ParsedIntentDocumentV1 {
  const normalized = normalizeIntentDocumentV1(input);
  return {
    intent: validateIntentDocumentV1(normalized.value, options),
    diagnostics: normalized.diagnostics,
  };
}

export function parseIntentDocumentV2(
  input: unknown,
  options: ParseIntentDocumentV1Options = {},
): ParsedIntentDocument {
  const normalized = normalizeIntentDocumentV1(input);
  return {
    intent: validateIntentDocumentV2(normalized.value, options),
    diagnostics: normalized.diagnostics,
  };
}

export function parseIntentDocument(
  input: unknown,
  options: ParseIntentDocumentV1Options = {},
): ParsedIntentDocument {
  const normalized = normalizeIntentDocumentV1(input);
  const intent =
    isRecord(normalized.value) && normalized.value.schemaVersion === "2"
      ? validateIntentDocumentV2(normalized.value, options)
      : validateIntentDocumentV1(normalized.value, options);
  return { intent, diagnostics: normalized.diagnostics };
}
