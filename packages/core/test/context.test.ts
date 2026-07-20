import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectProjectContext,
  contextReadByteLimit,
  isDeniedContextPath,
} from "../src/index.js";

const config = { enabled: true, maxCharacters: 12000, maxFileCharacters: 6000 };
async function project() {
  const root = await mkdtemp(join(tmpdir(), "context-"));
  await mkdir(join(root, ".git"));
  return root;
}
describe("bounded project context", () => {
  it("applies consent and trust separately to summaries and instructions", async () => {
    const root = await project();
    await mkdir(join(root, ".pi", "intent-bridge"), { recursive: true });
    await writeFile(
      join(root, ".pi", "intent-bridge", "project.md"),
      "summary",
    );
    await writeFile(join(root, "AGENTS.md"), "instructions");
    const disabled = await collectProjectContext({
      cwd: root,
      repoRoot: root,
      projectTrusted: true,
      config: { ...config, enabled: false },
      configDirName: ".pi",
    });
    expect(disabled.context).toEqual({
      name: root.split("/").at(-1),
      instructionExcerpts: [],
    });
    expect(disabled.manifest.entries[0]?.reason).toBe("disabled");
    const untrusted = await collectProjectContext({
      cwd: root,
      repoRoot: root,
      projectTrusted: false,
      config,
      configDirName: ".pi",
    });
    expect(untrusted.context).toEqual({
      name: root.split("/").at(-1),
      instructionExcerpts: ["instructions"],
    });
    expect(untrusted.context.summary).toBeUndefined();
    expect(untrusted.manifest.entries[0]?.reason).toBe("untrusted");
    const trusted = await collectProjectContext({
      cwd: root,
      repoRoot: root,
      projectTrusted: true,
      config,
      configDirName: ".pi",
    });
    expect(trusted.context).toMatchObject({
      summary: "summary",
      instructionExcerpts: ["instructions"],
    });
  });
  it("uses summary then closest instructions, with deterministic character budgets", async () => {
    const root = await project();
    await mkdir(join(root, ".pi", "intent-bridge"), { recursive: true });
    await writeFile(
      join(root, ".pi", "intent-bridge", "project.md"),
      "summary",
    );
    await writeFile(join(root, "AGENTS.md"), "parent");
    const cwd = join(root, "child");
    await mkdir(cwd);
    await writeFile(join(cwd, "CLAUDE.md"), "closest");
    const result = await collectProjectContext({
      cwd,
      repoRoot: root,
      projectTrusted: true,
      config: { ...config, maxCharacters: 30, maxFileCharacters: 6000 },
      configDirName: ".pi",
    });
    expect(result.manifest.entries[0]?.reason).toBeUndefined();
    expect(result.context.summary).toBe("summary");
    expect(result.context.instructionExcerpts).toEqual(["closest", "parent"]);
    expect(result.manifest.totalCharacters).toBe(20);
  });
  it("uses explicit truncation markers and redacts collected content", async () => {
    const root = await project();
    await writeFile(
      join(root, "AGENTS.md"),
      "Bearer abcdefghijklmnop xxxxxxxxxxxxxxxxxxxx",
    );
    const result = await collectProjectContext({
      cwd: root,
      repoRoot: root,
      projectTrusted: true,
      config: { ...config, maxCharacters: 20, maxFileCharacters: 20 },
    });
    expect(result.context.instructionExcerpts[0]).toContain("[TRUNCATED]");
    expect(result.context.instructionExcerpts[0]).not.toContain(
      "abcdefghijklmnop",
    );
    expect(result.manifest.redactionCount).toBe(1);
  });
  it("does not collect source files and denies sensitive paths", async () => {
    const root = await project();
    await writeFile(join(root, "index.ts"), "source");
    const result = await collectProjectContext({
      cwd: root,
      repoRoot: root,
      projectTrusted: true,
      config,
    });
    expect(result.context.instructionExcerpts).toEqual([]);
    for (const path of [
      ".env",
      ".env.local",
      "x.pem",
      "x.key",
      "credentials.txt",
      "secrets.json",
      "auth.json",
      "node_modules/a",
      ".git/a",
      "dist/a",
      "build/a",
    ])
      expect(isDeniedContextPath(path)).toBe(true);
  });
  it("rejects symlink escapes", async () => {
    const root = await project();
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    await writeFile(join(outside, "AGENTS.md"), "outside");
    await symlink(join(outside, "AGENTS.md"), join(root, "AGENTS.md"));
    const result = await collectProjectContext({
      cwd: root,
      repoRoot: root,
      projectTrusted: true,
      config,
    });
    expect(result.context.instructionExcerpts).toEqual([]);
    expect(
      result.manifest.entries.some((entry) => entry.reason === "symlink"),
    ).toBe(true);
  });
  it("deduplicates an explicit global instruction without a symlink", async () => {
    const root = await project();
    const path = join(root, "AGENTS.md");
    await writeFile(path, "instructions");
    const result = await collectProjectContext({
      cwd: root,
      repoRoot: root,
      projectTrusted: true,
      config,
      globalInstructionPath: path,
    });
    expect(result.context.instructionExcerpts).toEqual(["instructions"]);
    expect(
      result.manifest.entries.some((entry) => entry.reason === "duplicate"),
    ).toBe(true);
  });
  it("excludes huge files before reading and truncates regular oversized files", async () => {
    const root = await project();
    await writeFile(
      join(root, "AGENTS.md"),
      "x".repeat(contextReadByteLimit(20) + 1),
    );
    await writeFile(join(root, "CLAUDE.md"), "y".repeat(21));
    const result = await collectProjectContext({
      cwd: root,
      repoRoot: root,
      projectTrusted: true,
      config: { ...config, maxFileCharacters: 20 },
    });
    expect(
      result.manifest.entries.find((entry) => entry.path === "AGENTS.md"),
    ).toMatchObject({ included: false, reason: "file-budget" });
    expect(
      result.manifest.entries.find((entry) => entry.path === "CLAUDE.md"),
    ).toMatchObject({ included: true, truncated: true });
    expect(result.context.instructionExcerpts).toEqual([
      "yyyyyyyy\n[TRUNCATED]",
    ]);
  });
  it("uses cwd as the discovery root without a git root", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "context-"));
    await writeFile(join(cwd, "AGENTS.md"), "instructions");
    await expect(
      collectProjectContext({ cwd, projectTrusted: true, config }),
    ).resolves.toMatchObject({
      context: {
        name: cwd.split("/").at(-1),
        instructionExcerpts: ["instructions"],
      },
    });
  });
  it("accounts unicode JavaScript characters and marks truncation", async () => {
    const root = await project();
    await writeFile(join(root, "AGENTS.md"), "😀abcdef");
    const result = await collectProjectContext({
      cwd: root,
      repoRoot: root,
      projectTrusted: true,
      config: { ...config, maxCharacters: 20, maxFileCharacters: 20 },
    });
    expect(result.manifest.totalCharacters).toBe(8);
    expect(result.context.instructionExcerpts[0]).toBe("😀abcdef");
  });
});
