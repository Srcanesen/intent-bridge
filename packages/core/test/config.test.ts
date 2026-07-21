import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BridgeError,
  DEFAULT_BRIDGE_CONFIG,
  DEFAULT_QUALITY_CONFIG,
  applyEnvironmentOverrides,
  loadLayeredConfig,
  loadPiModelSelection,
  mergeBridgeConfig,
  parseBridgeConfig,
  redactConfig,
  resolveApiKey,
  resolveConfigPaths,
  removePiModelSelection,
  updateBridgeConfigLayerAtomic,
  writeBridgeConfigAtomic,
  writePiModelSelectionAtomic,
  parsePiModelSelectionV1,
} from "../src/index.js";

const profile = {
  id: "demo",
  protocol: "openai-compatible" as const,
  baseUrl: "https://example.test/v1",
  model: "demo",
  apiKeyEnv: "DEMO_KEY",
  timeoutMs: 8000,
  maxOutputTokens: 1000,
  capabilities: {
    structuredOutput: "json_object" as const,
    usageMetadata: true,
    supportsSeed: false,
  },
  headers: { "X-Client": "private" },
};
const config = () =>
  mergeBridgeConfig({
    enabled: true,
    profiles: { demo: profile },
    activeProfile: "demo",
  });
const bridgeError = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as BridgeError;
  }
  throw new Error("expected error");
};

describe("configuration", () => {
  it("merges defaults, global, project and environment deterministically", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({
        enabled: true,
        logging: { mode: "full", retentionDays: 7 },
        profiles: { demo: profile },
        activeProfile: "demo",
      }),
    );
    const root = await mkdtemp(join(tmpdir(), "project-"));
    await mkdir(join(root, ".test"));
    await writeFile(
      join(root, ".test", "intent-bridge.json"),
      JSON.stringify({
        context: { enabled: false, maxCharacters: 99, maxFileCharacters: 50 },
      }),
    );
    const result = await loadLayeredConfig({
      home,
      projectRoot: root,
      configDirName: ".test",
      projectTrusted: true,
      environment: { INTENT_BRIDGE_MODE: "preview" },
    });
    expect(result).toMatchObject({
      enabled: true,
      mode: "preview",
      context: { maxCharacters: 99 },
      logging: { mode: "full" },
    });
  });
  it("ignores an actual untrusted project layer while applying global, defaults and environment", async () => {
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    const root = await mkdtemp(join(tmpdir(), "project-"));
    await mkdir(join(root, ".test"));
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({ enabled: true }),
    );
    await writeFile(
      join(root, ".test", "intent-bridge.json"),
      JSON.stringify({ context: { maxCharacters: 99 } }),
    );
    const result = await loadLayeredConfig({
      home,
      projectRoot: root,
      configDirName: ".test",
      projectTrusted: false,
      environment: { INTENT_BRIDGE_MODE: "preview" },
    });
    expect(result).toMatchObject({
      enabled: true,
      mode: "preview",
      context: DEFAULT_BRIDGE_CONFIG.context,
    });
  });
  it("resolves retry defaults for old config and validates configured bounds", () => {
    const { retry, ...oldConfig } = DEFAULT_BRIDGE_CONFIG;
    expect(parseBridgeConfig(oldConfig).retry).toEqual(retry);
    expect(
      mergeBridgeConfig({ retry: { maxRetries: 2, baseDelayMs: 1 } }),
    ).toMatchObject({
      retry: { maxRetries: 2, baseDelayMs: 1, totalBudgetMs: 45000 },
    });
    for (const invalidRetry of [
      { maxRetries: -1, baseDelayMs: 1, totalBudgetMs: 1 },
      { maxRetries: 3, baseDelayMs: 1, totalBudgetMs: 1 },
      { maxRetries: 1.5, baseDelayMs: 1, totalBudgetMs: 1 },
      { maxRetries: 1, baseDelayMs: 0, totalBudgetMs: 1 },
      { maxRetries: 1, baseDelayMs: 10_001, totalBudgetMs: 1 },
      { maxRetries: 1, baseDelayMs: 1, totalBudgetMs: 0 },
      { maxRetries: 1, baseDelayMs: 1, totalBudgetMs: 120_001 },
    ])
      expect(
        bridgeError(() =>
          parseBridgeConfig({ ...DEFAULT_BRIDGE_CONFIG, retry: invalidRetry }),
        ).code,
      ).toBe("CONFIG_INVALID");
  });

  it("rejects malformed, unknown, future and inline-secret config", () => {
    for (const value of [
      { ...DEFAULT_BRIDGE_CONFIG, extra: true },
      { ...DEFAULT_BRIDGE_CONFIG, version: 2 },
      {
        ...DEFAULT_BRIDGE_CONFIG,
        profiles: {
          demo: {
            ...profile,
            baseUrl: "https://x:sk-secret-secret@example.test",
          },
        },
      },
    ])
      expect(bridgeError(() => parseBridgeConfig(value)).code).toBe(
        "CONFIG_INVALID",
      );
  });
  it("rejects pasted api key values during parse and load while preserving environment names", async () => {
    const secretProfile = {
      ...profile,
      apiKeyEnv: "sk-this-is-not-an-env-name",
    };
    expect(
      bridgeError(() =>
        parseBridgeConfig({
          ...DEFAULT_BRIDGE_CONFIG,
          profiles: { demo: secretProfile },
          activeProfile: "demo",
        }),
      ).code,
    ).toBe("CONFIG_INVALID");
    const home = await mkdtemp(join(tmpdir(), "bridge-"));
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({
        profiles: { demo: secretProfile },
        activeProfile: "demo",
      }),
    );
    await expect(loadLayeredConfig({ home })).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    expect(redactConfig(config()).profiles.demo.apiKeyEnv).toBe("DEMO_KEY");
  });
  it("rejects an active profile that does not exist", () => {
    expect(
      bridgeError(() =>
        parseBridgeConfig({
          ...DEFAULT_BRIDGE_CONFIG,
          activeProfile: "missing",
        }),
      ).code,
    ).toBe("CONFIG_INVALID");
  });
  it("applies only valid environment overrides", () => {
    expect(
      applyEnvironmentOverrides(config(), {
        INTENT_BRIDGE_ENABLED: "false",
        INTENT_BRIDGE_LOGGING_MODE: "off",
      }),
    ).toMatchObject({ enabled: false, logging: { mode: "off" } });
    expect(
      bridgeError(() =>
        applyEnvironmentOverrides(config(), { INTENT_BRIDGE_ENABLED: "yes" }),
      ).code,
    ).toBe("CONFIG_INVALID");
  });
  it("resolves env secrets without exposing names or values", () => {
    expect(resolveApiKey("KEY", { KEY: " token " })).toBe("token");
    const error = bridgeError(() => resolveApiKey("SECRET_NAME", {}));
    expect(error.code).toBe("SECRET_MISSING");
    expect(error.safeMessage).not.toContain("SECRET_NAME");
  });
  it("redacts all custom headers without reading environment", () => {
    expect(redactConfig(config()).profiles.demo.headers).toEqual({
      "X-Client": "[REDACTED]",
    });
  });
  it.each([
    ["numeric future version", '{"version":2}'],
    ["string version", '{"version":"1"}'],
    ["null version", '{"version":null}'],
    ["missing version", "{}"],
    ["malformed JSON", "not json"],
  ])("refuses unknown existing config (%s) without touching bytes or leaving a temp", async (_, old) => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-"));
    const path = join(dir, "config.json");
    await writeFile(path, old);
    await expect(writeBridgeConfigAtomic(path, config())).rejects.toMatchObject(
      {
        code: "CONFIG_INVALID",
      },
    );
    expect(await readFile(path, "utf8")).toBe(old);
    expect(
      (await readdir(dir)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });
  it("updates a partial layer without flattening its base", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-"));
    const path = join(dir, "config.json");
    const base = {
      profiles: { demo: profile },
      activeProfile: "demo",
      logging: { mode: "full" as const, retentionDays: 7 },
    };
    await writeFile(path, JSON.stringify({ quality: {} }));
    await updateBridgeConfigLayerAtomic(path, base, {
      enabled: false,
      mode: "off",
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      enabled: false,
      mode: "off",
      quality: {},
    });
  });
  it("deep-patches a local profile model without copying inherited profile fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-"));
    const path = join(dir, "intent-bridge.json");
    await writeFile(path, JSON.stringify({ version: 1, quality: {} }));
    await updateBridgeConfigLayerAtomic(
      path,
      { profiles: { demo: profile }, activeProfile: "demo" },
      {
        profiles: { demo: { model: "new-model" } },
      },
    );
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 1,
      quality: {},
      profiles: { demo: { model: "new-model" } },
    });
    await expect(
      loadLayeredConfig({
        home: dir,
        projectRoot: dir,
        configDirName: ".missing",
        projectTrusted: true,
      }),
    ).resolves.toBeDefined();
  });
  it("refuses a future layer version without touching bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-"));
    const path = join(dir, "config.json");
    const old = '{"version":2,"enabled":true}';
    await writeFile(path, old);
    await expect(
      updateBridgeConfigLayerAtomic(path, undefined, {
        enabled: false,
        mode: "off",
      }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(await readFile(path, "utf8")).toBe(old);
  });
  it("writes complete config atomically with 0600 permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-"));
    const path = join(dir, "config.json");
    await writeBridgeConfigAtomic(path, config());
    expect(parseBridgeConfig(JSON.parse(await readFile(path, "utf8")))).toEqual(
      config(),
    );
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
  it("preserves old bytes and cleans temp files after write or rename failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-"));
    const path = join(dir, "config.json");
    const old = `${JSON.stringify(DEFAULT_BRIDGE_CONFIG)}\n`;
    await writeFile(path, old);
    await expect(
      writeBridgeConfigAtomic(path, config(), {
        writeFile: (async () => {
          throw new Error("write");
        }) as never,
      }),
    ).rejects.toThrow("write");
    await expect(
      writeBridgeConfigAtomic(path, config(), {
        rename: (async () => {
          throw new Error("rename");
        }) as never,
      }),
    ).rejects.toThrow("rename");
    expect(await readFile(path, "utf8")).toBe(old);
    expect(
      (await readdir(dir)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });
  it("strictly reads, writes, and removes Pi model selections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-"));
    const path = join(dir, "pi-model-selection.json");
    const selection = {
      version: 1 as const,
      provider: "demo",
      model: "org/demo",
    };
    expect(parsePiModelSelectionV1(selection)).toEqual(selection);
    for (const value of [
      { ...selection, extra: true },
      { ...selection, version: 2 },
      {},
      "bad",
    ])
      expect(bridgeError(() => parsePiModelSelectionV1(value)).code).toBe(
        "CONFIG_INVALID",
      );
    await expect(loadPiModelSelection(path)).resolves.toBeUndefined();
    await writePiModelSelectionAtomic(path, selection);
    expect(await loadPiModelSelection(path)).toEqual(selection);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await removePiModelSelection(path);
    await removePiModelSelection(path);
    await expect(loadPiModelSelection(path)).resolves.toBeUndefined();
  });
  it("does not overwrite a future Pi model selection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-"));
    const path = join(dir, "pi-model-selection.json");
    const old = '{"version":2,"provider":"demo","model":"x"}';
    await writeFile(path, old);
    await expect(
      writePiModelSelectionAtomic(path, {
        version: 1,
        provider: "demo",
        model: "x",
      }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    await expect(removePiModelSelection(path)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    expect(await readFile(path, "utf8")).toBe(old);
  });
  it("resolves configured global and project paths", () => {
    expect(
      resolveConfigPaths({
        home: "/tmp/home",
        projectRoot: "/repo",
        configDirName: ".pi",
      }),
    ).toEqual({
      globalPath: "/tmp/home/config.json",
      projectPath: "/repo/.pi/intent-bridge.json",
    });
  });
  it("applies defaults to empty and partial quality blocks and preserves patched quality through merge", () => {
    expect(
      parseBridgeConfig({ ...DEFAULT_BRIDGE_CONFIG, quality: {} }).quality,
    ).toEqual(DEFAULT_QUALITY_CONFIG);
    expect(mergeBridgeConfig({ quality: {} } as never).quality).toEqual(
      DEFAULT_QUALITY_CONFIG,
    );
    expect(
      mergeBridgeConfig({
        quality: { enforcement: "review", minConfidence: 0.7 },
      } as never).quality,
    ).toEqual({
      ...DEFAULT_QUALITY_CONFIG,
      enforcement: "review",
      minConfidence: 0.7,
    });
  });
  it.each([
    [{ ...DEFAULT_QUALITY_CONFIG, quality: { enforcement: "block" } }],
    [
      {
        ...DEFAULT_BRIDGE_CONFIG,
        quality: { ...DEFAULT_QUALITY_CONFIG, minConfidence: -0.1 },
      },
    ],
    [
      {
        ...DEFAULT_BRIDGE_CONFIG,
        quality: { ...DEFAULT_QUALITY_CONFIG, minConfidence: 1.5 },
      },
    ],
    [
      {
        ...DEFAULT_BRIDGE_CONFIG,
        quality: { ...DEFAULT_QUALITY_CONFIG, minConfidence: "0.5" },
      },
    ],
    [
      {
        ...DEFAULT_BRIDGE_CONFIG,
        quality: { ...DEFAULT_QUALITY_CONFIG, reviewOnHighRisk: "yes" },
      },
    ],
    [
      {
        ...DEFAULT_BRIDGE_CONFIG,
        quality: { ...DEFAULT_QUALITY_CONFIG, noUiAction: "open_settings" },
      },
    ],
    [
      {
        ...DEFAULT_BRIDGE_CONFIG,
        quality: { ...DEFAULT_QUALITY_CONFIG, unknown: true },
      },
    ],
  ])("rejects invalid quality config: %j", (value) => {
    expect(bridgeError(() => parseBridgeConfig(value)).code).toBe(
      "CONFIG_INVALID",
    );
  });
  it("accepts every legal value of minConfidence (0, 0.5, 1) and explicit null", () => {
    for (const value of [0, 0.5, 1, null]) {
      const parsed = parseBridgeConfig({
        ...DEFAULT_BRIDGE_CONFIG,
        quality: { ...DEFAULT_QUALITY_CONFIG, minConfidence: value },
      });
      expect(parsed.quality.minConfidence).toBe(value);
    }
  });
});
