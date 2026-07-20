import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const patterns = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9._/-]{16,}/i,
];
// Generated deterministically from scanned source; release smoke separately checks bundle imports and contents.
const excludedGeneratedBundle = "packages/pi-extension/dist/index.js";
const allowedFixtures = new Map([
  [
    "packages/core/test/config.test.ts",
    new Set([
      'baseUrl: "https://x:sk-secret-secret@example.test",',
      'apiKeyEnv: "sk-this-is-not-an-env-name",',
    ]),
  ],
  [
    "packages/core/test/context.test.ts",
    new Set(['"Bearer abcdefghijklmnop xxxxxxxxxxxxxxxxxxxx",']),
  ],
  [
    "packages/core/test/privacy.test.ts",
    new Set([
      'text: "Bearer abcdefghijklmnop",',
      'contextManifest: { Authorization: "Bearer top-secret", path: "npm test" },',
      '"Bearer abcdefghijklmnop sk_abcdefghijklmnopqrstuvwxyz https://u:password123@example.test -----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY----- npm test /tmp/path";',
    ]),
  ],
  [
    "benchmarks/cases/en-13.json",
    new Set([
      '"input": "A fixture logs `token=EXAMPLE_NOT_A_SECRET_WEBHOOK_13`. Ensure diagnostics redact the value while preserving the field name. Do not add the literal to production config.",',
    ]),
  ],
  [
    "benchmarks/cases/es-09.json",
    new Set([
      '"input": "El fixture contiene `token=EXAMPLE_NOT_A_SECRET_ES_09`. Ocúltalo en el diagnóstico, conserva el nombre del campo y no inventes credenciales reales.",',
    ]),
  ],
  [
    "benchmarks/cases/tr-13.json",
    new Set([
      '"input": "Test girdisinde `token=EXAMPLE_NOT_A_SECRET_TR_13` var. Loglarda değeri maskele, test fixture içindeki sentetik değeri koru ve gerçek anahtar biçimi üretme.",',
    ]),
  ],
  [
    "packages/benchmark/test/report.test.ts",
    new Set(['note: "token=EXAMPLE_NOT_A_SECRET_LONG_VALUE",']),
  ],
  [
    "packages/benchmark/test/trace-export.test.ts",
    new Set([
      'fullTrace("secret", "token=EXAMPLE_NOT_A_SECRET_EXPORT_123456"),',
    ]),
  ],
  [
    "packages/pi-extension/test/index.test.ts",
    new Set(['input({ text: "api_key=SENTINEL_SECRET_VALUE" }),']),
  ],
]);
const scannerFixtureValues = [
  "EXAMPLE_NOT_A_SECRET",
  "SENTINEL_SECRET_VALUE",
  "sk-this-is-not-an-env-name",
  "abcdefghijklmnop",
  "sk_abcdefghijklmnopqrstuvwxyz",
  "password123",
  "sk-thislooksrealandmustbecaught",
  "ghp_thislookslikearealcredential",
  "AKIA1234567890ABCDEF",
  "thislookslikearealcredential",
  "-----BEGIN PRIVATE KEY-----",
];
function findings(text, file = "") {
  const allowed = allowedFixtures.get(file);
  return text
    .split("\n")
    .flatMap((line, index) =>
      !allowed?.has(line.trim()) &&
      !(
        file === "scripts/scan-secrets.mjs" &&
        scannerFixtureValues.some((value) => line.includes(value))
      ) &&
      patterns.some((pattern) => pattern.test(line))
        ? [index + 1]
        : [],
    );
}
if (process.argv.includes("--self-test")) {
  for (const fixture of [
    [
      'apiKeyEnv: "sk-this-is-not-an-env-name",',
      "packages/core/test/config.test.ts",
    ],
    [
      '"Bearer abcdefghijklmnop xxxxxxxxxxxxxxxxxxxx",',
      "packages/core/test/context.test.ts",
    ],
    ['text: "Bearer abcdefghijklmnop",', "packages/core/test/privacy.test.ts"],
  ])
    assert.deepEqual(findings(...fixture), []);
  for (const sample of [
    'token="sk-thislooksrealandmustbecaught"',
    'token="ghp_thislookslikearealcredential"',
    'token="AKIA1234567890ABCDEF"',
    "Bearer thislookslikearealcredential",
    "-----BEGIN PRIVATE KEY-----",
  ])
    assert.deepEqual(findings(sample), [1]);
  assert.deepEqual(findings(patterns.map(String).join("\n")), []);
  console.log("secret scanner self-test passed");
  process.exit(0);
}
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const found = [];
for (const file of files) {
  if (file === excludedGeneratedBundle) continue;
  const text = await readFile(file, "utf8").catch(() => "");
  for (const line of findings(text, file)) found.push(`${file}:${line}`);
}
if (found.length) {
  console.error(`possible secret(s):\n${found.join("\n")}`);
  process.exit(1);
}
console.log(`secret scan passed: ${files.length} tracked files`);
