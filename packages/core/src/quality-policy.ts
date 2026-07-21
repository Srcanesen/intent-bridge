import type { IntentDocumentV1 } from "./intent.js";

export type QualityEnforcementMode = "observe" | "review";

export type QualityDecisionReason =
  | "high_risk"
  | "clarification_recommended"
  | "material_ambiguity_requires_user"
  | "confidence_below_threshold";

export interface QualityConfigV1 {
  enforcement: QualityEnforcementMode;
  reviewOnHighRisk: boolean;
  reviewOnClarification: boolean;
  reviewOnMaterialAskUser: boolean;
  minConfidence: number | null;
  noUiAction: "send_original";
}

export interface TransformationAssessment {
  policyVersion: "quality-policy-v1";
  outcome: "accept" | "review";
  reasons: readonly QualityDecisionReason[];
  observedConfidence: number;
}

export const QUALITY_POLICY_VERSION = "quality-policy-v1" as const;

export const DEFAULT_QUALITY_CONFIG: QualityConfigV1 = {
  enforcement: "observe",
  reviewOnHighRisk: true,
  reviewOnClarification: true,
  reviewOnMaterialAskUser: true,
  minConfidence: null,
  noUiAction: "send_original",
};

const REASON_ORDER: readonly QualityDecisionReason[] = [
  "high_risk",
  "clarification_recommended",
  "material_ambiguity_requires_user",
  "confidence_below_threshold",
] as const;

const REASON_SET = new Set<QualityDecisionReason>(REASON_ORDER);

export function isQualityDecisionReason(
  value: unknown,
): value is QualityDecisionReason {
  return (
    typeof value === "string" && REASON_SET.has(value as QualityDecisionReason)
  );
}

export function assessQuality(
  intent: IntentDocumentV1,
  config: QualityConfigV1,
): TransformationAssessment {
  const reasons: QualityDecisionReason[] = [];
  if (config.reviewOnHighRisk && intent.risk.level === "high")
    reasons.push("high_risk");
  if (config.reviewOnClarification && intent.clarification.recommended)
    reasons.push("clarification_recommended");
  if (
    config.reviewOnMaterialAskUser &&
    intent.ambiguities.some(
      (ambiguity) =>
        ambiguity.material && ambiguity.preferredResolution === "ask_user",
    )
  )
    reasons.push("material_ambiguity_requires_user");
  if (config.minConfidence !== null && intent.confidence < config.minConfidence)
    reasons.push("confidence_below_threshold");
  return {
    policyVersion: QUALITY_POLICY_VERSION,
    outcome: reasons.length === 0 ? "accept" : "review",
    reasons: reasons.slice(),
    observedConfidence: intent.confidence,
  };
}
