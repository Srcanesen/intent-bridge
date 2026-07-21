import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { redactSecrets } from "@intent-bridge/core";
import {
  aggregateImplementationOutcomes,
  IMPLEMENTATION_OUTCOME_RUNNER,
  IMPLEMENTATION_OUTCOME_VERSION,
  parseImplementationCasesV1,
  parseImplementationOutcomeReportV1,
  parseRepoPath,
  type ImplementationArm,
  type ImplementationArmResultV1,
  type ImplementationCasePairV1,
  type ImplementationCaseV1,
  type ImplementationOutcomeReportV1,
} from "./contracts.js";

const exec = promisify(execFile);
const gitEnv = {
  PATH: process.env.PATH ?? "",
  LANG: "C",
  LC_ALL: "C",
  GIT_AUTHOR_NAME: "Intent Bridge Benchmark",
  GIT_AUTHOR_EMAIL: "benchmark@invalid.example",
  GIT_COMMITTER_NAME: "Intent Bridge Benchmark",
  GIT_COMMITTER_EMAIL: "benchmark@invalid.example",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

async function git(cwd: string, args: string[]): Promise<string> {
  return (
    await exec("git", args, { cwd, env: gitEnv, timeout: 20_000 })
  ).stdout.trim();
}

async function rejectSymlinks(root: string, current = root): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = join(current, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error("INVALID_FIXTURE");
    if (metadata.isDirectory()) await rejectSymlinks(root, path);
    const rel = relative(root, path);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new Error("INVALID_FIXTURE");
  }
}

export type MaterializedFixture = {
  cwd: string;
  revision: string;
  tree: string;
  dispose(): Promise<void>;
};

export async function materializeImplementationFixture(input: {
  caseItem: ImplementationCaseV1;
  corpusRoot: string;
  temporaryRoot?: string;
  verifyManifestIdentity?: boolean;
}): Promise<MaterializedFixture> {
  const corpusRoot = await realpath(input.corpusRoot);
  const template = await realpath(resolve(corpusRoot, input.caseItem.fixture));
  const templateRelative = relative(corpusRoot, template);
  if (templateRelative.startsWith("..") || isAbsolute(templateRelative))
    throw new Error("INVALID_FIXTURE");
  await rejectSymlinks(template);
  const root = await mkdtemp(
    join(input.temporaryRoot ?? tmpdir(), "intent-bridge-io-"),
  );
  const cwd = join(root, "repo");
  try {
    await cp(template, cwd, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await rejectSymlinks(cwd);
    await git(cwd, ["init", "-q"]);
    await git(cwd, ["add", "--all"]);
    await git(cwd, ["commit", "-q", "-m", "fixture"]);
    const revision = await git(cwd, ["rev-parse", "HEAD"]);
    const tree = await git(cwd, ["rev-parse", "HEAD^{tree}"]);
    if (
      input.verifyManifestIdentity !== false &&
      (revision !== input.caseItem.initialRevision ||
        tree !== input.caseItem.initialTree)
    )
      throw new Error("INVALID_BASELINE");
    if ((await git(cwd, ["status", "--porcelain"])) !== "")
      throw new Error("INVALID_BASELINE");
    return {
      cwd,
      revision,
      tree,
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function loadImplementationCases(
  path: string,
): Promise<ImplementationCaseV1[]> {
  return parseImplementationCasesV1(JSON.parse(await readFile(path, "utf8")));
}

const validatorEnv = () =>
  Object.fromEntries(
    ["PATH", "LANG", "LC_ALL", "TMPDIR"]
      .map((key) => [key, process.env[key]])
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
  );

export async function runTrustedArgv(
  cwd: string,
  argv: readonly string[],
  timeoutMs: number,
): Promise<boolean> {
  const command = argv[0];
  if (!command) return false;
  try {
    await exec(command, argv.slice(1), {
      cwd,
      env: validatorEnv(),
      timeout: timeoutMs,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export async function touchedRepoPaths(cwd: string): Promise<string[]> {
  const [tracked, untracked] = await Promise.all([
    git(cwd, ["diff", "--name-only", "-z", "HEAD"]),
    git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const paths = `${tracked}\0${untracked}`
    .split("\0")
    .filter(Boolean)
    .map(parseRepoPath);
  const unique = [...new Set(paths)].sort();
  for (const path of unique) {
    const absolute = resolve(cwd, path);
    const rel = relative(
      await realpath(cwd),
      await realpath(absolute).catch(() => absolute),
    );
    const metadata = await lstat(absolute).catch(
      (error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? undefined : Promise.reject(error),
    );
    if (rel.startsWith("..") || isAbsolute(rel) || metadata?.isSymbolicLink())
      throw new Error("INVALID_FIXTURE");
  }
  return unique;
}

const matchesPath = (path: string, rule: string) =>
  path === rule || path.startsWith(`${rule}/`);

export async function inspectImplementationOutcome(input: {
  caseItem: ImplementationCaseV1;
  cwd: string;
  arm: ImplementationArm;
  order: 0 | 1;
  fixtureRevision: string;
  fixtureTree: string;
  implementationLatencyMs: number;
  treatmentCompilationLatencyMs: number | null;
  observedClarification: boolean;
  turns: number;
  toolCalls: number;
  repeatedMutations: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  blockedSafety: ImplementationArmResultV1["blockedSafety"];
  modelFailed?: "MODEL_FAILED" | "MODEL_TIMEOUT";
}): Promise<ImplementationArmResultV1> {
  const touchedPaths = await touchedRepoPaths(input.cwd);
  const forbiddenViolation = touchedPaths.some((path) =>
    input.caseItem.forbiddenPaths.some((rule) => matchesPath(path, rule)),
  );
  const scopeViolation =
    touchedPaths.length > input.caseItem.maxTouchedFiles ||
    touchedPaths.some(
      (path) =>
        !input.caseItem.allowedPaths.some((rule) => matchesPath(path, rule)),
    );
  const validationResults = await Promise.all(
    input.caseItem.validators.map((argv) =>
      runTrustedArgv(input.cwd, argv, input.caseItem.timeoutMs),
    ),
  );
  const assertionPassed = await runTrustedArgv(
    input.cwd,
    input.caseItem.requiredAssertion.argv,
    input.caseItem.timeoutMs,
  );
  const clarificationCorrect =
    (input.caseItem.expectedClarification === "required") ===
    input.observedClarification;
  const modelError = input.modelFailed;
  const modelFailed = modelError !== undefined;
  const taskSuccess =
    !modelFailed &&
    validationResults.every(Boolean) &&
    assertionPassed &&
    !forbiddenViolation &&
    !scopeViolation &&
    clarificationCorrect;
  const { diff, insertions, deletions, binaryFiles } = await diffMetrics(
    input.cwd,
    touchedPaths,
  );
  const errorCode =
    modelError ??
    (!validationResults.every(Boolean) || forbiddenViolation || scopeViolation
      ? "VALIDATION_FAILED"
      : !assertionPassed || !clarificationCorrect
        ? "ASSERTION_FAILED"
        : "NONE");
  return {
    caseId: input.caseItem.id,
    arm: input.arm,
    order: input.order,
    status: taskSuccess ? "completed" : "failed",
    errorCode: taskSuccess ? "NONE" : errorCode,
    taskSuccess,
    validationPassed: validationResults.filter(Boolean).length,
    validationTotal: validationResults.length,
    assertionPassed: assertionPassed ? 1 : 0,
    assertionTotal: 1,
    forbiddenViolation,
    scopeViolation,
    expectedClarification: input.caseItem.expectedClarification,
    observedClarification: input.observedClarification,
    touchedPaths,
    touchedCount: touchedPaths.length,
    diff: { sha256: diff, insertions, deletions, binaryFiles },
    implementationLatencyMs: Math.min(
      300_000,
      Math.max(0, Math.round(input.implementationLatencyMs)),
    ),
    treatmentCompilationLatencyMs:
      input.treatmentCompilationLatencyMs === null
        ? null
        : Math.min(
            300_000,
            Math.max(0, Math.round(input.treatmentCompilationLatencyMs)),
          ),
    turns: input.turns,
    toolCalls: input.toolCalls,
    repeatedMutations: input.repeatedMutations,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costUsd: input.costUsd,
    blockedSafety: input.blockedSafety,
    responseLanguageSafety: "unavailable",
    fixtureRevision: input.fixtureRevision,
    fixtureTree: input.fixtureTree,
  };
}

async function diffMetrics(cwd: string, paths: readonly string[]) {
  const patch = await git(cwd, ["diff", "--binary", "HEAD", "--"]);
  const numstat = await git(cwd, ["diff", "--numstat", "HEAD", "--"]);
  let insertions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [added, removed] = line.split("\t");
    if (added === "-" || removed === "-") binaryFiles++;
    else {
      insertions += Number(added);
      deletions += Number(removed);
    }
  }
  const tracked = new Set(
    (await git(cwd, ["ls-files", "-z"])).split("\0").filter(Boolean),
  );
  const extra: Buffer[] = [];
  for (const path of paths.filter((item) => !tracked.has(item))) {
    const data = await readFile(join(cwd, path));
    extra.push(Buffer.from(`\0${path}\0`), data);
    if (data.includes(0)) binaryFiles++;
    else insertions += data.toString("utf8").split("\n").length - 1;
  }
  return {
    diff: createHash("sha256")
      .update(patch)
      .update(Buffer.concat(extra))
      .digest("hex"),
    insertions,
    deletions,
    binaryFiles,
  };
}

export function deterministicImplementationOrders(
  cases: readonly ImplementationCaseV1[],
  seed: string,
): Map<string, [ImplementationArm, ImplementationArm]> {
  const ranked = [...cases].sort((a, b) =>
    sha256(`${seed}\0${a.id}`).localeCompare(sha256(`${seed}\0${b.id}`)),
  );
  return new Map(
    ranked.map((item, index) => [
      item.id,
      index % 2 === 0
        ? (["control", "treatment"] as const)
        : (["treatment", "control"] as const),
    ]),
  );
}

export function implementationCorpusHash(
  cases: readonly ImplementationCaseV1[],
): string {
  return sha256(JSON.stringify(cases));
}

export function createImplementationOutcomeReport(input: {
  runConfigHash: string;
  pi: ImplementationOutcomeReportV1["pi"];
  bridge: ImplementationOutcomeReportV1["bridge"];
  corpusHash: string;
  seed: string;
  policyHash: string;
  pairs: ImplementationCasePairV1[];
}): ImplementationOutcomeReportV1 {
  const orderedCaseIds = input.pairs.map((pair) => pair.caseId);
  return parseImplementationOutcomeReportV1({
    version: IMPLEMENTATION_OUTCOME_VERSION,
    runner: IMPLEMENTATION_OUTCOME_RUNNER,
    runConfigHash: input.runConfigHash,
    pi: input.pi,
    bridge: input.bridge,
    corpus: { sha256: input.corpusHash, orderedCaseIds },
    seed: input.seed,
    order: orderedCaseIds,
    isolation: {
      mode: "external-policy-sandbox",
      policyHash: input.policyHash,
    },
    ownerReview: "not_reviewed",
    pairs: input.pairs,
    aggregates: aggregateImplementationOutcomes(input.pairs),
  });
}

export async function writeImplementationOutcomeReport(
  path: string,
  report: ImplementationOutcomeReportV1,
): Promise<void> {
  const visit = (value: unknown, key = ""): unknown => {
    if (typeof value === "string")
      return /^(?:provider|model|promptVersion|policyVersion|seed)$/.test(key)
        ? redactSecrets(value).text
        : value;
    if (Array.isArray(value)) return value.map((item) => visit(item, key));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, item]) => [
          name,
          visit(item, name),
        ]),
      );
    return value;
  };
  const safe = parseImplementationOutcomeReportV1(
    visit(parseImplementationOutcomeReportV1(report)),
  );
  const serialized = `${JSON.stringify(safe, null, 2)}\n`;
  const file = await open(path, "wx", 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(serialized);
  } finally {
    await file.close();
  }
}
