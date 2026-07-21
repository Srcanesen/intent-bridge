import {
  redactSecrets,
  type FullInMemoryTransformation,
  type QualityConfigV1,
  type QualityDecisionReason,
} from "@intent-bridge/core";

export const PREVIEW_CHOICES = [
  "Send transformed",
  "Send original",
  "Cancel",
] as const;

const CAP = 5_000;
const LIST_CAP = 10;
const REASON_CAP = 120;

function bounded(text: string): string {
  return text.length <= CAP ? text : `${text.slice(0, CAP - 14)}\n[truncated]`;
}

function redactUserContent(text: string): string {
  return redactSecrets(text).text;
}

const QUALITY_DECISION_REASONS = [
  "high_risk",
  "clarification_recommended",
  "material_ambiguity_requires_user",
  "confidence_below_threshold",
] as const satisfies readonly QualityDecisionReason[];

function redactAssessmentContent(text: string): string {
  const protectedReasons = QUALITY_DECISION_REASONS.map((reason, index) => ({
    reason,
    placeholder: `[QUALITY_REASON_${index}]`,
  }));
  let result = text;
  for (const { reason, placeholder } of protectedReasons)
    result = result.replaceAll(reason, placeholder);
  result = redactSecrets(result).text;
  for (const { reason, placeholder } of protectedReasons)
    result = result.replaceAll(placeholder, reason);
  return result;
}

function list(items: readonly string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function safeReason(reason: string): string {
  const cleaned = redactUserContent(reason).replace(/[\r\n]+/g, " ");
  return cleaned.length <= REASON_CAP
    ? cleaned
    : `${cleaned.slice(0, REASON_CAP - 14)}[truncated]`;
}

function boundedReasons(reasons: readonly string[]): string {
  return list(reasons.slice(0, LIST_CAP).map(safeReason));
}

function qualityDecisionReasonText(
  reasons: readonly QualityDecisionReason[],
): string {
  if (reasons.length === 0) return "- None";
  return list(reasons.map((reason) => reason.replace(/[\r\n]+/g, " ")));
}

function materialAskUser(
  transformation: FullInMemoryTransformation,
): readonly { description: string }[] {
  return transformation.intent.ambiguities.filter(
    (ambiguity) =>
      ambiguity.material && ambiguity.preferredResolution === "ask_user",
  );
}

function qualityEnforcementLine(config: QualityConfigV1): string {
  return `Enforcement: ${config.enforcement}`;
}

function assessmentSection(transformation: FullInMemoryTransformation): string {
  const { intent, assessment, qualityConfig } = transformation;
  const askUser = materialAskUser(transformation);
  const riskLine =
    intent.risk.level === "low" && intent.risk.reasons.length === 0
      ? "- None"
      : list([
          `level=${intent.risk.level}`,
          ...intent.risk.reasons.slice(0, LIST_CAP).map(safeReason),
        ]);
  const clarificationLine = intent.clarification.recommended
    ? `recommended — ${safeReason(intent.clarification.reason ?? "no reason provided")}`
    : "- None";
  return [
    "## Quality assessment",
    `Outcome: ${assessment.outcome}`,
    `Policy: ${assessment.policyVersion}`,
    `Observed confidence: ${assessment.observedConfidence}`,
    `Decision reasons: ${qualityDecisionReasonText(assessment.reasons as readonly QualityDecisionReason[])}`,
    `Active ${qualityEnforcementLine(qualityConfig)}`,
    "\n## Risk",
    riskLine,
    "\n## Clarification",
    clarificationLine,
    "\n## Material ask_user ambiguities",
    list(
      askUser
        .slice(0, LIST_CAP)
        .map((ambiguity) => safeReason(ambiguity.description)),
    ),
  ].join("\n");
}

function transformationDetails(
  transformation: FullInMemoryTransformation,
): string {
  const intent = transformation.intent;
  const tasks = intent.tasks.map(
    (task, index) =>
      `${index + 1}. ${task.objective}${task.scope.length ? `\n   Scope: ${task.scope.join("; ")}` : ""}${task.constraints.length ? `\n   Constraints: ${task.constraints.join("; ")}` : ""}`,
  );
  return [
    "INTENT BRIDGE PREVIEW",
    "\n## Source language",
    intent.sourceLanguage.name
      ? `${intent.sourceLanguage.name} (${intent.sourceLanguage.code})`
      : intent.sourceLanguage.code,
    "\n## Interpreted goal",
    intent.goal,
    "\n## Tasks",
    list(tasks),
    "\n## Global constraints",
    list(intent.globalConstraints),
    "\n## Task constraints",
    list(intent.tasks.flatMap((task) => task.constraints)),
    "\n## Assumptions",
    list(intent.assumptions.map((assumption) => assumption.text)),
    "\n## Ambiguities",
    list(intent.ambiguities.map((ambiguity) => ambiguity.description)),
    "\n## Quality",
    `Confidence: ${intent.confidence}`,
    `Risk level: ${intent.risk.level}`,
    `Risk reasons: ${intent.risk.reasons.length === 0 ? "- None" : boundedReasons(intent.risk.reasons)}`,
    `Clarification recommended: ${intent.clarification.recommended ? `yes — ${safeReason(intent.clarification.reason ?? "no reason provided")}` : "no"}`,
    `Material ask_user ambiguities: ${
      materialAskUser(transformation).length === 0
        ? "- None"
        : list(
            materialAskUser(transformation)
              .slice(0, LIST_CAP)
              .map((ambiguity) => safeReason(ambiguity.description)),
          )
    }`,
    "\n## English compiled task",
    transformation.compiledTask.text,
  ].join("\n");
}

export function formatTransformation(
  transformation: FullInMemoryTransformation,
): string {
  const details = redactUserContent(transformationDetails(transformation));
  const assessment = redactAssessmentContent(assessmentSection(transformation));
  return bounded(`${details}\n\n${assessment}`);
}

export function formatLastTransformation(
  transformation: FullInMemoryTransformation,
  metadata: string,
): string {
  const details = redactUserContent(
    `${metadata}\n\nOriginal request:\n${transformation.originalText}\n\n${transformationDetails(transformation)}`,
  );
  const assessment = redactAssessmentContent(assessmentSection(transformation));
  return bounded(`${details}\n\n${assessment}`);
}
