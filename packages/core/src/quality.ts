import type { QualitySignalsV1 } from "./contracts.js";
import type { IntentDocumentV1 } from "./intent.js";

export function calculateQualitySignals(
  intent: IntentDocumentV1,
  options: { compilerValid: boolean },
): QualitySignalsV1 {
  return {
    schemaValid: true,
    languagePresent:
      intent.sourceLanguage.code.length > 0 &&
      intent.responseLanguage.code.length > 0,
    taskCount: intent.tasks.length,
    hasGoal: intent.goal.length > 0,
    constraintsSeparated:
      Array.isArray(intent.globalConstraints) &&
      intent.tasks.every((task) => Array.isArray(task.constraints)),
    assumptionsSeparated: Array.isArray(intent.assumptions),
    ambiguitiesTyped: intent.ambiguities.every(
      (ambiguity) =>
        typeof ambiguity.material === "boolean" &&
        typeof ambiguity.preferredResolution === "string",
    ),
    compilerValid: options.compilerValid,
    providerConfidence: intent.confidence,
  };
}
