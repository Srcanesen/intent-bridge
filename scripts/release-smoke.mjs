import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(".");
const pi = resolve("packages/pi-extension/node_modules/.bin/pi");

function parseArgs(args) {
  let packed = false;
  let tarball;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--pack") {
      packed = true;
      continue;
    }
    if (arg === "--tarball") {
      const separator = args[index + 1] === "--";
      const path = args[index + 1 + Number(separator)];
      if (!path || path.startsWith("--")) {
        throw new Error("Configuration error: --tarball requires a path");
      }
      if (tarball) {
        throw new Error(
          "Configuration error: --tarball may only be provided once",
        );
      }
      tarball = resolve(path);
      index += 1 + Number(separator);
      continue;
    }
    throw new Error(`Configuration error: unknown argument ${arg}`);
  }
  if (packed && tarball) {
    throw new Error(
      "Configuration error: --pack cannot be used with --tarball",
    );
  }
  return { packed, tarball };
}

async function verifyTarball(path) {
  if (!path.endsWith(".tgz")) {
    throw new Error(
      "Configuration error: --tarball must reference a .tgz file",
    );
  }
  try {
    await access(path);
    if (!(await stat(path)).isFile()) {
      throw new Error("not a file");
    }
  } catch {
    throw new Error(
      "Configuration error: --tarball must reference a readable file",
    );
  }
}

const { packed, tarball: prebuiltTarball } = parseArgs(process.argv.slice(2));
const temp = await mkdtemp(join(tmpdir(), "intent-bridge-release-"));
const run = (command, args, { timeout = 120_000, ...options } = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 1_000_000,
    ...options,
  });
  assert.equal(
    result.error?.code,
    undefined,
    `${command} is unavailable or timed out`,
  );
  assert.equal(
    result.status,
    0,
    `${command} exited unsuccessfully${result.signal ? ` (${result.signal})` : ""}`,
  );
  return result.stdout;
};

async function observer(directory) {
  const path = join(directory, "observer.mjs");
  await writeFile(
    path,
    `import { writeFileSync } from "node:fs";\nexport default pi => pi.on("input", event => { writeFileSync(process.env.OBSERVER_FILE, event.text); return { action: "handled" }; });\n`,
  );
  return path;
}
async function smoke(extension, directory, name) {
  const scope = join(temp, name);
  const agent = join(scope, "pi-agent");
  const bridgeHome = join(scope, "bridge-home");
  const sessionDir = join(scope, "sessions");
  const output = join(scope, "observed.txt");
  await mkdir(scope, { recursive: true });
  const observerPath = await observer(scope);
  const prompt = "Bounded fail-open release smoke";
  await mkdir(agent, { recursive: true });
  await mkdir(bridgeHome, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(agent, "models.json"),
    JSON.stringify({
      providers: {
        smoke: {
          baseUrl: "http://127.0.0.1:9/v1",
          api: "openai-completions",
          apiKey: "smoke",
          models: [{ id: "smoke-model" }],
        },
      },
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/(?:API[_-]?KEY|ACCESS[_-]?KEY|AUTH(?:ORIZATION)?|TOKEN|SECRET)$/i.test(
          key,
        ),
    ),
  );
  run(
    pi,
    [
      "--no-session",
      "--session-dir",
      sessionDir,
      "--no-extensions",
      "-e",
      extension,
      "-e",
      observerPath,
      "--provider",
      "smoke",
      "--model",
      "smoke-model",
      "-p",
      prompt,
    ],
    {
      cwd: directory,
      timeout: 60_000,
      env: {
        ...env,
        HOME: join(scope, "home"),
        PI_CODING_AGENT_DIR: agent,
        PI_CODING_AGENT_SESSION_DIR: sessionDir,
        PI_OFFLINE: "true",
        PI_SKIP_VERSION_CHECK: "true",
        PI_TELEMETRY: "false",
        INTENT_BRIDGE_HOME: bridgeHome,
        INTENT_BRIDGE_ENABLED: "true",
        INTENT_BRIDGE_MODE: "auto",
        OBSERVER_FILE: output,
      },
    },
  );
  assert.equal(
    await readFile(output, "utf8"),
    prompt,
    "Pi did not receive the unchanged missing-profile fail-open prompt",
  );
  assert.deepEqual(
    await readdir(bridgeHome),
    [],
    "missing-profile smoke unexpectedly created bridge configuration",
  );
}
try {
  const packageDir = join(root, "packages/pi-extension");
  const expectedManifest = JSON.parse(
    await readFile(join(packageDir, "package.json"), "utf8"),
  );
  let tarball = prebuiltTarball;
  if (tarball) {
    await verifyTarball(tarball);
  } else {
    run("corepack", [
      "pnpm",
      "--dir",
      packageDir,
      "pack",
      "--pack-destination",
      temp,
    ]);
    tarball = join(
      temp,
      (await readdir(temp)).find((file) => file.endsWith(".tgz")) ?? "",
    );
    assert.ok(tarball.endsWith(".tgz"), "pnpm pack did not create a tarball");
  }
  const entries = run("tar", ["-tzf", tarball]).trim().split("\n");
  const expected = new Set([
    "package/dist/index.js",
    "package/README.md",
    "package/LICENSE",
    "package/THIRD_PARTY_NOTICES.md",
    "package/package.json",
  ]);
  assert.deepEqual(
    new Set(entries),
    expected,
    "tarball contents are not the strict release allowlist",
  );
  assert.ok(
    entries.every(
      (entry) =>
        !/(?:src|test|tsconfig|tsbuildinfo|\.map|benchmark)/.test(entry),
    ),
    "tarball includes development material",
  );
  assert.ok(
    (await readFile(tarball)).byteLength < 500_000,
    "tarball exceeds bounded release size",
  );
  run("tar", ["-xzf", tarball, "-C", temp]);
  const manifest = JSON.parse(
    await readFile(join(temp, "package/package.json"), "utf8"),
  );
  assert.deepEqual(
    {
      name: manifest.name,
      version: manifest.version,
      license: manifest.license,
    },
    {
      name: expectedManifest.name,
      version: expectedManifest.version,
      license: expectedManifest.license,
    },
  );
  assert.deepEqual(manifest.pi?.extensions, ["./dist/index.js"]);
  assert.equal(JSON.stringify(manifest).includes("workspace:"), false);
  const bundle = await readFile(join(temp, "package/dist/index.js"), "utf8");
  assert.equal(
    /@intent-bridge\//.test(bundle),
    false,
    "bundle imports an unpublished package",
  );
  assert.equal(
    /(?:packages|node_modules)\//.test(bundle),
    false,
    "bundle leaks source paths",
  );
  const consumer = join(temp, "consumer");
  await mkdir(consumer);
  run("npm", ["init", "-y"], { cwd: consumer });
  run(
    "npm",
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--legacy-peer-deps",
      tarball,
    ],
    { cwd: consumer },
  );
  await smoke(
    join(consumer, "node_modules/@srcanesen/intent-bridge/dist/index.js"),
    consumer,
    "tarball",
  );
  if (!packed && !prebuiltTarball) {
    const clone = join(temp, "clone");
    run("git", ["clone", "--quiet", root, clone]);
    const rootManifest = JSON.parse(
      await readFile(join(clone, "package.json"), "utf8"),
    );
    assert.deepEqual(rootManifest.pi?.extensions, [
      "./packages/pi-extension/dist/index.js",
    ]);
    run(
      "npm",
      ["install", "--omit=dev", "--ignore-scripts", "--legacy-peer-deps"],
      { cwd: clone },
    );
    await smoke(
      join(clone, "packages/pi-extension/dist/index.js"),
      clone,
      "clone",
    );
  }
  console.log(`release smoke passed: ${basename(tarball)}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
