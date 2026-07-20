import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeError } from "@intent-bridge/core";
import { describe, expect, it, vi } from "vitest";
import { compareReports, createReport, runBenchmark } from "../src/index.js";
import {
  makeCase,
  makeIntent,
  profile,
  providerWith,
  reportInput,
} from "./helpers.js";

const success = (id = "x", latencyMs = 5) => ({
  intent: makeIntent(),
  rawResponseHash: id,
  latencyMs,
  usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
});

describe("benchmark runner", () => {
  it("enforces concurrency bounds 1..8", async () => {
    const options = {
      profileId: "mock",
      profile,
      cases: [],
      provider: providerWith(vi.fn()),
    };
    await expect(runBenchmark({ ...options, concurrency: 0 })).rejects.toThrow(
      "BENCHMARK_CONCURRENCY_INVALID",
    );
    await expect(runBenchmark({ ...options, concurrency: 9 })).rejects.toThrow(
      "BENCHMARK_CONCURRENCY_INVALID",
    );
    await expect(runBenchmark({ ...options, concurrency: 1 })).resolves.toEqual(
      [],
    );
    await expect(runBenchmark({ ...options, concurrency: 8 })).resolves.toEqual(
      [],
    );
  });

  it("makes exactly one provider call per case with no retry", async () => {
    const interpret = vi.fn(async () => success());
    const cases = [makeCase("a"), makeCase("b"), makeCase("c")];
    const results = await runBenchmark({
      profileId: "mock",
      profile,
      cases,
      provider: providerWith(interpret),
    });
    expect(interpret).toHaveBeenCalledTimes(3);
    expect(results.every((result) => result.status === "transformed")).toBe(
      true,
    );
  });

  it("does not retry a retryable provider error", async () => {
    const interpret = vi.fn().mockRejectedValue(
      new BridgeError({
        code: "PROVIDER_TIMEOUT",
        safeMessage: "safe",
        retryable: true,
      }),
    );
    const results = await runBenchmark({
      profileId: "mock",
      profile,
      cases: [makeCase("no-retry")],
      provider: providerWith(interpret),
    });
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ status: "fail_open" });
  });

  it("bounds observed concurrency and preserves input order after out-of-order completion", async () => {
    let active = 0;
    let maximum = 0;
    const interpret = vi.fn(async (request) => {
      active++;
      maximum = Math.max(maximum, active);
      const id = Number(request.originalText.match(/\d+/)?.[0] ?? 0);
      await new Promise((resolve) => setTimeout(resolve, (6 - id) * 3));
      active--;
      return success(String(id));
    });
    const cases = Array.from({ length: 6 }, (_, index) =>
      makeCase(String(index)),
    );
    const results = await runBenchmark({
      profileId: "mock",
      profile,
      cases,
      provider: providerWith(interpret),
      concurrency: 2,
    });
    expect(maximum).toBe(2);
    expect(results.map((result) => result.caseId)).toEqual(
      cases.map((item) => item.id),
    );
  });

  it("isolates provider and context failures per case", async () => {
    const interpret = vi.fn(async (request) => {
      if (request.originalText.includes("bad")) throw new Error("boom");
      return success();
    });
    const results = await runBenchmark({
      profileId: "mock",
      profile,
      cases: [
        makeCase("unsafe", { contextFixture: "../outside" }),
        makeCase("bad", { input: "bad provider" }),
        makeCase("good"),
      ],
      provider: providerWith(interpret),
      contextDir: "/unused",
      concurrency: 1,
    });
    expect(results.map((result) => result.status)).toEqual([
      "fail_open",
      "fail_open",
      "transformed",
    ]);
    expect(interpret).toHaveBeenCalledTimes(2);
  });

  it("passes the abort signal in flight and marks queued cases skipped", async () => {
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    const interpret = vi.fn(async (_request, options) => {
      observed = options.signal;
      controller.abort();
      return success();
    });
    const results = await runBenchmark({
      profileId: "mock",
      profile,
      cases: [makeCase("first"), makeCase("queued-1"), makeCase("queued-2")],
      provider: providerWith(interpret),
      concurrency: 1,
      signal: controller.signal,
    });
    expect(observed).not.toBe(controller.signal);
    expect(observed?.aborted).toBe(true);
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.status)).toEqual([
      "transformed",
      "skipped",
      "skipped",
    ]);
  });

  it("does not call an evaluator by default and calls an injected evaluator once per transformed case", async () => {
    const interpret = vi.fn(async (request) => {
      if (request.originalText.includes("fail")) throw new Error("fail");
      return success();
    });
    const evaluator = {
      evaluate: vi.fn(async () => ({
        version: 1 as const,
        intentAltered: false,
        clarity: "clearer" as const,
      })),
    };
    await runBenchmark({
      profileId: "mock",
      profile,
      cases: [makeCase("default")],
      provider: providerWith(interpret),
    });
    expect(evaluator.evaluate).not.toHaveBeenCalled();
    const results = await runBenchmark({
      profileId: "mock",
      profile,
      cases: [makeCase("ok"), makeCase("fail", { input: "fail" })],
      provider: providerWith(interpret),
      evaluator,
    });
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(results[0]?.evaluation?.clarity).toBe("clearer");
  });

  it("passes transient source and candidate evidence to an injected evaluator", async () => {
    const contextDir = await mkdtemp(join(tmpdir(), "benchmark-context-"));
    const item = makeCase("judged", {
      input: "SOURCE_REQUEST_DO_NOT_REPORT",
      language: "tr",
      messageType: "steer",
      attachments: { imageCount: 2 },
      contextFixture: "evaluator",
    });
    const intent = makeIntent({
      sourceLanguage: { code: "tr", confidence: 1 },
      responseLanguage: { code: "tr" },
      messageType: "steer",
      goal: "CANDIDATE_INTENT_DO_NOT_REPORT",
    });
    const evaluator = {
      evaluate: vi.fn(async () => ({
        version: 1 as const,
        intentAltered: false,
        clarity: "equal" as const,
      })),
    };
    await writeFile(
      join(contextDir, "evaluator.json"),
      JSON.stringify({
        name: "fixture-name",
        summary: "FIXTURE_CONTEXT_DO_NOT_REPORT",
        instructionExcerpts: ["fixture instruction"],
      }),
    );
    try {
      const results = await runBenchmark({
        profileId: "mock",
        profile,
        cases: [item],
        provider: providerWith(async () => ({ ...success(), intent })),
        evaluator,
        contextDir,
      });
      expect(results[0]?.status).toBe("transformed");
      expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
      expect(evaluator.evaluate).toHaveBeenCalledWith({
        caseId: item.id,
        source: {
          originalText: item.input,
          sourceLanguage: item.language,
          messageType: item.messageType,
          attachmentSummary: { imageCount: 2 },
          projectContext: {
            name: "fixture-name",
            summary: "FIXTURE_CONTEXT_DO_NOT_REPORT",
            instructionExcerpts: ["fixture instruction"],
          },
        },
        candidate: {
          intent,
          compiledTask: expect.objectContaining({
            compilerVersion: "pi-v1",
            responseLanguageCode: "tr",
            text: expect.stringContaining(item.input),
          }),
        },
      });
      expect(JSON.stringify(results[0])).not.toContain(
        "SOURCE_REQUEST_DO_NOT_REPORT",
      );
      expect(JSON.stringify(results[0])).not.toContain(
        "CANDIDATE_INTENT_DO_NOT_REPORT",
      );
      expect(JSON.stringify(results[0])).not.toContain(
        "FIXTURE_CONTEXT_DO_NOT_REPORT",
      );
    } finally {
      await rm(contextDir, { recursive: true, force: true });
    }
  });

  it("isolates throwing and invalid evaluator output without changing deterministic results", async () => {
    const base = {
      profileId: "mock",
      profile,
      cases: [makeCase("one")],
      provider: providerWith(async () => success()),
    };
    const baseline = await runBenchmark(base);
    const throwing = await runBenchmark({
      ...base,
      evaluator: {
        evaluate: async () => {
          throw new Error("no");
        },
      },
    });
    const invalid = await runBenchmark({
      ...base,
      evaluator: {
        evaluate: async () =>
          ({ version: 1, intentAltered: false, clarity: "invalid" }) as never,
      },
    });
    for (const results of [throwing, invalid]) {
      const { evaluatorError, ...deterministicResult } = results[0] ?? {};
      expect(deterministicResult).toEqual(baseline[0]);
      expect(results[0]?.evaluation).toBeUndefined();
      expect(evaluatorError).toBe("EVALUATOR_FAILED");
    }
  });

  it("captures trace metrics without full intent, compiled task, or provider body", async () => {
    const results = await runBenchmark({
      profileId: "mock",
      profile,
      cases: [makeCase("metrics")],
      provider: providerWith(async () => success("metrics", 17)),
    });
    expect(results[0]).toMatchObject({
      latencyMs: 17,
      tokenUsage: { input: 10, output: 4, total: 14 },
      estimatedCostUsd: 0.000018,
      quality: { schemaValid: true, compilerValid: true },
    });
    expect(Object.keys(results[0] ?? {})).not.toEqual(
      expect.arrayContaining([
        "intent",
        "compiledTask",
        "trace",
        "rawResponseHash",
      ]),
    );
  });

  it("runs the same subset through two injected profiles and compares reports", async () => {
    const cases = [makeCase("a"), makeCase("b")];
    const run = async (id: string, latency: number) =>
      createReport(
        reportInput(
          await runBenchmark({
            profileId: id,
            profile: { ...profile, id, model: id },
            cases,
            provider: providerWith(async () => success(id, latency)),
          }),
          id,
        ),
      );
    const left = await run("profile-a", 3);
    const right = await run("profile-b", 9);
    expect(left.results).toHaveLength(2);
    expect(right.results).toHaveLength(2);
    expect(compareReports(left, right).winner).toBe("profile-a");
  });
});
