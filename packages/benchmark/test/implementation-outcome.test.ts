import { mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  aggregateImplementationOutcomes,
  createImplementationOutcomeReport,
  deterministicImplementationOrders,
  inspectImplementationOutcome,
  loadImplementationCases,
  materializeImplementationFixture,
  parseImplementationCaseV1,
  parseImplementationOutcomeReportV1,
  requireIsolationPreflight,
  writeImplementationOutcomeReport,
  type ImplementationArmResultV1,
} from "../src/index.js";

const casesPath = join(
  process.cwd(),
  "benchmarks/implementation-outcome/cases.json",
);
const zeroHash = "0".repeat(64);

function arm(
  armName: "control" | "treatment",
  order: 0 | 1,
): ImplementationArmResultV1 {
  return {
    caseId: "case-1",
    arm: armName,
    order,
    status: "completed",
    errorCode: "NONE",
    taskSuccess: true,
    validationPassed: 1,
    validationTotal: 1,
    assertionPassed: 1,
    assertionTotal: 1,
    forbiddenViolation: false,
    scopeViolation: false,
    expectedClarification: "none",
    observedClarification: false,
    touchedPaths: ["src/index.js"],
    touchedCount: 1,
    diff: { sha256: zeroHash, insertions: 1, deletions: 1, binaryFiles: 0 },
    implementationLatencyMs: 10,
    treatmentCompilationLatencyMs: armName === "treatment" ? 5 : null,
    turns: 1,
    toolCalls: 1,
    repeatedMutations: 0,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    blockedSafety: { boundary: 0, network: 0, destructive: 0 },
    responseLanguageSafety: "unavailable",
    fixtureRevision: "1".repeat(40),
    fixtureTree: "2".repeat(40),
  };
}

function report() {
  const pair = {
    caseId: "case-1",
    configHash: "3".repeat(64),
    fixtureRevision: "1".repeat(40),
    fixtureTree: "2".repeat(40),
    order: ["control", "treatment"] as const,
    arms: [arm("control", 0), arm("treatment", 1)] as const,
  };
  return createImplementationOutcomeReport({
    runConfigHash: "3".repeat(64),
    pi: {
      packageVersion: "0.80.10",
      provider: "provider",
      model: "model",
      thinking: "medium",
    },
    bridge: {
      provider: "bridge-provider",
      model: "bridge-model",
      schemaVersion: "2",
      promptVersion: "prompt-v1",
      compilerVersion: "pi-v2",
      policyVersion: "policy-v1",
    },
    corpusHash: "4".repeat(64),
    seed: "seed",
    policyHash: "5".repeat(64),
    pairs: [pair],
  });
}

describe("implementation outcome contracts", () => {
  test("loads the separate strict 12-case corpus and rejects unsafe fields", async () => {
    const cases = await loadImplementationCases(casesPath);
    expect(cases).toHaveLength(12);
    expect(new Set(cases.map((item) => item.language))).toEqual(
      new Set(["tr", "en", "es"]),
    );
    expect(() =>
      parseImplementationCaseV1({ ...cases[0], extra: true }),
    ).toThrow();
    expect(() =>
      parseImplementationCaseV1({ ...cases[0], fixture: "../escape" }),
    ).toThrow("IMPLEMENTATION_PATH_INVALID");
    expect(() =>
      parseImplementationCaseV1({ ...cases[0], allowedPaths: ["src", "src"] }),
    ).toThrow("IMPLEMENTATION_PATH_DUPLICATE");
    expect(() =>
      parseImplementationCaseV1({
        ...cases[0],
        timeoutMs: Number.POSITIVE_INFINITY,
      }),
    ).toThrow();
  });

  test("rejects missing arms, raw fields, and inconsistent aggregates", () => {
    const valid = report();
    expect(parseImplementationOutcomeReportV1(valid)).toEqual(valid);
    expect(() =>
      parseImplementationOutcomeReportV1({ ...valid, prompt: "RAW" }),
    ).toThrow();
    expect(() =>
      parseImplementationOutcomeReportV1({
        ...valid,
        pairs: [{ ...valid.pairs[0], arms: [valid.pairs[0]?.arms[0]] }],
      }),
    ).toThrow();
    expect(() =>
      parseImplementationOutcomeReportV1({
        ...valid,
        runConfigHash: "9".repeat(64),
      }),
    ).toThrow();
    expect(() =>
      parseImplementationOutcomeReportV1({
        ...valid,
        aggregates: {
          ...valid.aggregates,
          control: {
            ...valid.aggregates.control,
            taskSuccessRate: { value: 0, denominator: 1 },
          },
        },
      }),
    ).toThrow("IMPLEMENTATION_AGGREGATES_INCONSISTENT");
  });

  test("excludes invalid arms from outcome denominators and computes treatment-minus-control", () => {
    const control = arm("control", 0);
    control.status = "invalid";
    control.errorCode = "INVALID_BASELINE";
    control.taskSuccess = false;
    const treatment = arm("treatment", 1);
    treatment.scopeViolation = true;
    const aggregates = aggregateImplementationOutcomes([
      {
        caseId: "case-1",
        configHash: "3".repeat(64),
        fixtureRevision: control.fixtureRevision,
        fixtureTree: control.fixtureTree,
        order: ["control", "treatment"],
        arms: [control, treatment],
      },
    ]);
    expect(aggregates.control.taskSuccessRate).toEqual({
      value: null,
      denominator: 0,
    });
    expect(aggregates.treatment.scopeViolationRate).toEqual({
      value: 1,
      denominator: 1,
    });
    expect(aggregates.pairedTreatmentMinusControl.taskSuccessRate).toBeNull();
  });
});

describe("fixtures, isolation and privacy", () => {
  test("materializes identical clean revisions and measures a successful scoped change", async () => {
    const cases = await loadImplementationCases(casesPath);
    const caseItem = cases[0];
    if (!caseItem) throw new Error("fixture missing");
    const corpusRoot = dirname(casesPath);
    const left = await materializeImplementationFixture({
      caseItem,
      corpusRoot,
    });
    const right = await materializeImplementationFixture({
      caseItem,
      corpusRoot,
    });
    try {
      expect([left.revision, left.tree]).toEqual([right.revision, right.tree]);
      await writeFile(
        join(left.cwd, "src/index.js"),
        "export const add = (a, b) => a + b;\n",
      );
      const result = await inspectImplementationOutcome({
        caseItem,
        cwd: left.cwd,
        arm: "control",
        order: 0,
        fixtureRevision: left.revision,
        fixtureTree: left.tree,
        implementationLatencyMs: 5,
        treatmentCompilationLatencyMs: null,
        observedClarification: false,
        turns: 1,
        toolCalls: 1,
        repeatedMutations: 0,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        blockedSafety: { boundary: 0, network: 0, destructive: 0 },
      });
      expect(result.taskSuccess).toBe(true);
      expect(result.touchedPaths).toEqual(["src/index.js"]);
      expect(result.diff.insertions).toBeGreaterThan(0);
    } finally {
      await Promise.all([left.dispose(), right.dispose()]);
    }
  });

  test("requires compatible external isolation metadata before live execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "ib-isolation-"));
    const cwd = await realpath(process.cwd());
    const path = join(root, "attestation.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        writableFixtureRoot: root,
        policyHash: "a".repeat(64),
        network: {
          mode: "deny-except-inference-gateway",
          inferenceHosts: ["gateway.invalid:443"],
        },
        process: { pid: process.pid, cwd },
        sourceRepoWritable: false,
        homeMounted: false,
        credentialsMounted: false,
        dockerSocketMounted: false,
      }),
    );
    await expect(
      requireIsolationPreflight({
        liveOptIn: undefined,
        attestationPath: path,
        fixtureRoot: root,
      }),
    ).rejects.toThrow("INVALID_ISOLATION");
    await expect(
      requireIsolationPreflight({
        liveOptIn: "1",
        attestationPath: path,
        fixtureRoot: root,
      }),
    ).resolves.toMatchObject({ policyHash: "a".repeat(64) });
    await writeFile(path, "{}");
    await expect(
      requireIsolationPreflight({
        liveOptIn: "1",
        attestationPath: path,
        fixtureRoot: root,
      }),
    ).rejects.toThrow("INVALID_ISOLATION");
  });

  test("writes only strict bounded report fields with mode 0600", async () => {
    const root = await mkdtemp(join(tmpdir(), "ib-report-"));
    const path = join(root, "report.json");
    await writeImplementationOutcomeReport(path, report());
    const text = await readFile(path, "utf8");
    for (const sentinel of [
      "PROMPT_SENTINEL",
      "COMPILED_SENTINEL",
      "ASSISTANT_SENTINEL",
      "TOOL_ARG_SENTINEL",
      "PROVIDER_ERROR_SENTINEL",
    ])
      expect(text).not.toContain(sentinel);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(
      writeImplementationOutcomeReport(path, report()),
    ).rejects.toThrow();
  });

  test("balances deterministic order from seed and case id", async () => {
    const cases = await loadImplementationCases(casesPath);
    const first = deterministicImplementationOrders(cases, "seed");
    const second = deterministicImplementationOrders(cases, "seed");
    expect([...first]).toEqual([...second]);
    expect(
      [...first.values()].filter(([arm]) => arm === "control"),
    ).toHaveLength(6);
  });
});
