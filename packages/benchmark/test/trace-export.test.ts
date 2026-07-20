import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PiCompilerV1, type BridgeTraceV1 } from "@intent-bridge/core";
import { describe, expect, it } from "vitest";
import { exportTraces, parseBenchmarkCaseV1 } from "../src/index.js";
import { makeIntent } from "./helpers.js";

const fullTrace = (traceId: string, input = "Fix login") => {
  const intent = makeIntent();
  const compiledTask = new PiCompilerV1().compile({
    intent,
    originalText: input,
    attachmentSummary: { imageCount: 0 },
  });
  return {
    version: 1,
    traceId,
    timestamp: "2025-01-01T00:00:00.000Z",
    messageType: "initial",
    mode: "auto",
    status: "success",
    content: { originalText: input, intent, compiledTask },
  } satisfies BridgeTraceV1;
};
const temp = () => mkdtemp(join(tmpdir(), "intent-bridge-export-"));

describe("trace export", () => {
  it("exports selected full traces only, skips malformed/metadata/rating lines, and deduplicates trace ids", async () => {
    const dir = await temp();
    const input = join(dir, "trace.jsonl");
    const out = join(dir, "out");
    await writeFile(
      input,
      [
        JSON.stringify(fullTrace("selected/id")),
        JSON.stringify(fullTrace("selected/id")),
        JSON.stringify(fullTrace("other")),
        JSON.stringify({ ...fullTrace("metadata"), content: undefined }),
        JSON.stringify({ traceId: "rating", userRating: "good" }),
        "{malformed",
      ].join("\n"),
    );
    const cases = await exportTraces(input, out, ["selected/id"]);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.tags).toEqual(["trace-export", "needs-review"]);
    expect(cases[0]?.expected.requiredGoalConcepts).toEqual([]);
    expect(parseBenchmarkCaseV1(cases[0])).toEqual(cases[0]);
    const files = await readdir(out);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^trace-[A-Za-z0-9_-]+\.json$/);
  });

  it("redacts synthetic secrets before writing generated fixtures", async () => {
    const dir = await temp();
    const input = join(dir, "trace.jsonl");
    const out = join(dir, "out");
    await writeFile(
      input,
      JSON.stringify(
        fullTrace("secret", "token=EXAMPLE_NOT_A_SECRET_EXPORT_123456"),
      ),
    );
    const cases = await exportTraces(input, out);
    expect(cases[0]?.input).toBe("[REDACTED]");
    const files = await readdir(out);
    const written = files[0] ? await readFile(join(out, files[0]), "utf8") : "";
    expect(written).not.toContain("EXAMPLE_NOT_A_SECRET_EXPORT_123456");
  });

  it("gives colliding sanitized trace ids distinct safe filenames", async () => {
    const dir = await temp();
    const input = join(dir, "trace.jsonl");
    const out = join(dir, "out");
    await writeFile(
      input,
      `${JSON.stringify(fullTrace("a/b"))}\n${JSON.stringify(fullTrace("a?b"))}\n`,
    );
    const cases = await exportTraces(input, out);
    expect(new Set(cases.map((item) => item.id)).size).toBe(2);
    expect(await readdir(out)).toHaveLength(2);
  });
});
