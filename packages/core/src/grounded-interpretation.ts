import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";

import type { BridgeMessageType, ProjectContext } from "./contracts.js";
import { BridgeError } from "./errors.js";
import {
  INTENT_EVIDENCE_LIMITS,
  parseIntentEvidence,
  type IntentEvidenceV1,
} from "./intent-evidence.js";
import {
  IntentDocumentV2Schema,
  parseIntentDocumentV2,
  type IntentDocumentV2,
} from "./intent.js";

const quote = Type.String({
  minLength: 1,
  maxLength: INTENT_EVIDENCE_LIMITS.quoteLength,
});

export const GroundingEvidenceV1Schema = Type.Union([
  Type.Object(
    { source: Type.Literal("user_original"), quote },
    { additionalProperties: false },
  ),
  Type.Object(
    { source: Type.Literal("project_summary"), quote },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      source: Type.Literal("project_instruction"),
      quote,
      instructionIndex: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
]);

export type GroundingEvidenceV1 = Static<typeof GroundingEvidenceV1Schema>;
export type GroundedTextV1<T extends string = string> = {
  value: T;
  evidence: GroundingEvidenceV1;
};

const groundedText = <T extends TSchema>(value: T) =>
  Type.Object(
    { value, evidence: GroundingEvidenceV1Schema },
    { additionalProperties: false },
  );

const canonicalTask = IntentDocumentV2Schema.properties.tasks.items;
const groundedTask = Type.Composite(
  [
    Type.Omit(canonicalTask, [
      "objective",
      "scope",
      "constraints",
      "successCriteria",
    ]),
    Type.Object({
      objective: groundedText(canonicalTask.properties.objective),
      scope: Type.Array(
        groundedText(canonicalTask.properties.scope.items),
        canonicalTask.properties.scope,
      ),
      constraints: Type.Array(
        groundedText(canonicalTask.properties.constraints.items),
        canonicalTask.properties.constraints,
      ),
      successCriteria: Type.Array(
        groundedText(canonicalTask.properties.successCriteria.items),
        canonicalTask.properties.successCriteria,
      ),
    }),
  ],
  { additionalProperties: false },
);

const groundedIntent = Type.Composite(
  [
    Type.Omit(IntentDocumentV2Schema, ["goal", "tasks", "globalConstraints"]),
    Type.Object({
      goal: groundedText(IntentDocumentV2Schema.properties.goal),
      tasks: Type.Array(groundedTask, IntentDocumentV2Schema.properties.tasks),
      globalConstraints: Type.Array(
        groundedText(IntentDocumentV2Schema.properties.globalConstraints.items),
        IntentDocumentV2Schema.properties.globalConstraints,
      ),
    }),
  ],
  { additionalProperties: false },
);

export const GroundedInterpretationEnvelopeV1Schema = Type.Object(
  {
    version: Type.Literal(1),
    groundedIntent,
  },
  { additionalProperties: false },
);

export const GroundedInterpretationEnvelopeV1JsonSchema = JSON.parse(
  JSON.stringify(GroundedInterpretationEnvelopeV1Schema),
) as Record<string, unknown>;
export type GroundedInterpretationEnvelopeV1 = Static<
  typeof GroundedInterpretationEnvelopeV1Schema
>;

const compiledEnvelope = TypeCompiler.Compile(
  GroundedInterpretationEnvelopeV1Schema,
);

function invalidGrounding(): never {
  throw new BridgeError({
    code: "INTENT_SCHEMA_INVALID",
    safeMessage: "The provider response contained invalid grounded intent.",
    retryable: false,
  });
}

export function parseGroundedInterpretationV1(
  input: unknown,
  options: {
    expectedMessageType: BridgeMessageType;
    originalText: string;
    project: ProjectContext;
  },
): { intent: IntentDocumentV2; evidence: IntentEvidenceV1 } {
  if (!compiledEnvelope.Check(input)) invalidGrounding();
  const grounded = (input as GroundedInterpretationEnvelopeV1).groundedIntent;
  const items: IntentEvidenceV1["items"] = [];
  const unwrap = (text: GroundedTextV1, path: string): string => {
    items.push({ path, ...text.evidence });
    return text.value;
  };

  const goal = unwrap(grounded.goal, "/goal");
  const tasks = grounded.tasks.map((task, taskIndex) => ({
    ...task,
    objective: unwrap(task.objective, `/tasks/${taskIndex}/objective`),
    scope: task.scope.map((text, index) =>
      unwrap(text, `/tasks/${taskIndex}/scope/${index}`),
    ),
    constraints: task.constraints.map((text, index) =>
      unwrap(text, `/tasks/${taskIndex}/constraints/${index}`),
    ),
    successCriteria: task.successCriteria.map((text, index) =>
      unwrap(text, `/tasks/${taskIndex}/successCriteria/${index}`),
    ),
  }));
  const globalConstraints = grounded.globalConstraints.map((text, index) =>
    unwrap(text, `/globalConstraints/${index}`),
  );
  const { intent } = parseIntentDocumentV2(
    { ...grounded, goal, tasks, globalConstraints },
    { expectedMessageType: options.expectedMessageType },
  );
  const evidence = parseIntentEvidence({ version: 1, items }, intent, {
    originalText: options.originalText,
    project: options.project,
  });
  return { intent: intent as IntentDocumentV2, evidence };
}
