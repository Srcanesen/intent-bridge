#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  createImplementationOutcomeReport,
  deterministicImplementationOrders,
  implementationCorpusHash,
  inspectImplementationOutcome,
  loadImplementationCases,
  materializeImplementationFixture,
  requireIsolationPreflight,
  runTrustedArgv,
  writeImplementationOutcomeReport,
} from "../../benchmark/dist/index.js";
import {
  DEFAULT_QUALITY_CONFIG,
  InterpretationPipeline,
  PiCompilerV1,
} from "../../core/dist/index.js";
import {
  createPiProvider,
  PI_NATIVE_PROMPT_VERSION,
} from "../dist/pi-native-provider.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(dirname(scriptDir)));
const defaultCases = join(
  repoRoot,
  "benchmarks",
  "implementation-outcome",
  "cases.json",
);
const tools = ["read", "bash", "edit", "write"];
const piPackageVersion = JSON.parse(
  readFileSync(
    join(
      dirname(
        fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
      ),
      "../package.json",
    ),
    "utf8",
  ),
).version;
const thinkingValues = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const nonnegative = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

export function detectsClarification(text) {
  return [
    /\b(?:clarif(?:y|ication)|could you|please specify|what should|which (?:option|behavior|change))\b/i,
    /\b(?:netleştir|açıklar mısın|hangisini|nasıl ilerlememi|ne yapmamı)\b/i,
    /\b(?:podrías|aclare|aclarar|cuál (?:opción|comportamiento|cambio))\b/i,
  ].some((pattern) => pattern.test(text));
}

export function parseArgs(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const command = args[0];
  if (!command || !["validate", "run"].includes(command))
    throw new Error("CONFIG_INVALID");
  const result = {
    command,
    cases: defaultCases,
    seed: "ib-06-v1",
    thinking: "medium",
  };
  for (let index = 1; index < args.length; index++) {
    const name = args[index];
    if (!name?.startsWith("--")) throw new Error("CONFIG_INVALID");
    const key = name.slice(2);
    if (
      ![
        "cases",
        "seed",
        "thinking",
        "implementation-provider",
        "implementation-model",
        "bridge-provider",
        "bridge-model",
        "attestation",
        "fixture-root",
        "out",
      ].includes(key)
    )
      throw new Error("CONFIG_INVALID");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("CONFIG_INVALID");
    result[key] = value;
  }
  if (!thinkingValues.includes(result.thinking))
    throw new Error("CONFIG_INVALID");
  if (
    command === "run" &&
    [
      "implementation-provider",
      "implementation-model",
      "bridge-provider",
      "bridge-model",
      "attestation",
      "fixture-root",
      "out",
    ].some((key) => !result[key])
  )
    throw new Error("CONFIG_INVALID");
  return result;
}

export async function validateImplementationCorpus(casesPath = defaultCases) {
  const cases = await loadImplementationCases(casesPath);
  const corpusRoot = dirname(await realpath(casesPath));
  let validators = 0;
  for (const caseItem of cases) {
    const first = await materializeImplementationFixture({
      caseItem,
      corpusRoot,
    });
    const second = await materializeImplementationFixture({
      caseItem,
      corpusRoot,
    });
    try {
      if (first.revision !== second.revision || first.tree !== second.tree)
        throw new Error("INVALID_BASELINE");
      for (const argv of caseItem.validators) {
        validators++;
        if (!(await runTrustedArgv(first.cwd, argv, caseItem.timeoutMs)))
          throw new Error("INVALID_FIXTURE");
      }
    } finally {
      await Promise.all([first.dispose(), second.dispose()]);
    }
  }
  return {
    cases: cases.length,
    validators,
    corpusHash: implementationCorpusHash(cases),
  };
}

function safetyExtension({ arm, compiledText, stats, cwd }) {
  return {
    name: "implementation-outcome-safety",
    factory(pi) {
      if (arm === "treatment") {
        pi.on("before_agent_start", () => ({
          message: {
            customType: "intent-bridge.benchmark-task",
            content: compiledText,
            display: false,
          },
        }));
      }
      pi.on("tool_call", (event) => {
        stats.toolCalls++;
        const serialized = JSON.stringify(event.input);
        const mutation =
          event.toolName === "edit" || event.toolName === "write";
        if (mutation) {
          const path =
            typeof event.input?.path === "string" ? event.input.path : "";
          if (stats.mutated.has(path)) stats.repeatedMutations++;
          stats.mutated.add(path);
        }
        let category;
        if (/\b(?:curl|wget|nc|ssh|scp)\b|https?:\/\//i.test(serialized))
          category = "network";
        else if (
          /\brm\s+-rf\b|git\s+(?:reset\s+--hard|clean\s+-f)|\bshutdown\b/i.test(
            serialized,
          )
        )
          category = "destructive";
        else {
          const candidate =
            typeof event.input?.path === "string"
              ? event.input.path
              : undefined;
          const target =
            candidate === undefined ? undefined : resolve(cwd, candidate);
          const targetRelative =
            target === undefined ? "" : relative(cwd, target);
          if (
            (target !== undefined &&
              (targetRelative.startsWith("..") ||
                isAbsolute(targetRelative))) ||
            /\.\.(?:\/|\\)/.test(serialized)
          )
            category = "boundary";
        }
        if (category) {
          stats.blockedSafety[category]++;
          return {
            block: true,
            reason: "Blocked by benchmark defense-in-depth policy",
          };
        }
      });
    },
  };
}

export async function executePiArm(
  input,
  sdk = {
    createAgentSession,
    DefaultResourceLoader,
    SessionManager,
    SettingsManager,
  },
) {
  if (piPackageVersion !== "0.80.10") throw new Error("INVALID_MODEL");
  const stats = {
    turns: 0,
    toolCalls: 0,
    repeatedMutations: 0,
    mutated: new Set(),
    blockedSafety: { boundary: 0, network: 0, destructive: 0 },
    assistantText: "",
  };
  const settingsManager = sdk.SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.emptyAgentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      safetyExtension({
        arm: input.arm,
        compiledText: input.compiledText,
        stats,
        cwd: input.cwd,
      }),
    ],
  });
  await resourceLoader.reload();
  const created = await sdk.createAgentSession({
    cwd: input.cwd,
    model: input.model,
    modelRuntime: input.modelRuntime,
    thinkingLevel: input.thinking,
    tools,
    resourceLoader,
    sessionManager: sdk.SessionManager.inMemory(input.cwd),
    settingsManager,
  });
  const session = created.session;
  if (
    created.modelFallbackMessage ||
    session.model?.provider !== input.model.provider ||
    session.model?.id !== input.model.id
  ) {
    session.dispose();
    throw new Error("INVALID_MODEL");
  }
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "turn_start") stats.turns++;
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta" &&
      stats.assistantText.length < 8000
    )
      stats.assistantText += event.assistantMessageEvent.delta;
  });
  const started = Date.now();
  let modelFailed;
  let sessionUsage = { inputTokens: null, outputTokens: null, costUsd: null };
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(async () => {
      await session.abort().catch(() => {});
      reject(new Error("MODEL_TIMEOUT"));
    }, input.timeoutMs);
    timeoutId.unref?.();
  });
  try {
    await Promise.race([
      session.prompt(input.originalRequest, { expandPromptTemplates: false }),
      timeout,
    ]);
  } catch (error) {
    modelFailed =
      error?.message === "MODEL_TIMEOUT" ? "MODEL_TIMEOUT" : "MODEL_FAILED";
  } finally {
    clearTimeout(timeoutId);
    try {
      const value = session.getSessionStats?.();
      sessionUsage = {
        inputTokens: nonnegative(value?.tokens?.input),
        outputTokens: nonnegative(value?.tokens?.output),
        costUsd: nonnegative(value?.cost),
      };
    } catch {
      // Statistics are optional evidence; never fail or expose session content.
    }
    unsubscribe();
    session.dispose();
  }
  return {
    implementationLatencyMs: Date.now() - started,
    observedClarification: detectsClarification(stats.assistantText),
    turns: stats.turns,
    toolCalls: stats.toolCalls,
    repeatedMutations: stats.repeatedMutations,
    ...sessionUsage,
    blockedSafety: stats.blockedSafety,
    modelFailed,
  };
}

async function exactModel(runtime, provider, id) {
  const available = await runtime.getAvailable();
  const matches = available.filter(
    (model) => model.provider === provider && model.id === id,
  );
  if (matches.length !== 1) throw new Error("INVALID_MODEL");
  return matches[0];
}

async function compileTreatment({ caseItem, runtime, bridgeModel }) {
  const started = Date.now();
  const provider = createPiProvider(runtime, bridgeModel, { reasoning: "off" });
  const pipeline = new InterpretationPipeline(
    provider,
    new PiCompilerV1(),
    undefined,
  );
  const result = await pipeline.run(
    {
      traceId: sha256(caseItem.id).slice(0, 32),
      receivedAt: "2000-01-01T00:00:00.000Z",
      harness: "pi",
      messageType: "initial",
      source: "rpc",
      originalText: caseItem.originalRequest,
      attachmentSummary: { imageCount: 0 },
      project: { instructionExcerpts: [] },
    },
    {
      logging: { mode: "off", retentionDays: 1 },
      quality: DEFAULT_QUALITY_CONFIG,
      signal: undefined,
    },
  );
  if (result.status !== "transformed") throw new Error("MODEL_FAILED");
  return { text: result.compiledTask, latencyMs: Date.now() - started };
}

export async function runImplementationBenchmark(config, dependencies = {}) {
  if (piPackageVersion !== "0.80.10") throw new Error("INVALID_MODEL");
  const casesPath = await realpath(config.cases);
  const fixtureRoot = await realpath(config["fixture-root"]);
  const attestation = await requireIsolationPreflight({
    liveOptIn: process.env.INTENT_BRIDGE_LIVE_TESTS,
    attestationPath: config.attestation,
    fixtureRoot,
  });
  const out = resolve(config.out);
  const outParent = await realpath(dirname(out)).catch(() => {
    throw new Error("INVALID_ISOLATION");
  });
  const outRelative = relative(fixtureRoot, out);
  const parentRelative = relative(fixtureRoot, outParent);
  if (
    outRelative.startsWith("..") ||
    isAbsolute(outRelative) ||
    parentRelative.startsWith("..") ||
    isAbsolute(parentRelative)
  )
    throw new Error("INVALID_ISOLATION");
  const cases = await loadImplementationCases(casesPath);
  const corpusRoot = dirname(casesPath);
  for (const caseItem of cases) {
    const fixture = await materializeImplementationFixture({
      caseItem,
      corpusRoot,
      temporaryRoot: fixtureRoot,
    });
    try {
      for (const argv of caseItem.validators)
        if (!(await runTrustedArgv(fixture.cwd, argv, caseItem.timeoutMs)))
          throw new Error("INVALID_FIXTURE");
    } finally {
      await fixture.dispose();
    }
  }
  const runtime = dependencies.modelRuntime ?? (await ModelRuntime.create());
  const implementationModel = await exactModel(
    runtime,
    config["implementation-provider"],
    config["implementation-model"],
  );
  const bridgeModel = await exactModel(
    runtime,
    config["bridge-provider"],
    config["bridge-model"],
  );
  const orders = deterministicImplementationOrders(cases, config.seed);
  const runConfigHash = sha256(
    JSON.stringify({
      implementationProvider: implementationModel.provider,
      implementationModel: implementationModel.id,
      bridgeProvider: bridgeModel.provider,
      bridgeModel: bridgeModel.id,
      thinking: config.thinking,
      tools,
      timeoutPolicy: "case-v1",
    }),
  );
  const pairs = [];
  for (const caseItem of cases) {
    const compiled = await compileTreatment({ caseItem, runtime, bridgeModel });
    const order = orders.get(caseItem.id);
    const arms = [];
    for (let index = 0; index < order.length; index++) {
      const arm = order[index];
      const fixture = await materializeImplementationFixture({
        caseItem,
        corpusRoot,
        temporaryRoot: fixtureRoot,
      });
      const emptyAgentDir = join(dirname(fixture.cwd), "empty-agent");
      await mkdir(emptyAgentDir, { recursive: true });
      try {
        const execution = await (dependencies.executePiArm ?? executePiArm)({
          arm,
          cwd: fixture.cwd,
          emptyAgentDir,
          model: implementationModel,
          modelRuntime: runtime,
          thinking: config.thinking,
          timeoutMs: caseItem.timeoutMs,
          originalRequest: caseItem.originalRequest,
          compiledText: arm === "treatment" ? compiled.text : undefined,
        });
        arms.push(
          await inspectImplementationOutcome({
            caseItem,
            cwd: fixture.cwd,
            arm,
            order: index,
            fixtureRevision: fixture.revision,
            fixtureTree: fixture.tree,
            implementationLatencyMs: execution.implementationLatencyMs,
            treatmentCompilationLatencyMs:
              arm === "treatment" ? compiled.latencyMs : null,
            observedClarification: execution.observedClarification,
            turns: execution.turns,
            toolCalls: execution.toolCalls,
            repeatedMutations: execution.repeatedMutations,
            inputTokens: execution.inputTokens ?? null,
            outputTokens: execution.outputTokens ?? null,
            costUsd: execution.costUsd ?? null,
            blockedSafety: execution.blockedSafety,
            modelFailed: execution.modelFailed,
          }),
        );
      } finally {
        await fixture.dispose();
      }
    }
    pairs.push({
      caseId: caseItem.id,
      configHash: runConfigHash,
      fixtureRevision: arms[0].fixtureRevision,
      fixtureTree: arms[0].fixtureTree,
      order,
      arms,
    });
  }
  const report = createImplementationOutcomeReport({
    runConfigHash,
    pi: {
      packageVersion: "0.80.10",
      provider: implementationModel.provider,
      model: implementationModel.id,
      thinking: config.thinking,
    },
    bridge: {
      provider: bridgeModel.provider,
      model: bridgeModel.id,
      schemaVersion: "2",
      promptVersion: PI_NATIVE_PROMPT_VERSION,
      compilerVersion: "pi-v2",
      policyVersion: "implementation-outcome-policy-v1",
    },
    corpusHash: implementationCorpusHash(cases),
    seed: config.seed,
    policyHash: attestation.policyHash,
    pairs,
  });
  await writeImplementationOutcomeReport(out, report);
  return report.aggregates;
}

export async function main(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  if (config.command === "validate") {
    const result = await validateImplementationCorpus(config.cases);
    console.log(
      JSON.stringify({
        status: "valid",
        cases: result.cases,
        validators: result.validators,
        corpusHash: result.corpusHash,
      }),
    );
    return;
  }
  const aggregates = await runImplementationBenchmark(config);
  console.log(JSON.stringify({ status: "completed", aggregates }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const code = [
      "INVALID_ISOLATION",
      "INVALID_MODEL",
      "INVALID_BASELINE",
      "INVALID_FIXTURE",
      "INVALID_CASE",
      "INVALID_REPORT",
      "CONFIG_INVALID",
    ].includes(error?.message)
      ? error.message
      : "BENCHMARK_FAILED";
    console.error(code);
    process.exitCode = 1;
  });
}
