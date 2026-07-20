import { lstat, readFile, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import type { ContextConfigV1 } from "./config.js";
import type { ProjectContext } from "./contracts.js";
import { BridgeError } from "./errors.js";
import { redactSecrets } from "./privacy.js";

export type ContextExclusionReason =
  | "disabled"
  | "untrusted"
  | "missing"
  | "denied"
  | "symlink"
  | "outside-root"
  | "duplicate"
  | "file-budget"
  | "total-budget";
export interface ContextManifestEntryV1 {
  path: string;
  included: boolean;
  reason?: ContextExclusionReason;
  originalCharacters?: number;
  keptCharacters?: number;
  truncated?: boolean;
  redactions?: number;
}
export interface ContextManifestV1 {
  totalCharacters: number;
  redactionCount: number;
  entries: ContextManifestEntryV1[];
}
export interface CollectedProjectContext {
  context: ProjectContext;
  manifest: ContextManifestV1;
}

export function isDeniedContextPath(path: string): boolean {
  const parts = path.replace(/\\/g, "/").split("/");
  const name = parts.at(-1)?.toLowerCase() ?? "";
  return (
    parts.some((part) =>
      ["node_modules", ".git", "dist", "build"].includes(part.toLowerCase()),
    ) ||
    name === ".env" ||
    name.startsWith(".env.") ||
    /(?:\.pem|\.key)$|^(?:credentials|secrets)|^auth\.json$/i.test(name)
  );
}
async function findRoot(cwd: string): Promise<string | undefined> {
  let current = resolve(cwd);
  while (true) {
    try {
      if ((await stat(join(current, ".git"))).isDirectory()) return current;
    } catch {}
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
function clipped(
  text: string,
  limit: number,
): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const marker = "\n[TRUNCATED]";
  return {
    text:
      limit >= marker.length
        ? `${text.slice(0, limit - marker.length)}${marker}`
        : marker.slice(0, limit),
    truncated: true,
  };
}
export function contextReadByteLimit(maxFileCharacters: number): number {
  return Math.max(64 * 1024, maxFileCharacters * 4);
}
async function safeRead(
  path: string,
  root: string | undefined,
  external: boolean,
  byteLimit: number,
): Promise<{
  text: string;
  reason?: ContextExclusionReason;
  resolved?: string;
}> {
  if (isDeniedContextPath(path)) return { text: "", reason: "denied" };
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return { text: "", reason: "symlink" };
    const resolved = await realpath(path);
    if (
      !external &&
      root &&
      (relative(root, resolved).startsWith("..") ||
        isAbsolute(relative(root, resolved)))
    )
      return { text: "", reason: "outside-root" };
    if ((await stat(resolved)).size > byteLimit)
      return { text: "", reason: "file-budget" };
    return { text: await readFile(resolved, "utf8"), resolved };
  } catch {
    return { text: "", reason: "missing" };
  }
}

export async function collectProjectContext(options: {
  cwd: string;
  repoRoot?: string;
  projectTrusted: boolean;
  config: ContextConfigV1;
  configDirName?: string;
  globalInstructionPath?: string;
}): Promise<CollectedProjectContext> {
  const requestedRoot = options.repoRoot
    ? resolve(options.repoRoot)
    : ((await findRoot(options.cwd)) ?? resolve(options.cwd));
  const root = requestedRoot
    ? await realpath(requestedRoot).catch(() => requestedRoot)
    : undefined;
  const name = basename(root ?? resolve(options.cwd));
  const manifest: ContextManifestV1 = {
    totalCharacters: 0,
    redactionCount: 0,
    entries: [],
  };
  const context: ProjectContext = { name, instructionExcerpts: [] };
  if (!options.config.enabled) {
    manifest.entries.push({
      path: "project",
      included: false,
      reason: "disabled",
    });
    return { context, manifest };
  }
  if (!options.projectTrusted)
    manifest.entries.push({
      path: "project",
      included: false,
      reason: "untrusted",
    });
  const seen = new Set<string>();
  const candidates: Array<{
    path: string;
    kind: "summary" | "instruction";
    external?: boolean;
  }> = [];
  if (root && options.configDirName && options.projectTrusted)
    candidates.push({
      path: join(root, options.configDirName, "intent-bridge", "project.md"),
      kind: "summary",
    });
  if (root) {
    let current = await realpath(resolve(options.cwd)).catch(() =>
      resolve(options.cwd),
    );
    while (true) {
      for (const file of ["AGENTS.md", "CLAUDE.md"])
        candidates.push({ path: join(current, file), kind: "instruction" });
      if (current === root) break;
      const parent = dirname(current);
      if (parent === current || !resolve(current).startsWith(root)) break;
      current = parent;
    }
  }
  if (options.globalInstructionPath)
    candidates.push({
      path: options.globalInstructionPath,
      kind: "instruction",
      external: true,
    });
  for (const candidate of candidates) {
    const label = candidate.external
      ? candidate.path
      : root
        ? relative(root, candidate.path)
        : candidate.path;
    const read = await safeRead(
      candidate.path,
      root,
      !!candidate.external,
      contextReadByteLimit(options.config.maxFileCharacters),
    );
    if (read.reason || !read.resolved) {
      manifest.entries.push({
        path: label,
        included: false,
        ...(read.reason ? { reason: read.reason } : {}),
      });
      continue;
    }
    if (seen.has(read.resolved)) {
      manifest.entries.push({
        path: label,
        included: false,
        reason: "duplicate",
      });
      continue;
    }
    seen.add(read.resolved);
    let redacted: ReturnType<typeof redactSecrets>;
    try {
      redacted = redactSecrets(read.text);
    } catch (cause) {
      throw new BridgeError({
        code: "CONTEXT_REDACTION_FAILED",
        safeMessage: "Project context could not be redacted safely.",
        retryable: false,
        cause,
      });
    }
    const file = clipped(redacted.text, options.config.maxFileCharacters);
    const remaining = options.config.maxCharacters - manifest.totalCharacters;
    if (remaining <= 0) {
      manifest.entries.push({
        path: label,
        included: false,
        reason: "total-budget",
      });
      continue;
    }
    const total = clipped(file.text, remaining);
    manifest.totalCharacters += total.text.length;
    manifest.redactionCount += redacted.count;
    manifest.entries.push({
      path: label,
      included: true,
      originalCharacters: read.text.length,
      keptCharacters: total.text.length,
      truncated: file.truncated || total.truncated,
      redactions: redacted.count,
    });
    if (candidate.kind === "summary") context.summary = total.text;
    else context.instructionExcerpts.push(total.text);
  }
  return { context, manifest };
}
