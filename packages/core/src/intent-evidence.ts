import { Type, type Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";

import type { ProjectContext } from "./contracts.js";
import { BridgeError } from "./errors.js";
import type { IntentDocument } from "./intent.js";

export const INTENT_EVIDENCE_LIMITS = {
  pathLength: 128,
  quoteLength: 1_000,
  itemCount: 1_241,
} as const;

const evidenceItem = Type.Object(
  {
    path: Type.String({
      minLength: 1,
      maxLength: INTENT_EVIDENCE_LIMITS.pathLength,
    }),
    source: Type.Union([
      Type.Literal("user_original"),
      Type.Literal("project_summary"),
      Type.Literal("project_instruction"),
    ]),
    quote: Type.String({
      minLength: 1,
      maxLength: INTENT_EVIDENCE_LIMITS.quoteLength,
    }),
    instructionIndex: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const IntentEvidenceV1Schema = Type.Object(
  {
    version: Type.Literal(1),
    items: Type.Array(evidenceItem, {
      minItems: 1,
      maxItems: INTENT_EVIDENCE_LIMITS.itemCount,
    }),
  },
  { additionalProperties: false },
);

export type IntentEvidenceV1 = Static<typeof IntentEvidenceV1Schema>;

const compiledEvidence = TypeCompiler.Compile(IntentEvidenceV1Schema);

function invalidEvidence(): never {
  throw new BridgeError({
    code: "INTENT_SCHEMA_INVALID",
    safeMessage: "The provider response contained invalid intent evidence.",
    retryable: false,
  });
}

function requiredPaths(intent: IntentDocument): Set<string> {
  const paths = new Set<string>(["/goal"]);
  for (const [taskIndex, task] of intent.tasks.entries()) {
    paths.add(`/tasks/${taskIndex}/objective`);
    for (const field of ["scope", "constraints", "successCriteria"] as const)
      for (const index of task[field].keys())
        paths.add(`/tasks/${taskIndex}/${field}/${index}`);
  }
  for (const index of intent.globalConstraints.keys())
    paths.add(`/globalConstraints/${index}`);
  return paths;
}

/**
 * Validates attribution only: an exact quote exists in the named source.
 * It intentionally does not decide whether that quote semantically supports the intent item.
 */
export function parseIntentEvidence(
  input: unknown,
  intent: IntentDocument,
  sources: { originalText: string; project: ProjectContext },
): IntentEvidenceV1 {
  if (!compiledEvidence.Check(input)) invalidEvidence();
  const evidence = input as IntentEvidenceV1;
  const expected = requiredPaths(intent);
  const seen = new Set<string>();

  for (const item of evidence.items) {
    if (!expected.has(item.path) || seen.has(item.path)) invalidEvidence();
    seen.add(item.path);

    let sourceText: string | undefined;
    if (item.source === "project_instruction") {
      if (item.instructionIndex === undefined) invalidEvidence();
      sourceText = sources.project.instructionExcerpts[item.instructionIndex];
    } else {
      if (item.instructionIndex !== undefined) invalidEvidence();
      sourceText =
        item.source === "user_original"
          ? sources.originalText
          : sources.project.summary;
    }
    if (sourceText === undefined || !sourceText.includes(item.quote))
      invalidEvidence();
  }

  if (seen.size !== expected.size) invalidEvidence();
  return evidence;
}
