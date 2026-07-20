import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectTrace, type BridgeTraceV1 } from "@intent-bridge/core";
import { parseBenchmarkCaseV1, type BenchmarkCaseV1 } from "./contracts.js";

const safeTraceId = (traceId: string) => {
  const stem =
    traceId
      .replace(/[^a-z0-9_-]/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "trace";
  const hash = createHash("sha256").update(traceId).digest("hex").slice(0, 10);
  return `${stem}-${hash}`;
};

export async function exportTraces(
  path: string,
  out: string,
  ids?: readonly string[],
): Promise<BenchmarkCaseV1[]> {
  const selected = ids?.length ? new Set(ids) : undefined;
  const seen = new Set<string>();
  const cases: BenchmarkCaseV1[] = [];
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as BridgeTraceV1;
      const trace = projectTrace({ mode: "full" }, parsed);
      const input = trace?.content?.originalText;
      const intent = trace?.content?.intent;
      if (
        !trace ||
        trace.status !== "success" ||
        typeof input !== "string" ||
        !input ||
        !intent ||
        !trace.messageType ||
        (selected && !selected.has(trace.traceId)) ||
        seen.has(trace.traceId)
      )
        continue;
      seen.add(trace.traceId);
      const id = `trace-${safeTraceId(trace.traceId)}`;
      cases.push(
        parseBenchmarkCaseV1({
          version: 1,
          id,
          title: `Exported trace ${id} — review required`,
          language: intent.sourceLanguage.code,
          messageType: trace.messageType,
          input,
          expected: {
            requiredGoalConcepts: [],
            requiredConstraints: [],
            forbiddenAdditions: [],
            responseLanguage: intent.responseLanguage.code,
          },
          tags: ["trace-export", "needs-review"],
        }),
      );
    } catch {
      // Malformed and non-trace JSONL records are intentionally ignored.
    }
  }
  await mkdir(out, { recursive: true });
  await Promise.all(
    cases.map((item) =>
      writeFile(
        join(out, `${item.id}.json`),
        `${JSON.stringify(item, null, 2)}\n`,
      ),
    ),
  );
  return cases;
}
