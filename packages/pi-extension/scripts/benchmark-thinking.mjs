#!/usr/bin/env node
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createPiProvider } from "../dist/pi-native-provider.js";

const fixture = {
  schemaVersion: "1",
  originalText:
    "Bir TypeScript fonksiyonundaki null kontrolünü düzelt; yalnızca gerekli değişikliği yap.",
  messageType: "initial",
  attachmentSummary: { imageCount: 0 },
  projectContext: { instructionExcerpts: [] },
  outputRequirements: {
    contentLanguage: "en",
    preserveResponseLanguage: true,
    strictSchema: true,
    implementationCodeForbidden: true,
  },
};
const levels = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

export function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--json") values.json = true;
    else if (["--provider", "--model", "--runs", "--on-level"].includes(arg))
      values[arg.slice(2)] = argv[++index];
    else throw new Error("CONFIG_INVALID");
  }
  const runs = values.runs === undefined ? 3 : Number(values.runs);
  if (
    !values.provider ||
    !values.model ||
    !Number.isInteger(runs) ||
    runs < 1 ||
    runs > 5 ||
    !levels.has(values["on-level"] ?? "medium")
  )
    throw new Error("CONFIG_INVALID");
  return {
    provider: values.provider,
    model: values.model,
    runs,
    onLevel: values["on-level"] ?? "medium",
    json: values.json === true,
  };
}
export function aggregate(samples) {
  const values = samples
    .filter((sample) => sample.success)
    .map((sample) => sample.latencyMs)
    .sort((a, b) => a - b);
  return values.length
    ? {
        min: values[0],
        median: values[Math.floor(values.length / 2)],
        max: values.at(-1),
      }
    : undefined;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch {
    console.error("CONFIG_INVALID");
    process.exitCode = 2;
    return;
  }
  const runtime = await ModelRuntime.create();
  const model = (await runtime.getAvailable()).find(
    (candidate) =>
      candidate.provider === args.provider && candidate.id === args.model,
  );
  if (!model || !model.reasoning || model.thinkingLevelMap?.off === null) {
    console.error("CONFIG_INVALID");
    process.exitCode = 2;
    return;
  }
  const samples = [];
  for (let index = 0; index < args.runs * 2; index += 1) {
    const mode = index % 2 === 0 ? "off" : args.onLevel;
    const started = Date.now();
    try {
      await createPiProvider(runtime, model, mode).interpret(fixture, {});
      samples.push({ mode, success: true, latencyMs: Date.now() - started });
    } catch (error) {
      samples.push({
        mode,
        success: false,
        code:
          error?.code === "PROVIDER_TIMEOUT"
            ? "PROVIDER_TIMEOUT"
            : "PROVIDER_UNREACHABLE",
      });
    }
  }
  const off = aggregate(samples.filter((sample) => sample.mode === "off"));
  const on = aggregate(
    samples.filter((sample) => sample.mode === args.onLevel),
  );
  const report = {
    provider: args.provider,
    model: args.model,
    samples,
    off,
    on,
    ...(off && on
      ? { deltaMs: on.median - off.median, speedup: on.median / off.median }
      : {}),
  };
  if (args.json) console.log(JSON.stringify(report));
  else {
    for (const sample of samples)
      console.log(
        JSON.stringify({
          provider: args.provider,
          model: args.model,
          ...sample,
        }),
      );
    console.log(
      JSON.stringify({
        provider: report.provider,
        model: report.model,
        off,
        on,
        deltaMs: report.deltaMs,
        speedup: report.speedup,
      }),
    );
  }
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
