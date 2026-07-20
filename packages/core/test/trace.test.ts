import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type BridgeTraceV1, JsonlTraceWriter } from "../src/index.js";

const directories: string[] = [];
const tempDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "intent-bridge-"));
  directories.push(directory);
  return directory;
};
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

const trace = (): BridgeTraceV1 => ({
  version: 1,
  traceId: "trace-1",
  timestamp: "2026-07-19T12:00:00.000Z",
  mode: "auto",
  status: "success",
});

const fullTrace = (): BridgeTraceV1 => ({
  ...trace(),
  content: {
    originalText: "original secret=abcdefgh",
    contextManifest: { apiKey: "secret-value", nested: "safe" },
  },
});

describe("JsonlTraceWriter", () => {
  it("projects metadata, sanitizes full content, and skips off", async () => {
    const root = await tempDirectory();
    const writer = new JsonlTraceWriter(
      join(root, "logs"),
      () => new Date("2026-07-19T12:00:00.000Z"),
    );

    await writer.append(trace(), { mode: "metadata" });
    const metadata = await readFile(
      join(root, "logs", "2026-07-19.jsonl"),
      "utf8",
    );
    expect(metadata).not.toContain("original");
    expect(metadata).not.toContain("content");

    await writer.append(fullTrace(), { mode: "full" });
    const lines = (
      await readFile(join(root, "logs", "2026-07-19.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines[1].content.contextManifest.apiKey).toBe("[REDACTED]");
    await writer.append(trace(), { mode: "off" });
    expect(
      (await readFile(join(root, "logs", "2026-07-19.jsonl"), "utf8"))
        .trim()
        .split("\n"),
    ).toHaveLength(2);
  });

  it("does not create a directory when logging is off", async () => {
    const root = await tempDirectory();
    await new JsonlTraceWriter(join(root, "logs")).append(trace(), {
      mode: "off",
    });
    await expect(stat(join(root, "logs"))).rejects.toThrow();
  });

  it("writes valid non-interleaved JSONL with UTC names and private modes", async () => {
    const root = await tempDirectory();
    const logs = join(root, "logs");
    const writer = new JsonlTraceWriter(
      logs,
      () => new Date("2026-07-19T23:59:59.000Z"),
    );

    await Promise.all([
      writer.append(trace(), { mode: "metadata" }),
      writer.append({ ...trace(), traceId: "trace-2" }, { mode: "metadata" }),
    ]);
    const file = join(logs, "2026-07-19.jsonl");
    expect(
      (await readFile(file, "utf8")).trim().split("\n").map(JSON.parse),
    ).toHaveLength(2);
    if (process.platform !== "win32") {
      expect((await stat(logs)).mode & 0o777).toBe(0o700);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it("tightens pre-existing log paths before appending", async () => {
    const root = await tempDirectory();
    const logs = join(root, "logs");
    const file = join(logs, "2026-07-19.jsonl");
    await mkdir(logs, { mode: 0o755 });
    await writeFile(file, "old\n", { mode: 0o644 });
    await new JsonlTraceWriter(
      logs,
      () => new Date("2026-07-19T12:00:00.000Z"),
    ).append(trace(), { mode: "metadata" });
    if (process.platform !== "win32") {
      expect((await stat(logs)).mode & 0o777).toBe(0o700);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it("recovers its append queue after a filesystem failure", async () => {
    const root = await tempDirectory();
    const logs = join(root, "logs");
    await writeFile(logs, "not a directory");
    const writer = new JsonlTraceWriter(logs);

    await expect(
      writer.append(trace(), { mode: "metadata" }),
    ).rejects.toMatchObject({
      code: "TRACE_WRITE_FAILED",
    });
    await rm(logs);
    await expect(
      writer.append(trace(), { mode: "metadata" }),
    ).resolves.toBeUndefined();
  });

  it("prunes only dated files older than the UTC cutoff", async () => {
    const root = await tempDirectory();
    const logs = join(root, "logs");
    await mkdir(logs, { recursive: true });
    await Promise.all([
      writeFile(join(logs, "2026-07-16.jsonl"), "old\n"),
      writeFile(join(logs, "2026-07-17.jsonl"), "boundary\n"),
      writeFile(join(logs, "2026-07-19.jsonl"), "current\n"),
      writeFile(join(logs, "notes.jsonl"), "keep\n"),
    ]);
    const writer = new JsonlTraceWriter(
      logs,
      () => new Date("2026-07-19T12:00:00.000Z"),
    );

    await writer.prune(2);
    await expect(readFile(join(logs, "2026-07-16.jsonl"))).rejects.toThrow();
    await expect(
      readFile(join(logs, "2026-07-17.jsonl")),
    ).resolves.toBeTruthy();
    await expect(
      readFile(join(logs, "2026-07-19.jsonl")),
    ).resolves.toBeTruthy();
    await expect(readFile(join(logs, "notes.jsonl"))).resolves.toBeTruthy();
  });
});
