import { describe, expect, it } from "vitest";

import {
  DEFAULT_QUALITY_CONFIG,
  QUALITY_POLICY_VERSION,
  type IntentDocumentV1,
  type QualityConfigV1,
  assessQuality,
  isQualityDecisionReason,
} from "../src/index.js";
import { validIntent } from "./fixtures/intent.js";

const override = (changes: Partial<IntentDocumentV1>): IntentDocumentV1 => ({
  ...validIntent(),
  ...changes,
});

const highRisk = (): IntentDocumentV1 =>
  override({ risk: { level: "high", reasons: ["dangerous operation"] } });

const clarification = (): IntentDocumentV1 =>
  override({
    clarification: {
      recommended: true,
      reason: "The user request needs a clarification before continuing.",
    },
  });

const materialAskUser = (): IntentDocumentV1 =>
  override({
    ambiguities: [
      {
        description: "The billing provider is not specified.",
        material: true,
        preferredResolution: "ask_user",
      },
    ],
  });

const materialInspect = (): IntentDocumentV1 =>
  override({
    ambiguities: [
      {
        description: "Some file structure.",
        material: true,
        preferredResolution: "inspect_repository",
      },
    ],
  });

const nonMaterialAskUser = (): IntentDocumentV1 =>
  override({
    ambiguities: [
      {
        description: "Trivial detail.",
        material: false,
        preferredResolution: "ask_user",
      },
    ],
  });

const lowConfidence = (): IntentDocumentV1 => override({ confidence: 0.4 });

describe("assessQuality", () => {
  it("accepts a clean default intent", () => {
    const result = assessQuality(validIntent(), DEFAULT_QUALITY_CONFIG);
    expect(result).toEqual({
      policyVersion: "quality-policy-v1",
      outcome: "accept",
      reasons: [],
      observedConfidence: 0.9,
    });
    expect(result.policyVersion).toBe(QUALITY_POLICY_VERSION);
  });

  it("flags high risk", () => {
    expect(assessQuality(highRisk(), DEFAULT_QUALITY_CONFIG)).toEqual({
      policyVersion: "quality-policy-v1",
      outcome: "review",
      reasons: ["high_risk"],
      observedConfidence: 0.9,
    });
  });

  it("flags clarification recommended", () => {
    expect(assessQuality(clarification(), DEFAULT_QUALITY_CONFIG)).toEqual({
      policyVersion: "quality-policy-v1",
      outcome: "review",
      reasons: ["clarification_recommended"],
      observedConfidence: 0.9,
    });
  });

  it("flags material ambiguity with ask_user", () => {
    expect(assessQuality(materialAskUser(), DEFAULT_QUALITY_CONFIG)).toEqual({
      policyVersion: "quality-policy-v1",
      outcome: "review",
      reasons: ["material_ambiguity_requires_user"],
      observedConfidence: 0.9,
    });
  });

  it("flags confidence strictly below the configured threshold", () => {
    const config: QualityConfigV1 = {
      ...DEFAULT_QUALITY_CONFIG,
      minConfidence: 0.5,
    };
    expect(assessQuality(lowConfidence(), config)).toEqual({
      policyVersion: "quality-policy-v1",
      outcome: "review",
      reasons: ["confidence_below_threshold"],
      observedConfidence: 0.4,
    });
  });

  it("does not trigger when confidence equals the threshold", () => {
    const config: QualityConfigV1 = {
      ...DEFAULT_QUALITY_CONFIG,
      minConfidence: 0.5,
    };
    const intent = override({ confidence: 0.5 });
    expect(assessQuality(intent, config).outcome).toBe("accept");
  });

  it("does not trigger when confidence is above the threshold", () => {
    const config: QualityConfigV1 = {
      ...DEFAULT_QUALITY_CONFIG,
      minConfidence: 0.5,
    };
    expect(assessQuality(validIntent(), config).outcome).toBe("accept");
  });

  it("does not trigger when the threshold is null", () => {
    expect(assessQuality(lowConfidence(), DEFAULT_QUALITY_CONFIG).outcome).toBe(
      "accept",
    );
  });

  it("does not flag inspect_repository alone", () => {
    expect(
      assessQuality(materialInspect(), DEFAULT_QUALITY_CONFIG).outcome,
    ).toBe("accept");
  });

  it("does not flag non-material ask_user", () => {
    expect(
      assessQuality(nonMaterialAskUser(), DEFAULT_QUALITY_CONFIG).outcome,
    ).toBe("accept");
  });

  it("orders multiple reasons deterministically", () => {
    const intent = override({
      risk: { level: "high", reasons: ["x"] },
      clarification: { recommended: true, reason: "needs confirmation" },
      ambiguities: [
        {
          description: "spec missing",
          material: true,
          preferredResolution: "ask_user",
        },
      ],
      confidence: 0.1,
    });
    const config: QualityConfigV1 = {
      ...DEFAULT_QUALITY_CONFIG,
      minConfidence: 0.5,
    };
    const result = assessQuality(intent, config);
    expect(result.outcome).toBe("review");
    expect(result.reasons).toEqual([
      "high_risk",
      "clarification_recommended",
      "material_ambiguity_requires_user",
      "confidence_below_threshold",
    ]);
  });

  it("respects each individual review flag", () => {
    const cases: Array<{
      name: string;
      config: QualityConfigV1;
      intent: IntentDocumentV1;
      reason: ReturnType<typeof assessQuality>["reasons"][number] | undefined;
    }> = [
      {
        name: "high_risk flag off",
        config: { ...DEFAULT_QUALITY_CONFIG, reviewOnHighRisk: false },
        intent: highRisk(),
        reason: undefined,
      },
      {
        name: "clarification flag off",
        config: { ...DEFAULT_QUALITY_CONFIG, reviewOnClarification: false },
        intent: clarification(),
        reason: undefined,
      },
      {
        name: "material ask_user flag off",
        config: { ...DEFAULT_QUALITY_CONFIG, reviewOnMaterialAskUser: false },
        intent: materialAskUser(),
        reason: undefined,
      },
    ];
    for (const { name, config, intent, reason } of cases) {
      const result = assessQuality(intent, config);
      if (reason === undefined) {
        expect(result.outcome, name).toBe("accept");
        expect(result.reasons, name).toEqual([]);
      } else {
        expect(result.reasons, name).toContain(reason);
      }
    }
  });

  it("observes the assessment regardless of enforcement mode", () => {
    for (const enforcement of ["observe", "review"] as const) {
      const config: QualityConfigV1 = {
        ...DEFAULT_QUALITY_CONFIG,
        enforcement,
      };
      const result = assessQuality(highRisk(), config);
      expect(result.outcome).toBe("review");
      expect(result.reasons).toEqual(["high_risk"]);
    }
  });

  it("exposes observedConfidence between 0 and 1", () => {
    for (const confidence of [0, 0.25, 0.5, 0.75, 1]) {
      const intent = override({ confidence });
      const result = assessQuality(intent, DEFAULT_QUALITY_CONFIG);
      expect(result.observedConfidence).toBe(confidence);
      expect(result.observedConfidence).toBeGreaterThanOrEqual(0);
      expect(result.observedConfidence).toBeLessThanOrEqual(1);
    }
  });

  it("is a pure deterministic function (no mutation of inputs)", () => {
    const intent = highRisk();
    const config = DEFAULT_QUALITY_CONFIG;
    const snapshotIntent = JSON.parse(JSON.stringify(intent));
    const snapshotConfig = JSON.parse(JSON.stringify(config));
    assessQuality(intent, config);
    expect(intent).toEqual(snapshotIntent);
    expect(config).toEqual(snapshotConfig);
  });
});

describe("isQualityDecisionReason", () => {
  it.each([
    "high_risk",
    "clarification_recommended",
    "material_ambiguity_requires_user",
    "confidence_below_threshold",
  ])("accepts %s", (value) => {
    expect(isQualityDecisionReason(value)).toBe(true);
  });

  it.each([
    "unknown",
    "high",
    "",
    null,
    undefined,
    0,
    {},
  ])("rejects %s", (value) => {
    expect(isQualityDecisionReason(value)).toBe(false);
  });
});
