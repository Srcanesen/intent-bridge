import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export type IsolationAttestationV1 = {
  version: 1;
  writableFixtureRoot: string;
  policyHash: string;
  network: {
    mode: "deny-except-inference-gateway";
    inferenceHosts: string[];
  };
  process: { pid: number; cwd: string };
  sourceRepoWritable: false;
  homeMounted: false;
  credentialsMounted: false;
  dockerSocketMounted: false;
};

const invalid = (): never => {
  throw new Error("INVALID_ISOLATION");
};
const exact = (value: unknown, keys: readonly string[]) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const out = value as Record<string, unknown>;
  if (
    keys.some((key) => !(key in out)) ||
    Object.keys(out).some((key) => !keys.includes(key))
  )
    invalid();
  return out;
};
const absolutePath = (value: unknown): string =>
  typeof value === "string" &&
  value.length <= 1000 &&
  isAbsolute(value) &&
  !value.includes("\0")
    ? resolve(value)
    : invalid();

export function parseIsolationAttestationV1(
  value: unknown,
): IsolationAttestationV1 {
  const o = exact(value, [
    "version",
    "writableFixtureRoot",
    "policyHash",
    "network",
    "process",
    "sourceRepoWritable",
    "homeMounted",
    "credentialsMounted",
    "dockerSocketMounted",
  ]);
  const network = exact(o.network, ["mode", "inferenceHosts"]);
  const processValue = exact(o.process, ["pid", "cwd"]);
  if (
    o.version !== 1 ||
    !Array.isArray(network.inferenceHosts) ||
    network.inferenceHosts.length < 1 ||
    network.inferenceHosts.length > 8 ||
    network.inferenceHosts.some(
      (host) =>
        typeof host !== "string" ||
        host.length > 253 ||
        !/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host),
    ) ||
    new Set(network.inferenceHosts).size !== network.inferenceHosts.length ||
    network.mode !== "deny-except-inference-gateway" ||
    typeof processValue.pid !== "number" ||
    !Number.isSafeInteger(processValue.pid) ||
    processValue.pid < 1 ||
    !/^[0-9a-f]{64}$/.test(String(o.policyHash)) ||
    o.sourceRepoWritable !== false ||
    o.homeMounted !== false ||
    o.credentialsMounted !== false ||
    o.dockerSocketMounted !== false
  )
    invalid();
  const inferenceHosts = network.inferenceHosts as string[];
  const pid = processValue.pid as number;
  return {
    version: 1,
    writableFixtureRoot: absolutePath(o.writableFixtureRoot),
    policyHash: String(o.policyHash),
    network: {
      mode: "deny-except-inference-gateway",
      inferenceHosts: [...inferenceHosts],
    },
    process: {
      pid,
      cwd: absolutePath(processValue.cwd),
    },
    sourceRepoWritable: false,
    homeMounted: false,
    credentialsMounted: false,
    dockerSocketMounted: false,
  };
}

export async function requireIsolationPreflight(input: {
  liveOptIn: string | undefined;
  attestationPath: string | undefined;
  fixtureRoot: string;
  cwd?: string;
  pid?: number;
}): Promise<IsolationAttestationV1> {
  const attestationPath = input.attestationPath;
  if (input.liveOptIn !== "1" || typeof attestationPath !== "string") invalid();
  const parsed = await (async (): Promise<IsolationAttestationV1> => {
    try {
      return parseIsolationAttestationV1(
        JSON.parse(await readFile(attestationPath as string, "utf8")),
      );
    } catch {
      return invalid();
    }
  })();
  const [declaredRoot, fixtureRoot, cwd] = await Promise.all([
    realpath(parsed.writableFixtureRoot).catch(invalid),
    realpath(input.fixtureRoot).catch(invalid),
    realpath(input.cwd ?? process.cwd()).catch(invalid),
  ]);
  const inside = relative(declaredRoot, fixtureRoot);
  if (
    inside.startsWith("..") ||
    isAbsolute(inside) ||
    parsed.process.pid !== (input.pid ?? process.pid) ||
    parsed.process.cwd !== cwd
  )
    invalid();
  return { ...parsed, writableFixtureRoot: declaredRoot };
}
