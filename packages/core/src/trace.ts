import { chmod, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { LoggingConfigV1 } from "./config.js";
import type { BridgeTraceV1 } from "./contracts.js";
import { BridgeError } from "./errors.js";
import { projectTrace } from "./privacy.js";
import type { TraceSink } from "./pipeline.js";

const datedFile = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

function dateFile(now: Date): string {
  return `${now.toISOString().slice(0, 10)}.jsonl`;
}

function dateFromFile(name: string): number | undefined {
  const match = datedFile.exec(name);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const date = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return new Date(date).toISOString().slice(0, 10) === `${year}-${month}-${day}`
    ? date
    : undefined;
}

export class JsonlTraceWriter implements TraceSink {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly logsDir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  append(
    trace: BridgeTraceV1,
    logging: Pick<LoggingConfigV1, "mode">,
  ): Promise<void> {
    const projected = projectTrace(logging, trace);
    if (projected === undefined) return Promise.resolve();
    return this.enqueue(async () => {
      try {
        await mkdir(this.logsDir, { recursive: true, mode: 0o700 });
        await chmod(this.logsDir, 0o700);
        const file = await open(
          join(this.logsDir, dateFile(this.now())),
          "a",
          0o600,
        );
        try {
          await file.chmod(0o600);
          await file.writeFile(`${JSON.stringify(projected)}\n`, "utf8");
          await file.chmod(0o600);
        } finally {
          await file.close();
        }
      } catch (cause) {
        throw new BridgeError({
          code: "TRACE_WRITE_FAILED",
          safeMessage: "The local trace could not be recorded.",
          retryable: true,
          cause,
        });
      }
    });
  }

  prune(retentionDays: number): Promise<void> {
    const cutoff = Date.UTC(
      this.now().getUTCFullYear(),
      this.now().getUTCMonth(),
      this.now().getUTCDate() - retentionDays,
    );
    return this.enqueue(async () => {
      try {
        for (const entry of await readdir(this.logsDir, {
          withFileTypes: true,
        })) {
          const date = entry.isFile() ? dateFromFile(entry.name) : undefined;
          if (date !== undefined && date < cutoff)
            await unlink(join(this.logsDir, entry.name));
        }
      } catch (cause) {
        throw new BridgeError({
          code: "TRACE_WRITE_FAILED",
          safeMessage: "Local trace retention could not be completed.",
          retryable: true,
          cause,
        });
      }
    });
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
