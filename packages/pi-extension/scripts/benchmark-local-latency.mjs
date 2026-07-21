#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  IntentDocumentV2JsonSchema,
  PiCompilerV1,
  collectProjectContext,
  loadLayeredConfig,
  loadPiModelSelection,
  parseIntentDocumentV2,
  resolveConfigPaths,
} from "@intent-bridge/core";
import { loadBenchmarkCases } from "../../benchmark/dist/index.js";

import { createPiProvider } from "../dist/pi-native-provider.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(dirname(scriptDir)));
const defaultCasesDir = join(repoRoot, "benchmarks", "cases");

export function byteLength(value) {
  return Buffer.byteLength(
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

export async function durations(runs, operation) {
  if (!Number.isInteger(runs) || runs < 1) throw new Error("CONFIG_INVALID");
  const values = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    await operation();
    values.push(performance.now() - started);
  }
  values.sort((a, b) => a - b);
  const at = (ratio) =>
    values[Math.min(values.length - 1, Math.floor(values.length * ratio))];
  return {
    medianMs: Number(at(0.5).toFixed(3)),
    p95Ms: Number(at(0.95).toFixed(3)),
    minMs: Number(values[0].toFixed(3)),
    maxMs: Number(values.at(-1).toFixed(3)),
  };
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg || arg === "--") continue;
    if (!arg.startsWith("--")) throw new Error("CONFIG_INVALID");
    const key = arg.slice(2);
    if (["out", "cases", "corpus-passes", "config-runs"].includes(key)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--"))
        throw new Error("CONFIG_INVALID");
      out[key] = value;
    } else throw new Error("CONFIG_INVALID");
  }
  if (out["config-runs"] !== undefined) {
    const n = Number(out["config-runs"]);
    if (!Number.isInteger(n) || n < 1 || n > 1000)
      throw new Error("CONFIG_INVALID");
    out["config-runs"] = n;
  }
  if (out["corpus-passes"] !== undefined) {
    const n = Number(out["corpus-passes"]);
    if (!Number.isInteger(n) || n < 1 || n > 1000)
      throw new Error("CONFIG_INVALID");
    out["corpus-passes"] = n;
  }
  return out;
}

const contextOptions = {
  cwd: repoRoot,
  projectTrusted: true,
  config: { enabled: true, maxCharacters: 12000, maxFileCharacters: 6000 },
  configDirName: ".pi",
};

const configOptions = {
  projectRoot: repoRoot,
  configDirName: ".pi",
  projectTrusted: true,
  environment: process.env,
};

const validIntent = {
  schemaVersion: "2",
  sourceLanguage: { code: "tr", confidence: 1 },
  responseLanguage: { code: "tr", source: "source_language_default" },
  messageType: "initial",
  goal: "Test",
  tasks: [
    {
      id: "test",
      objective: "Test",
      scope: [],
      constraints: [],
      successCriteria: [],
    },
  ],
  globalConstraints: [],
  assumptions: [],
  ambiguities: [],
  risk: { level: "low", reasons: [] },
  confidence: 1,
  clarification: { recommended: false },
};

const validGroundedEnvelope = {
  version: 1,
  groundedIntent: {
    ...validIntent,
    goal: {
      value: validIntent.goal,
      evidence: { source: "user_original", quote: "synthetic request" },
    },
    tasks: validIntent.tasks.map((task) => ({
      ...task,
      objective: {
        value: task.objective,
        evidence: { source: "user_original", quote: "synthetic request" },
      },
      scope: [],
      constraints: [],
      successCriteria: [],
    })),
    globalConstraints: [],
  },
};

export async function collectBaseline({
  configRuns = 100,
  corpusPasses = 100,
  casesDir = defaultCasesDir,
} = {}) {
  const selectionPath = join(
    dirname(resolveConfigPaths({ environment: process.env }).globalPath),
    "pi-model-selection.json",
  );
  const contextResult = await collectProjectContext(contextOptions);
  const configTiming = await durations(configRuns, () =>
    loadLayeredConfig(configOptions),
  );
  const selectionTiming = await durations(configRuns, () =>
    loadPiModelSelection(selectionPath),
  );
  const contextTiming = await durations(configRuns, () =>
    collectProjectContext(contextOptions),
  );
  const sequentialTiming = await durations(configRuns, async () => {
    const config = await loadLayeredConfig(configOptions);
    await loadPiModelSelection(selectionPath);
    await collectProjectContext({ ...contextOptions, config: config.context });
  });
  const parallelCandidateTiming = await durations(configRuns, async () => {
    const config = await loadLayeredConfig(configOptions);
    await Promise.all([
      loadPiModelSelection(selectionPath),
      collectProjectContext({ ...contextOptions, config: config.context }),
    ]);
  });

  let nativeCall;
  await createPiProvider(
    {
      completeSimple: async (_model, context, options) => {
        nativeCall = { context, options };
        return {
          stopReason: "toolUse",
          content: [
            {
              type: "toolCall",
              name: "emit_grounded_intent",
              arguments: validGroundedEnvelope,
            },
          ],
        };
      },
    },
    {
      id: "measure",
      name: "Measure",
      provider: "local",
      input: ["text"],
      contextWindow: 100000,
      maxTokens: 9000,
    },
  ).interpret(
    {
      schemaVersion: "2",
      originalText: "synthetic request",
      messageType: "initial",
      attachmentSummary: { imageCount: 0 },
      projectContext: { instructionExcerpts: [] },
      outputRequirements: {
        contentLanguage: "en",
        preserveResponseLanguage: true,
        strictSchema: true,
        implementationCodeForbidden: true,
      },
    },
    {},
  );
  if (!nativeCall) throw new Error("CONFIG_INVALID");

  const cases = await loadBenchmarkCases(casesDir);
  const documents = cases.map((item) => ({
    ...validIntent,
    sourceLanguage: { code: item.language, confidence: 1 },
    responseLanguage: {
      code: item.expected.responseLanguage,
      source:
        item.expected.responseLanguage === item.language
          ? "source_language_default"
          : "user_explicit",
    },
    messageType: item.messageType,
    goal: item.expected.requiredGoalConcepts[0] ?? item.title,
    tasks: [
      {
        id: "task",
        objective: item.expected.requiredGoalConcepts[0] ?? item.title,
        scope: [],
        constraints: item.expected.requiredConstraints,
        successCriteria: [],
      },
    ],
    globalConstraints: item.expected.requiredConstraints,
  }));
  const compiler = new PiCompilerV1();
  const parseTiming = await durations(corpusPasses, () => {
    for (const [index, document] of documents.entries()) {
      parseIntentDocumentV2(document, {
        expectedMessageType: cases[index].messageType,
      });
    }
  });
  const compilerTiming = await durations(corpusPasses, () => {
    for (const [index, intent] of documents.entries()) {
      compiler.compile({
        intent,
        originalText: cases[index].input,
        attachmentSummary: {
          imageCount: cases[index].attachments?.imageCount ?? 0,
        },
      });
    }
  });
  const caseCount = cases.length || 1;

  return {
    runs: { config: configRuns, corpusPasses, corpusCases: cases.length },
    promptBytes: {
      nativeSystem: byteLength(nativeCall.context.systemPrompt),
      canonicalSchema: byteLength(IntentDocumentV2JsonSchema),
      nativeToolSchema: byteLength(nativeCall.context.tools),
    },
    context: {
      includedFiles: contextResult.manifest.entries.filter((e) => e.included)
        .length,
      excludedFiles: contextResult.manifest.entries.filter((e) => !e.included)
        .length,
      totalCharacters: contextResult.manifest.totalCharacters,
    },
    configTiming,
    selectionTiming,
    contextTiming,
    localPreparation: {
      sequential: sequentialTiming,
      parallelCandidate: parallelCandidateTiming,
    },
    corpusCpu: {
      parseTotal: parseTiming,
      compileTotal: compilerTiming,
      parsePerCaseMedianMs: Number(
        (parseTiming.medianMs / caseCount).toFixed(4),
      ),
      compilePerCaseMedianMs: Number(
        (compilerTiming.medianMs / caseCount).toFixed(4),
      ),
    },
    nativeOptions: {
      reasoning: nativeCall.options.reasoning,
      maxTokens: nativeCall.options.maxTokens,
      maxRetries: nativeCall.options.maxRetries,
      cacheRetention: nativeCall.options.cacheRetention,
    },
  };
}

export function renderReport(report) {
  return JSON.stringify(report, null, 2);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch {
    process.stderr.write("CONFIG_INVALID\n");
    process.exit(2);
    return;
  }
  const report = await collectBaseline({
    configRuns: args["config-runs"],
    corpusPasses: args["corpus-passes"],
    casesDir: args.cases ? resolve(repoRoot, args.cases) : defaultCasesDir,
  });
  const out = renderReport(report);
  if (args.out) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(args.out, `${out}\n`);
  } else process.stdout.write(`${out}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
