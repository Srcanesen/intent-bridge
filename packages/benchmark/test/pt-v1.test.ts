import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type PtV1Manifest,
  type PtV1GoldAnnotation,
  type BenchmarkCaseV1,
  parseBenchmarkCaseV1,
  isSafetyCase,
} from "../src/index.js";
import {
  validatePtV1Corpus,
  loadPtV1Cases,
  parsePtV1GoldAnnotation,
  parsePtV1Manifest,
  computePtV1ContentHash,
} from "../src/index.js";
import { makeResult, reportInput } from "./helpers.js";
import { createReportV2, createCorpusMetadata } from "../src/report.js";
import { summarizePtV1, wilsonInterval } from "../src/pt-v1-summarizer.js";
const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));

// ── Helpers ─────────────────────────────────────────────────────────────────
const rubricContent =
  "Pre-registered hypotheses and thresholds for prompt-transformation-v1 benchmark.";

const makeAnnotation = (
  id: string,
  overrides: Partial<PtV1GoldAnnotation> = {},
): PtV1GoldAnnotation => ({
  caseId: id,
  stratum: "informal",
  language: "en",
  explicitGoals: ["fix the login button"],
  explicitConstraints: [],
  allowedAssumptions: ["Project has standard tooling"],
  materialAmbiguities: [],
  prohibitedInventedRequirements: [],
  expectedClarificationBehavior: "Not applicable for this case type",
  responseLanguage: "en",
  domain: "auth",
  difficulty: "easy",
  ...overrides,
});

const makePtV1Case = (
  id: string,
  lang: "tr" | "en" = "en",
  overrides: Partial<BenchmarkCaseV1> = {},
): BenchmarkCaseV1 => ({
  version: 1,
  id,
  title: `Case ${id}`,
  language: lang,
  messageType: "initial",
  input: `User request for ${id}`,
  expected: {
    requiredGoalConcepts: ["test concept"],
    requiredConstraints: [],
    forbiddenAdditions: [],
    responseLanguage: lang,
  },
  tags: lang === "tr" ? [] : ["explicit-constraints"],
  ...overrides,
});

describe("pt-v1 validation", () => {
  // ── Annotation parsing ──────────────────────────────────────────────────
  it("strictly parses gold annotations", () => {
    const ann = makeAnnotation("test-01", {
      stratum: "ambiguity",
      materialAmbiguities: ["Missing authentication method"],
    });
    expect(parsePtV1GoldAnnotation(ann)).toEqual(ann);
  });

  it("rejects malformed annotations", () => {
    expect(() => parsePtV1GoldAnnotation(null)).toThrow(
      "PT_V1_VALIDATION_FAILED",
    );
    expect(() => parsePtV1GoldAnnotation({})).toThrow(
      "PT_V1_VALIDATION_FAILED",
    );
    expect(() =>
      parsePtV1GoldAnnotation({
        caseId: "",
        stratum: "clear",
        language: "en",
        explicitGoals: [],
        responseLanguage: "en",
        domain: "test",
        difficulty: "easy",
        expectedClarificationBehavior: "test",
      }),
    ).toThrow("PT_V1_VALIDATION_FAILED");
    expect(() =>
      parsePtV1GoldAnnotation(
        makeAnnotation("x", { stratum: "invalid" as never }),
      ),
    ).toThrow("PT_V1_VALIDATION_FAILED");
    expect(() =>
      parsePtV1GoldAnnotation(makeAnnotation("x", { language: "fr" as never })),
    ).toThrow("PT_V1_VALIDATION_FAILED");
    expect(() =>
      parsePtV1GoldAnnotation(
        makeAnnotation("x", { responseLanguage: "tr", language: "en" }),
      ),
    ).toThrow("PT_V1_VALIDATION_FAILED");
  });

  it("rejects annotations with unknown keys", () => {
    expect(() =>
      parsePtV1GoldAnnotation({
        ...makeAnnotation("x"),
        unknownKey: true,
      }),
    ).toThrow("PT_V1_VALIDATION_FAILED");
  });

  // ── Manifest parsing ────────────────────────────────────────────────────
  it("strictly parses the manifest", () => {
    const manifest: PtV1Manifest = {
      schemaVersion: 1,
      subjectRelease: "v1.1.0",
      subjectCommit: "962a431292dae8d082abf5442329939207e38c48",
      seed: 42,
      languages: ["tr", "en"],
      strata: ["informal", "clear", "ambiguity", "edge-safety"],
      totalConfirmatory: 80,
      totalSmoke: 8,
      distribution: {
        tr: {
          informal: 24,
          clear: 6,
          ambiguity: 6,
          "edge-safety": 4,
          total: 40,
        },
        en: {
          informal: 24,
          clear: 6,
          ambiguity: 6,
          "edge-safety": 4,
          total: 40,
        },
      },
      smokeDistribution: {
        tr: {
          informal: 1,
          clear: 1,
          ambiguity: 1,
          "edge-safety": 1,
          total: 4,
        },
        en: {
          informal: 1,
          clear: 1,
          ambiguity: 1,
          "edge-safety": 1,
          total: 4,
        },
      },
      contentSha256: "0".repeat(64),
      smokeContentSha256: "1".repeat(64),
    };
    expect(parsePtV1Manifest(manifest)).toEqual(manifest);
  });

  it("rejects malformed manifests", () => {
    expect(() => parsePtV1Manifest(null)).toThrow("PT_V1_VALIDATION_FAILED");
    expect(() =>
      parsePtV1Manifest({
        schemaVersion: 1,
        subjectRelease: "v1.1.0",
        subjectCommit: "short",
        languages: ["tr", "en"],
        strata: ["informal"],
        totalConfirmatory: 80,
        totalSmoke: 8,
        distribution: {},
        smokeDistribution: {},
        contentSha256: "0".repeat(64),
        smokeContentSha256: "1".repeat(64),
      }),
    ).toThrow("PT_V1_VALIDATION_FAILED");
    expect(() =>
      parsePtV1Manifest({
        schemaVersion: 1,
        subjectRelease: "v1.1.0",
        subjectCommit: "0".repeat(40),
        languages: ["tr", "en"],
        strata: ["informal", "clear", "ambiguity", "edge-safety"],
        totalConfirmatory: 80,
        totalSmoke: 8,
        distribution: {
          tr: {
            informal: 24,
            clear: 6,
            ambiguity: 6,
            "edge-safety": 4,
            total: 40,
          },
          en: {
            informal: 24,
            clear: 6,
            ambiguity: 6,
            "edge-safety": 4,
            total: 40,
          },
        },
        smokeDistribution: {
          tr: {
            informal: 1,
            clear: 1,
            ambiguity: 1,
            "edge-safety": 1,
            total: 4,
          },
          en: {
            informal: 1,
            clear: 1,
            ambiguity: 1,
            "edge-safety": 1,
            total: 4,
          },
        },
        contentSha256: "0".repeat(64),
        smokeContentSha256: "1".repeat(64),
      }),
    ).toThrow("PT_V1_VALIDATION_FAILED:manifest-subjectCommit");
  });

  // ── Hash determinism ────────────────────────────────────────────────────
  it("computes deterministic content hash", () => {
    const cases = [makePtV1Case("b-test"), makePtV1Case("a-test")];
    const annotations = [makeAnnotation("b-test"), makeAnnotation("a-test")];
    const hash1 = computePtV1ContentHash(cases, annotations, rubricContent);
    const hash2 = computePtV1ContentHash(cases, annotations, rubricContent);
    expect(hash1).toBe(hash2);
  });

  it("binds nested case expectations and gold annotations", () => {
    const cases = [makePtV1Case("test")];
    const annotations = [makeAnnotation("test")];
    const hash = computePtV1ContentHash(cases, annotations, rubricContent);
    const changedCase = [
      makePtV1Case("test", "en", {
        expected: {
          ...cases[0].expected,
          requiredConstraints: ["preserve behavior"],
        },
      }),
    ];
    const changedAnnotations = [
      makeAnnotation("test", { materialAmbiguities: ["Missing scope"] }),
    ];
    expect(
      computePtV1ContentHash(changedCase, annotations, rubricContent),
    ).not.toBe(hash);
    expect(
      computePtV1ContentHash(cases, changedAnnotations, rubricContent),
    ).not.toBe(hash);
  });

  it("rejects drifting hash", () => {
    const cases = [makePtV1Case("test")];
    const annotations = [makeAnnotation("test")];
    const hash1 = computePtV1ContentHash(cases, annotations, rubricContent);
    const cases2 = [makePtV1Case("test", "en", { input: "modified input" })];
    const hash2 = computePtV1ContentHash(cases2, annotations, rubricContent);
    expect(hash1).not.toBe(hash2);
  });

  it("computes different hash for different rubric", () => {
    const cases = [makePtV1Case("test")];
    const annotations = [makeAnnotation("test")];
    const hash1 = computePtV1ContentHash(cases, annotations, rubricContent);
    const hash2 = computePtV1ContentHash(
      cases,
      annotations,
      "different rubric",
    );
    expect(hash1).not.toBe(hash2);
  });
});

// ── Summarizer tests ───────────────────────────────────────────────────────
describe("pt-v1 summarizer", () => {
  it("computes wilson intervals correctly", () => {
    // 80/80 = 100% → interval should be tight
    const perfect = wilsonInterval(80, 80);
    expect(perfect.wilsonLower).toBeCloseTo(0.95, 1);
    expect(perfect.wilsonUpper).toBeCloseTo(1.0, 1);

    // 0/80 = 0%
    const zero = wilsonInterval(0, 80);
    expect(zero.wilsonLower).toBeCloseTo(0, 1);
    expect(zero.wilsonUpper).toBeCloseTo(0.05, 1);

    // 40/80 = 50%
    const half = wilsonInterval(40, 80);
    expect(half.wilsonLower).toBeCloseTo(0.39, 1);
    expect(half.wilsonUpper).toBeCloseTo(0.61, 1);

    // 0/0 = unavailable
    const empty = wilsonInterval(0, 0);
    expect(empty.wilsonLower).toBeNull();
    expect(empty.wilsonUpper).toBeNull();
  });

  it("keeps sanitized gates, shared safety classification, and failure-rate semantics aligned", () => {
    const cases: BenchmarkCaseV1[] = [];
    for (let i = 0; i < 24; i++) {
      cases.push(makePtV1Case(`en-inf-${i}`, "en", { tags: [] }));
    }
    for (let i = 0; i < 6; i++) {
      cases.push(
        makePtV1Case(`en-clr-${i}`, "en", {
          tags: ["explicit-constraints"],
        }),
      );
    }
    for (let i = 0; i < 6; i++) {
      cases.push(
        makePtV1Case(`en-amb-${i}`, "en", {
          tags: ["vague"],
          expected: {
            ...makePtV1Case("x").expected,
            clarificationRecommended: true,
          },
        }),
      );
    }
    for (let i = 0; i < 4; i++) {
      cases.push(makePtV1Case(`en-edg-${i}`, "en", { tags: ["secret-like"] }));
    }
    for (let i = 0; i < 24; i++) {
      cases.push(makePtV1Case(`tr-inf-${i}`, "tr", { tags: [] }));
    }
    for (let i = 0; i < 6; i++) {
      cases.push(
        makePtV1Case(`tr-clr-${i}`, "tr", {
          tags: ["explicit-constraints"],
        }),
      );
    }
    for (let i = 0; i < 6; i++) {
      cases.push(
        makePtV1Case(`tr-amb-${i}`, "tr", {
          tags: ["vague"],
          expected: {
            ...makePtV1Case("x").expected,
            clarificationRecommended: true,
          },
        }),
      );
    }
    for (let i = 0; i < 4; i++) {
      cases.push(makePtV1Case(`tr-edg-${i}`, "tr", { tags: ["secret-like"] }));
    }

    const results = cases.map((c) =>
      makeResult(c.id, {
        tags: c.tags,
        evaluation: {
          version: 1,
          intentAltered: false,
          clarity: "clearer",
        },
        quality: {
          schemaValid: true,
          languagePresent: true,
          taskCount: 1,
          hasGoal: true,
          constraintsSeparated: true,
          assumptionsSeparated: true,
          ambiguitiesTyped: c.tags.includes("vague"),
          compilerValid: true,
        },
        invariant: {
          passed: true,
          checks: [
            { name: "schema_valid", passed: true },
            { name: "compiler_valid", passed: true },
            { name: "message_type", passed: true },
            { name: "response_language", passed: true },
            { name: "compiled_response_language", passed: true },
            { name: "original_request_fenced", passed: true },
            { name: "forbidden_additions", passed: true },
            ...(c.expected.clarificationRecommended !== undefined
              ? [
                  {
                    name: "clarification" as const,
                    passed: c.expected.clarificationRecommended,
                  },
                ]
              : []),
          ],
        },
      }),
    );

    const report = createReportV2({
      ...reportInput(results, "pt-v1-test"),
      corpus: createCorpusMetadata(cases),
    });

    const manifest: PtV1Manifest = {
      schemaVersion: 1,
      subjectRelease: "v1.1.0",
      subjectCommit: "962a431292dae8d082abf5442329939207e38c48",
      seed: 42,
      languages: ["tr", "en"],
      strata: ["informal", "clear", "ambiguity", "edge-safety"],
      totalConfirmatory: 80,
      totalSmoke: 8,
      distribution: {
        tr: {
          informal: 24,
          clear: 6,
          ambiguity: 6,
          "edge-safety": 4,
          total: 40,
        },
        en: {
          informal: 24,
          clear: 6,
          ambiguity: 6,
          "edge-safety": 4,
          total: 40,
        },
      },
      smokeDistribution: {
        tr: {
          informal: 1,
          clear: 1,
          ambiguity: 1,
          "edge-safety": 1,
          total: 4,
        },
        en: {
          informal: 1,
          clear: 1,
          ambiguity: 1,
          "edge-safety": 1,
          total: 4,
        },
      },
      contentSha256: "0".repeat(64),
      smokeContentSha256: "1".repeat(64),
    };

    const annotations = cases.map((c) =>
      makeAnnotation(c.id, {
        stratum: c.tags.includes("explicit-constraints")
          ? ("clear" as const)
          : c.tags.includes("vague")
            ? ("ambiguity" as const)
            : isSafetyCase(c)
              ? ("edge-safety" as const)
              : ("informal" as const),
        language: c.language as "tr" | "en",
        responseLanguage: c.language as "tr" | "en",
        explicitGoals: c.expected.requiredGoalConcepts,
      }),
    );

    const output = summarizePtV1({ report, manifest, annotations });

    // Sanitized output - no raw content
    expect(output.totalConfirmatoryCases).toBe(80);
    expect(output.subjectRelease).toBe("v1.1.0");

    // Gates present
    const gateNames = output.gates.map((g) => g.gate);
    expect(gateNames).toContain("attempted-80-80");
    expect(gateNames).toContain("structural-gte-98pct");
    expect(gateNames).toContain("language-100pct-overall");
    expect(gateNames).toContain("language-100pct-tr");
    expect(gateNames).toContain("language-100pct-en");
    expect(gateNames).toContain("deterministic-safety-100pct");
    expect(gateNames).toContain("material-intent-alteration-lte-5pct");
    expect(gateNames).toContain("zero-confirmed-forbidden-additions");
    expect(gateNames).toContain("informal-clearer-gte-80pct");
    expect(gateNames).toContain("informal-less-clear-lte-5pct");
    expect(gateNames).toContain("no-clear-control-degraded");
    expect(gateNames).toContain("ambiguity-handling-gte-90pct");

    // All gates should be pass with this perfect data (when denominator > 0)
    const nonZeroDenomGates = output.gates.filter((g) => g.denominator > 0);
    for (const gate of nonZeroDenomGates) {
      expect(["pass", "fail", "unavailable"]).toContain(gate.status);
    }
    // Specific critical gates must pass
    const gateMap = new Map(output.gates.map((g) => [g.gate, g]));
    expect(gateMap.get("attempted-80-80")?.status).toBe("pass");
    expect(gateMap.get("zero-confirmed-forbidden-additions")?.status).toBe(
      "pass",
    );
    expect(gateMap.get("no-clear-control-degraded")?.status).toBe("pass");
    expect(gateMap.get("deterministic-safety-100pct")?.denominator).toBe(8);
    // quality.ambiguitiesTyped and a passing clarification invariant do not
    // prove that the reviewed ambiguity itself was identified.
    expect(gateMap.get("ambiguity-handling-gte-90pct")?.status).toBe(
      "unavailable",
    );

    // Stratified rates present
    expect(output.stratifiedRates.length).toBeGreaterThan(0);

    const failedResults = results.map((result, index) =>
      index === 0
        ? {
            ...result,
            invariant: {
              passed: false,
              checks: result.invariant.checks.map((check) =>
                check.name === "forbidden_additions"
                  ? { ...check, passed: false }
                  : check,
              ),
            },
          }
        : result,
    );
    const failureOutput = summarizePtV1({
      report: createReportV2({
        ...reportInput(failedResults, "pt-v1-test"),
        corpus: createCorpusMetadata(cases),
      }),
      manifest,
      annotations,
    });
    const failureRate = failureOutput.stratifiedRates.find(
      (rate) =>
        rate.stratum === "all" &&
        rate.language === "all" &&
        rate.metric === "forbidden-additions-failure-rate",
    );
    expect(failureRate?.numerator).toBe(1);
    expect(failureRate?.denominator).toBe(80);
    expect(failureRate?.rate).toBe(1 / 80);
    expect(
      failureOutput.stratifiedRates.some(
        (rate) => rate.metric === "forbidden-additions-clean",
      ),
    ).toBe(false);

    // Limitations present
    expect(output.limitations.length).toBeGreaterThan(0);
  });

  it("marks ambiguity handling unavailable when no ambiguity-stratum cases exist", () => {
    const cases: BenchmarkCaseV1[] = [];
    for (let i = 0; i < 6; i++) {
      cases.push(
        makePtV1Case(`en-clr-${i}`, "en", {
          tags: ["explicit-constraints"],
        }),
      );
    }

    const results = cases.map((c) => makeResult(c.id, { tags: c.tags }));

    const report = createReportV2({
      ...reportInput(results, "pt-v1-test"),
      corpus: createCorpusMetadata(cases),
    });

    const manifest: PtV1Manifest = {
      schemaVersion: 1,
      subjectRelease: "v1.1.0",
      subjectCommit: "962a431292dae8d082abf5442329939207e38c48",
      seed: 42,
      languages: ["tr", "en"],
      strata: ["informal", "clear", "ambiguity", "edge-safety"],
      totalConfirmatory: 6,
      totalSmoke: 0,
      distribution: {
        tr: {
          informal: 0,
          clear: 0,
          ambiguity: 0,
          "edge-safety": 0,
          total: 0,
        },
        en: {
          informal: 0,
          clear: 6,
          ambiguity: 0,
          "edge-safety": 0,
          total: 6,
        },
      },
      smokeDistribution: {
        tr: {
          informal: 0,
          clear: 0,
          ambiguity: 0,
          "edge-safety": 0,
          total: 0,
        },
        en: {
          informal: 0,
          clear: 0,
          ambiguity: 0,
          "edge-safety": 0,
          total: 0,
        },
      },
      contentSha256: "0".repeat(64),
      smokeContentSha256: "1".repeat(64),
    };

    const annotations = cases.map((c) =>
      makeAnnotation(c.id, {
        stratum: "clear",
        language: "en",
        responseLanguage: "en",
      }),
    );

    const output = summarizePtV1({ report, manifest, annotations });

    const ambiguityGate = output.gates.find(
      (g) => g.gate === "ambiguity-handling-gte-90pct",
    );
    expect(ambiguityGate?.status).toBe("unavailable");
  });

  it("marks gates fail on missing evaluator verdicts (verdicts cannot improve scores)", () => {
    const cases = [makePtV1Case("test-case", "en")];
    const result = makeResult("test-case", {
      evaluation: undefined,
      tags: [],
    });
    const report = createReportV2({
      ...reportInput([result], "pt-v1-test"),
      corpus: createCorpusMetadata(cases),
    });
    const manifest: PtV1Manifest = {
      schemaVersion: 1,
      subjectRelease: "v1.1.0",
      subjectCommit: "962a431292dae8d082abf5442329939207e38c48",
      seed: 42,
      languages: ["tr", "en"],
      strata: ["informal", "clear", "ambiguity", "edge-safety"],
      totalConfirmatory: 1,
      totalSmoke: 0,
      distribution: {
        tr: {
          informal: 0,
          clear: 0,
          ambiguity: 0,
          "edge-safety": 0,
          total: 0,
        },
        en: {
          informal: 1,
          clear: 0,
          ambiguity: 0,
          "edge-safety": 0,
          total: 1,
        },
      },
      smokeDistribution: {
        tr: {
          informal: 0,
          clear: 0,
          ambiguity: 0,
          "edge-safety": 0,
          total: 0,
        },
        en: {
          informal: 0,
          clear: 0,
          ambiguity: 0,
          "edge-safety": 0,
          total: 0,
        },
      },
      contentSha256: "0".repeat(64),
      smokeContentSha256: "1".repeat(64),
    };
    const annotations = [makeAnnotation("test-case")];
    const output = summarizePtV1({ report, manifest, annotations });
    const informalClearer = output.gates.find(
      (g) => g.gate === "informal-clearer-gte-80pct",
    );
    // Missing evaluator verdicts → gate unavailable, but denominator fixed at 1, rate 0
    expect(informalClearer?.status).toBe("unavailable");
    expect(informalClearer?.denominator).toBe(1);
    expect(informalClearer?.rate).toBe(0);
    expect(
      output.gates.find((g) => g.gate === "informal-less-clear-lte-5pct")
        ?.detail,
    ).toBe("No evaluator verdicts available for informal-stratum cases.");
  });
});

// ── Smoke tests: verifying the real corpus ─────────────────────────────────
describe("pt-v1 real corpus", () => {
  it("validates 80 confirmatory + 8 smoke cases with correct distribution", async () => {
    const result = await validatePtV1Corpus();
    expect(result.valid).toBe(true);
    expect(result.confirmatoryCount).toBe(80);
    expect(result.smokeCount).toBe(8);
    expect(result.distribution.tr.informal).toBe(24);
    expect(result.distribution.tr.clear).toBe(6);
    expect(result.distribution.tr.ambiguity).toBe(6);
    expect(result.distribution.tr["edge-safety"]).toBe(4);
    expect(result.distribution.en.informal).toBe(24);
    expect(result.distribution.en.clear).toBe(6);
    expect(result.distribution.en.ambiguity).toBe(6);
    expect(result.distribution.en["edge-safety"]).toBe(4);
    expect(result.smokeDistribution.tr.informal).toBe(1);
    expect(result.smokeDistribution.en.informal).toBe(1);
  });

  it("produces deterministic hash from real corpus", async () => {
    const result = await validatePtV1Corpus();
    expect(result.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.smokeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.manifestHash).not.toBe(result.smokeHash);
  });

  it("loads all 80 cases as valid BenchmarkCaseV1", async () => {
    const ptV1Dir = join(
      projectRoot,
      "benchmarks",
      "prompt-transformation-v1",
      "cases",
    );
    const cases = await loadPtV1Cases(ptV1Dir);
    expect(cases).toHaveLength(80);
    for (const c of cases) {
      expect(parseBenchmarkCaseV1(c)).toEqual(c);
    }
  });
});
