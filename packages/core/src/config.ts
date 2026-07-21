import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { ProviderProfileV1, RetryPolicyV1 } from "./contracts.js";
import { BridgeError } from "./errors.js";
import {
  DEFAULT_QUALITY_CONFIG,
  type QualityConfigV1,
  type QualityEnforcementMode,
} from "./quality-policy.js";

export interface PiModelSelectionV1 {
  version: 1;
  provider: string;
  model: string;
}

export interface ContextConfigV1 {
  enabled: boolean;
  maxCharacters: number;
  maxFileCharacters: number;
}
export interface LoggingConfigV1 {
  mode: "metadata" | "full" | "off";
  retentionDays: number;
}
export type { QualityConfigV1 } from "./quality-policy.js";
export interface BridgeConfigV1 {
  version: 1;
  enabled: boolean;
  mode: "auto" | "preview" | "off";
  activeProfile: string;
  profiles: Record<string, ProviderProfileV1>;
  context: ContextConfigV1;
  logging: LoggingConfigV1;
  quality: QualityConfigV1;
  retry: RetryPolicyV1;
}
export type BridgeConfigLayer = {
  version?: 1;
  enabled?: boolean;
  mode?: BridgeConfigV1["mode"];
  activeProfile?: string;
  profiles?: Record<string, Partial<ProviderProfileV1>>;
  context?: Partial<ContextConfigV1>;
  logging?: Partial<LoggingConfigV1>;
  quality?: Partial<QualityConfigV1>;
  retry?: Partial<RetryPolicyV1>;
};
export type BridgeConfigPatch = Pick<
  BridgeConfigLayer,
  "enabled" | "mode" | "activeProfile" | "profiles"
>;

export const DEFAULT_BRIDGE_CONFIG: BridgeConfigV1 = {
  version: 1,
  enabled: false,
  mode: "auto",
  activeProfile: "",
  profiles: {},
  context: { enabled: true, maxCharacters: 12000, maxFileCharacters: 6000 },
  logging: { mode: "metadata", retentionDays: 30 },
  quality: { ...DEFAULT_QUALITY_CONFIG },
  retry: { maxRetries: 1, baseDelayMs: 250, totalBudgetMs: 45000 },
};

function invalid(message = "The bridge configuration is invalid."): never {
  throw new BridgeError({
    code: "CONFIG_INVALID",
    safeMessage: message,
    retryable: false,
  });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function string(value: unknown): string {
  if (typeof value !== "string") invalid();
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}
function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    invalid();
  return value;
}
function boundedPositive(value: unknown, maximum: number): number {
  const parsed = positive(value);
  if (parsed > maximum) invalid();
  return parsed;
}
function retry(value: unknown): RetryPolicyV1 {
  const policy = object(value);
  exact(policy, ["maxRetries", "baseDelayMs", "totalBudgetMs"]);
  const maxRetries = policy.maxRetries;
  if (
    typeof maxRetries !== "number" ||
    !Number.isSafeInteger(maxRetries) ||
    maxRetries < 0 ||
    maxRetries > 2
  )
    invalid();
  return {
    maxRetries,
    baseDelayMs: boundedPositive(policy.baseDelayMs, 10_000),
    totalBudgetMs: boundedPositive(policy.totalBudgetMs, 120_000),
  };
}
function qualityConfidence(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    invalid();
  return value;
}
function qualityConfig(value: unknown): QualityConfigV1 {
  const policy = object(value);
  exact(policy, [
    "enforcement",
    "reviewOnHighRisk",
    "reviewOnClarification",
    "reviewOnMaterialAskUser",
    "minConfidence",
    "noUiAction",
  ]);
  const result: QualityConfigV1 = { ...DEFAULT_QUALITY_CONFIG };
  if (policy.enforcement !== undefined) {
    const enforcement = string(policy.enforcement);
    if (enforcement !== "observe" && enforcement !== "review") invalid();
    result.enforcement = enforcement as QualityEnforcementMode;
  }
  if (policy.reviewOnHighRisk !== undefined)
    result.reviewOnHighRisk = bool(policy.reviewOnHighRisk);
  if (policy.reviewOnClarification !== undefined)
    result.reviewOnClarification = bool(policy.reviewOnClarification);
  if (policy.reviewOnMaterialAskUser !== undefined)
    result.reviewOnMaterialAskUser = bool(policy.reviewOnMaterialAskUser);
  if (policy.minConfidence !== undefined)
    result.minConfidence = qualityConfidence(policy.minConfidence);
  if (policy.noUiAction !== undefined) {
    const noUiAction = string(policy.noUiAction);
    if (noUiAction !== "send_original") invalid();
    result.noUiAction = "send_original";
  }
  return result;
}
const secretPattern =
  /(?:sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|token|secret)\s*[:=]\s*['"]?[^\s'"]{8,}|https?:\/\/[^/\s:@]+:[^@\s]+@)/i;
function noInlineSecret(value: string): string {
  if (secretPattern.test(value))
    invalid("The bridge configuration contains an inline secret.");
  return value;
}
function profile(value: unknown): ProviderProfileV1 {
  const p = object(value);
  exact(p, [
    "id",
    "protocol",
    "baseUrl",
    "model",
    "apiKeyEnv",
    "timeoutMs",
    "maxOutputTokens",
    "temperature",
    "capabilities",
    "headers",
    "pricing",
  ]);
  if (p.protocol !== "openai-compatible") invalid();
  const capabilities = object(p.capabilities);
  exact(capabilities, ["structuredOutput", "usageMetadata", "supportsSeed"]);
  if (
    !["json_schema", "json_object", "prompt_only"].includes(
      string(capabilities.structuredOutput),
    ) ||
    typeof capabilities.usageMetadata !== "boolean" ||
    typeof capabilities.supportsSeed !== "boolean"
  )
    invalid();
  const result: ProviderProfileV1 = {
    id: noInlineSecret(string(p.id)),
    protocol: "openai-compatible",
    baseUrl: noInlineSecret(string(p.baseUrl)),
    model: noInlineSecret(string(p.model)),
    apiKeyEnv: noInlineSecret(string(p.apiKeyEnv)),
    timeoutMs: positive(p.timeoutMs),
    maxOutputTokens: positive(p.maxOutputTokens),
    capabilities: capabilities as unknown as ProviderProfileV1["capabilities"],
  };
  if (p.temperature !== undefined) {
    if (
      typeof p.temperature !== "number" ||
      p.temperature < 0 ||
      p.temperature > 2
    )
      invalid();
    result.temperature = p.temperature;
  }
  if (p.headers !== undefined) {
    const headers = object(p.headers);
    for (const [key, entry] of Object.entries(headers)) {
      if (typeof entry !== "string") invalid();
      noInlineSecret(key);
      noInlineSecret(entry);
    }
    result.headers = headers as Record<string, string>;
  }
  if (p.pricing !== undefined) {
    const pricing = object(p.pricing);
    exact(pricing, ["currency", "inputPerMillion", "outputPerMillion"]);
    if (pricing.currency !== "USD") invalid();
    for (const key of ["inputPerMillion", "outputPerMillion"])
      if (
        pricing[key] !== undefined &&
        (typeof pricing[key] !== "number" || pricing[key] < 0)
      )
        invalid();
    result.pricing = pricing as unknown as NonNullable<
      ProviderProfileV1["pricing"]
    >;
  }
  return result;
}
export function parseBridgeConfig(value: unknown): BridgeConfigV1 {
  const c = object(value);
  exact(c, [
    "version",
    "enabled",
    "mode",
    "activeProfile",
    "profiles",
    "context",
    "logging",
    "quality",
    "retry",
  ]);
  if (c.version !== 1) invalid();
  if (!["auto", "preview", "off"].includes(string(c.mode))) invalid();
  const context = object(c.context);
  exact(context, ["enabled", "maxCharacters", "maxFileCharacters"]);
  const logging = object(c.logging);
  exact(logging, ["mode", "retentionDays"]);
  if (!["metadata", "full", "off"].includes(string(logging.mode))) invalid();
  const quality = object(c.quality);
  exact(quality, [
    "enforcement",
    "reviewOnHighRisk",
    "reviewOnClarification",
    "reviewOnMaterialAskUser",
    "minConfidence",
    "noUiAction",
  ]);
  const parsedQuality = qualityConfig(quality);
  const profiles = object(c.profiles);
  const parsedProfiles = Object.fromEntries(
    Object.entries(profiles).map(([id, p]) => {
      const parsed = profile(p);
      if (parsed.id !== id) invalid();
      return [id, parsed];
    }),
  );
  const result: BridgeConfigV1 = {
    version: 1,
    enabled: bool(c.enabled),
    mode: c.mode as BridgeConfigV1["mode"],
    activeProfile: string(c.activeProfile),
    profiles: parsedProfiles,
    context: {
      enabled: bool(context.enabled),
      maxCharacters: positive(context.maxCharacters),
      maxFileCharacters: positive(context.maxFileCharacters),
    },
    logging: {
      mode: logging.mode as LoggingConfigV1["mode"],
      retentionDays: positive(logging.retentionDays),
    },
    quality: parsedQuality,
    retry: c.retry === undefined ? DEFAULT_BRIDGE_CONFIG.retry : retry(c.retry),
  };
  if (result.activeProfile && !result.profiles[result.activeProfile]) invalid();
  return result;
}
function merge<T>(base: T, next: unknown): T {
  if (!next || typeof next !== "object" || Array.isArray(next))
    return (next === undefined ? base : next) as T;
  const output = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(next as Record<string, unknown>))
    output[key] = key in output ? merge(output[key], value) : value;
  return output as T;
}
export function mergeBridgeConfig(
  ...layers: Array<BridgeConfigLayer | undefined>
): BridgeConfigV1 {
  return parseBridgeConfig(
    layers.reduce<unknown>(
      (result, layer) => (layer ? merge(result, layer) : result),
      DEFAULT_BRIDGE_CONFIG,
    ),
  );
}
export function resolveConfigPaths(
  options: {
    home?: string;
    environment?: NodeJS.ProcessEnv;
    projectRoot?: string;
    configDirName?: string;
  } = {},
): { globalPath: string; projectPath?: string } {
  const home =
    options.home ??
    options.environment?.INTENT_BRIDGE_HOME ??
    join(homedir(), ".pi", "agent", "intent-bridge");
  return {
    globalPath: join(home, "config.json"),
    ...(options.projectRoot && options.configDirName
      ? {
          projectPath: join(
            options.projectRoot,
            options.configDirName,
            "intent-bridge.json",
          ),
        }
      : {}),
  };
}
export function parsePiModelSelectionV1(value: unknown): PiModelSelectionV1 {
  const selection = object(value);
  exact(selection, ["version", "provider", "model"]);
  if (selection.version !== 1) invalid();
  const provider = string(selection.provider);
  const model = string(selection.model);
  if (!provider.trim() || !model.trim()) invalid();
  return { version: 1, provider, model };
}

export async function loadPiModelSelection(
  path: string,
): Promise<PiModelSelectionV1 | undefined> {
  try {
    return parsePiModelSelectionV1(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof BridgeError) throw error;
    invalid();
  }
}

export async function loadBridgeConfigLayer(
  path: string,
): Promise<BridgeConfigLayer | undefined> {
  try {
    return object(
      JSON.parse(await readFile(path, "utf8")),
    ) as BridgeConfigLayer;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof BridgeError) throw error;
    invalid();
  }
}
export function applyEnvironmentOverrides(
  config: BridgeConfigV1,
  environment: NodeJS.ProcessEnv = process.env,
): BridgeConfigV1 {
  const values: BridgeConfigLayer = {};
  const parseBool = (
    name: "INTENT_BRIDGE_ENABLED" | "INTENT_BRIDGE_CONTEXT_ENABLED",
  ): boolean | undefined => {
    const value = environment[name];
    if (value === undefined) return undefined;
    if (value === "true") return true;
    if (value === "false") return false;
    invalid();
  };
  const enabled = parseBool("INTENT_BRIDGE_ENABLED");
  if (enabled !== undefined) values.enabled = enabled;
  const contextEnabled = parseBool("INTENT_BRIDGE_CONTEXT_ENABLED");
  if (contextEnabled !== undefined)
    values.context = { ...config.context, enabled: contextEnabled };
  if (environment.INTENT_BRIDGE_MODE !== undefined) {
    if (!["auto", "preview", "off"].includes(environment.INTENT_BRIDGE_MODE))
      invalid();
    values.mode = environment.INTENT_BRIDGE_MODE as BridgeConfigV1["mode"];
  }
  if (environment.INTENT_BRIDGE_LOGGING_MODE !== undefined) {
    if (
      !["metadata", "full", "off"].includes(
        environment.INTENT_BRIDGE_LOGGING_MODE,
      )
    )
      invalid();
    values.logging = {
      ...config.logging,
      mode: environment.INTENT_BRIDGE_LOGGING_MODE as LoggingConfigV1["mode"],
    };
  }
  if (environment.INTENT_BRIDGE_ACTIVE_PROFILE !== undefined)
    values.activeProfile = environment.INTENT_BRIDGE_ACTIVE_PROFILE;
  return mergeBridgeConfig(config, values);
}
export async function loadLayeredConfig(
  options: {
    projectRoot?: string;
    configDirName?: string;
    projectTrusted?: boolean;
    home?: string;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<BridgeConfigV1> {
  const paths = resolveConfigPaths(options);
  return applyEnvironmentOverrides(
    mergeBridgeConfig(
      await loadBridgeConfigLayer(paths.globalPath),
      options.projectTrusted
        ? await loadBridgeConfigLayer(paths.projectPath ?? "")
        : undefined,
    ),
    options.environment,
  );
}
export function resolveApiKey(
  apiKeyEnv: string,
  environment:
    | NodeJS.ProcessEnv
    | ((name: string) => string | undefined) = process.env,
): string {
  const value = (
    typeof environment === "function"
      ? environment(apiKeyEnv)
      : environment[apiKeyEnv]
  )?.trim();
  if (!value)
    throw new BridgeError({
      code: "SECRET_MISSING",
      safeMessage: "A configured provider secret is missing.",
      retryable: false,
    });
  return value;
}
export function redactConfig(config: BridgeConfigV1): BridgeConfigV1 {
  return {
    ...config,
    profiles: Object.fromEntries(
      Object.entries(config.profiles).map(([id, p]) => [
        id,
        {
          ...p,
          ...(p.headers
            ? {
                headers: Object.fromEntries(
                  Object.keys(p.headers).map((key) => [key, "[REDACTED]"]),
                ),
              }
            : {}),
        },
      ]),
    ),
  };
}
export interface ConfigFileSystem {
  writeFile?: typeof writeFile;
  rename?: typeof rename;
  unlink?: typeof unlink;
}
async function writeJsonAtomic(
  path: string,
  value: object,
  fs: ConfigFileSystem = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await (fs.writeFile ?? writeFile)(
      temp,
      `${JSON.stringify(value, null, 2)}\n`,
      { mode: 0o600 },
    );
    try {
      const handle = await open(temp, "r");
      await handle.sync();
      await handle.close();
    } catch {}
    await (fs.rename ?? rename)(temp, path);
  } catch (error) {
    await (fs.unlink ?? unlink)(temp).catch(() => undefined);
    throw error;
  }
}

export async function writePiModelSelectionAtomic(
  path: string,
  value: PiModelSelectionV1,
  fs: ConfigFileSystem = {},
): Promise<void> {
  const next = parsePiModelSelectionV1(value);
  const current = await loadPiModelSelection(path);
  if (current && current.version !== 1) invalid();
  await writeJsonAtomic(path, next, fs);
}

export async function removePiModelSelection(path: string): Promise<void> {
  if (!(await loadPiModelSelection(path))) return;
  await unlink(path);
}

export async function writeBridgeConfigAtomic(
  path: string,
  config: BridgeConfigV1,
  fs: ConfigFileSystem = {},
): Promise<void> {
  const next = parseBridgeConfig(config);
  const current = await loadBridgeConfigLayer(path);
  if (current && current.version !== 1) invalid();
  await writeJsonAtomic(path, next, fs);
}

export async function updateBridgeConfigLayerAtomic(
  path: string,
  base: BridgeConfigLayer | undefined,
  patch: BridgeConfigPatch,
  fs: ConfigFileSystem = {},
): Promise<void> {
  const current = await loadBridgeConfigLayer(path);
  if (current?.version !== undefined && current.version !== 1) invalid();
  const next = merge(
    current ?? { version: 1 as const },
    patch,
  ) as BridgeConfigLayer;
  mergeBridgeConfig(base, next);
  await writeJsonAtomic(path, next, fs);
}
