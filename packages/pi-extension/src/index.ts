import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  collectProjectContext,
  JsonlTraceWriter,
  loadLayeredConfig,
  resolveConfigPaths,
  type IntentProvider,
  type ProviderProfileV1,
  type updateBridgeConfigLayerAtomic,
} from "@intent-bridge/core";
import { OpenAICompatibleProvider } from "@intent-bridge/provider-openai-compatible";

import { createBridgeCommand } from "./bridge-command.js";
import type { PiModel, PiModelRegistry } from "./pi-model-provider.js";
import {
  createPiProvider,
  type PiNativeProviderOptions,
} from "./pi-native-provider.js";
import { createProviderResolver } from "./provider-resolution.js";
import { createTransformationController } from "./transformation-controller.js";

export interface BridgeDependencies {
  environment?: NodeJS.ProcessEnv;
  uuid?: () => string;
  now?: () => Date;
  loadConfig?: typeof loadLayeredConfig;
  collectContext?: typeof collectProjectContext;
  /** Explicit legacy Bridge profiles only. */
  createProvider?: (
    profile: ProviderProfileV1,
    environment?: (name: string) => string | undefined,
  ) => IntentProvider;
  createPiProvider?: (
    registry: PiModelRegistry,
    model: PiModel,
    options?: PiNativeProviderOptions,
  ) => IntentProvider;
  createTraceWriter?: (logsDir: string) => JsonlTraceWriter;
  updateConfig?: typeof updateBridgeConfigLayerAtomic;
}

export function createIntentBridgeExtension(
  pi: ExtensionAPI,
  dependencies: BridgeDependencies = {},
): void {
  const environment = dependencies.environment ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  const loadConfig = dependencies.loadConfig ?? loadLayeredConfig;
  const collectContext = dependencies.collectContext ?? collectProjectContext;
  const globalDir = dirname(resolveConfigPaths({ environment }).globalPath);
  const selectionPath = join(globalDir, "pi-model-selection.json");
  const traceWriter = (
    dependencies.createTraceWriter ??
    ((path) => new JsonlTraceWriter(path, now))
  )(join(globalDir, "logs"));
  let runtimeFallbackReported = false;
  const capabilityDiagnostic: NonNullable<
    PiNativeProviderOptions["capabilityDiagnostic"]
  > = (metadata) => {
    if (
      metadata.capabilitySource !== "runtime_fallback" ||
      runtimeFallbackReported
    )
      return;
    runtimeFallbackReported = true;
    try {
      pi.appendEntry("intent-bridge.pi-host", metadata);
    } catch {}
  };
  const resolver = createProviderResolver({
    environment,
    selectionPath,
    createProvider:
      dependencies.createProvider ??
      ((profile, resolver) =>
        new OpenAICompatibleProvider(profile, {
          environment: resolver ?? ((name) => environment[name]),
        })),
    createPiProvider: dependencies.createPiProvider ?? createPiProvider,
    capabilityDiagnostic,
  });
  const getConfig = (ctx: { cwd: string; isProjectTrusted(): boolean }) =>
    loadConfig({
      projectRoot: ctx.cwd,
      configDirName: CONFIG_DIR_NAME,
      projectTrusted: ctx.isProjectTrusted(),
      environment,
    });
  const controller = createTransformationController({
    pi,
    getConfig,
    collectContext,
    resolver,
    traceWriter,
    uuid: dependencies.uuid ?? randomUUID,
    now,
  });

  pi.on("input", (event, ctx) => controller.handleInput(event, ctx));
  pi.on("before_agent_start", (event) => controller.beforeAgentStart(event));
  pi.on("session_start", (_event, ctx) => controller.sessionStart(ctx));
  pi.on("session_before_switch", () => controller.clearPending());
  pi.on("session_shutdown", () => controller.shutdown());
  pi.registerCommand(
    "bridge",
    createBridgeCommand({
      environment,
      getConfig,
      collectContext,
      ...(dependencies.updateConfig
        ? { updateConfig: dependencies.updateConfig }
        : {}),
      resolver,
      controller,
    }),
  );
}

export default function intentBridgeExtension(pi: ExtensionAPI): void {
  createIntentBridgeExtension(pi);
}
