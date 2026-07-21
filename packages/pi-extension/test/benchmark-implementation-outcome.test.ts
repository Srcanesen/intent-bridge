import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock(
  "../../benchmark/dist/index.js",
  async () => import("../../benchmark/src/index.ts"),
);

import {
  detectsClarification,
  executePiArm,
  parseArgs,
  runImplementationBenchmark,
  validateImplementationCorpus,
} from "../scripts/benchmark-implementation-outcome.mjs";

const casesPath = join(
  process.cwd(),
  "benchmarks/implementation-outcome/cases.json",
);
const originalLive = process.env.INTENT_BRIDGE_LIVE_TESTS;
afterEach(() => {
  if (originalLive === undefined) delete process.env.INTENT_BRIDGE_LIVE_TESTS;
  else process.env.INTENT_BRIDGE_LIVE_TESTS = originalLive;
});

function mockSdk(sessionModel?: { provider: string; id: string }) {
  type Handler = (event: Record<string, unknown>) => unknown;
  type SessionOptions = {
    model: { provider: string; id: string };
    thinkingLevel: string;
    tools: string[];
    resourceLoader: { options: Record<string, unknown> };
    sessionManager: { cwd: string };
    settingsManager: { settings: unknown };
  };
  const created: SessionOptions[] = [];
  const prompts: string[] = [];
  const messages: unknown[] = [];
  let disposals = 0;
  class Loader {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
    async reload() {}
  }
  const sdk = {
    DefaultResourceLoader: Loader,
    SettingsManager: { inMemory: (settings: unknown) => ({ settings }) },
    SessionManager: { inMemory: (cwd: string) => ({ cwd }) },
    async createAgentSession(options: SessionOptions) {
      created.push(options);
      const handlers: Record<string, Handler[]> = {};
      const factories = options.resourceLoader.options
        .extensionFactories as Array<{
        factory(api: { on(name: string, handler: Handler): void }): void;
      }>;
      for (const extension of factories) {
        extension.factory({
          on(name: string, handler: Handler) {
            const namedHandlers = handlers[name] ?? [];
            namedHandlers.push(handler);
            handlers[name] = namedHandlers;
          },
        });
      }
      let listener: Handler | undefined;
      return {
        session: {
          model: sessionModel ?? options.model,
          subscribe(next: Handler) {
            listener = next;
            return () => {
              listener = undefined;
            };
          },
          async prompt(text: string) {
            prompts.push(text);
            for (const handler of handlers.before_agent_start ?? []) {
              const result = (await handler({ prompt: text })) as
                | { message?: unknown }
                | undefined;
              if (result?.message) messages.push(result.message);
            }
            listener?.({ type: "turn_start" });
            listener?.({
              type: "message_update",
              assistantMessageEvent: { type: "text_delta", delta: "Done" },
            });
          },
          async abort() {},
          getSessionStats() {
            return { tokens: { input: 12, output: 3 }, cost: 0.01 };
          },
          dispose() {
            disposals++;
          },
        },
      };
    },
  };
  return {
    sdk,
    created,
    prompts,
    messages,
    get disposals() {
      return disposals;
    },
  };
}

const armInput = {
  cwd: process.cwd(),
  emptyAgentDir: join(process.cwd(), ".empty-agent-for-mock"),
  model: { provider: "exact-provider", id: "exact-model" },
  modelRuntime: {},
  thinking: "medium",
  timeoutMs: 1000,
  originalRequest: "ORIGINAL_PROMPT_SENTINEL\nbyte-for-byte",
};

describe("Pi SDK implementation outcome flow", () => {
  test("accepts pnpm's leading argument separator for offline validation", () => {
    expect(parseArgs(["--", "validate", "--cases", casesPath])).toMatchObject({
      command: "validate",
      cases: casesPath,
    });
  });

  test("uses fresh identical sessions and injects exactly one hidden treatment message", async () => {
    const mock = mockSdk();
    const control = await executePiArm(
      { ...armInput, arm: "control", compiledText: undefined },
      mock.sdk,
    );
    const treatment = await executePiArm(
      { ...armInput, arm: "treatment", compiledText: "COMPILED_SENTINEL" },
      mock.sdk,
    );
    expect(mock.prompts).toEqual([
      armInput.originalRequest,
      armInput.originalRequest,
    ]);
    expect(mock.messages).toEqual([
      {
        customType: "intent-bridge.benchmark-task",
        content: "COMPILED_SENTINEL",
        display: false,
      },
    ]);
    expect(mock.created).toHaveLength(2);
    expect(mock.disposals).toBe(2);
    expect(mock.created.map((options) => options.model)).toEqual([
      armInput.model,
      armInput.model,
    ]);
    expect(mock.created.map((options) => options.thinkingLevel)).toEqual([
      "medium",
      "medium",
    ]);
    expect(mock.created.map((options) => options.tools)).toEqual([
      ["read", "bash", "edit", "write"],
      ["read", "bash", "edit", "write"],
    ]);
    for (const options of mock.created) {
      expect(options.resourceLoader.options).toMatchObject({
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      expect(options.sessionManager).toEqual({ cwd: process.cwd() });
      expect(options.settingsManager.settings).toEqual({
        compaction: { enabled: false },
        retry: { enabled: false },
      });
    }
    expect(control).toMatchObject({
      inputTokens: 12,
      outputTokens: 3,
      costUsd: 0.01,
    });
    expect(control).not.toHaveProperty("assistantText");
    expect(treatment).not.toHaveProperty("compiledText");
  });

  test("detects explicit clarification prose without treating code punctuation as a question", () => {
    expect(
      detectsClarification("Could you clarify which option you want?"),
    ).toBe(true);
    expect(detectsClarification("Hangisini uygulamamı istersiniz?")).toBe(true);
    expect(detectsClarification("Used value?.name and a ? b : c.")).toBe(false);
  });

  test("rejects model fallback and still disposes the fresh session", async () => {
    const mock = mockSdk({
      provider: "fallback-provider",
      id: "fallback-model",
    });
    await expect(
      executePiArm(
        { ...armInput, arm: "control", compiledText: undefined },
        mock.sdk,
      ),
    ).rejects.toThrow("INVALID_MODEL");
    expect(mock.disposals).toBe(1);
  });

  test("rejects missing live opt-in and attestation before any model lookup", async () => {
    delete process.env.INTENT_BRIDGE_LIVE_TESTS;
    const root = await mkdtemp(join(tmpdir(), "ib-preflight-"));
    let modelCalls = 0;
    await expect(
      runImplementationBenchmark(
        {
          command: "run",
          cases: casesPath,
          seed: "seed",
          thinking: "medium",
          "implementation-provider": "p",
          "implementation-model": "m",
          "bridge-provider": "bp",
          "bridge-model": "bm",
          attestation: join(root, "missing.json"),
          "fixture-root": root,
          out: join(root, "report.json"),
        },
        {
          modelRuntime: {
            async getAvailable() {
              modelCalls++;
              return [];
            },
          },
        },
      ),
    ).rejects.toThrow("INVALID_ISOLATION");
    expect(modelCalls).toBe(0);
  });

  test("offline validation checks all 12 deterministic fixture baselines", async () => {
    const result = await validateImplementationCorpus(casesPath);
    expect(result.cases).toBe(12);
    expect(result.validators).toBe(13);
    expect(result.corpusHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
