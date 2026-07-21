import { createHash } from "node:crypto";

export const DEFAULT_PENDING_TASK_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_PENDING_TASK_CAPACITY = 20;

export type PendingTaskDiagnosticReason =
  | "expired"
  | "capacity_eviction"
  | "session_reset"
  | "correlation_miss";

type PendingTaskStatus = "reserved" | "ready" | "skipped";

export interface PendingTaskDiagnostic {
  reason: PendingTaskDiagnosticReason;
  fingerprint: string;
  sequence?: number;
  traceId?: string;
  status?: PendingTaskStatus;
}

interface PendingTaskEntry {
  sequence: number;
  traceId: string;
  fingerprint: string;
  compiledContent?: string;
  expiresAt: number;
  status: PendingTaskStatus;
}

interface PendingTaskQueueOptions {
  now?: () => number;
  ttlMs?: number;
  capacity?: number;
  diagnostic?: (diagnostic: PendingTaskDiagnostic) => void;
}

function fingerprint(prompt: string, imageCount: number): string {
  return createHash("sha256")
    .update(JSON.stringify([prompt, imageCount]))
    .digest("hex");
}

export class PendingTaskQueue {
  private readonly entries: PendingTaskEntry[] = [];
  private sequence = 0;
  private quarantined = false;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly capacity: number;
  private readonly diagnostic: (diagnostic: PendingTaskDiagnostic) => void;

  constructor(options: PendingTaskQueueOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_PENDING_TASK_TTL_MS;
    this.capacity = options.capacity ?? DEFAULT_PENDING_TASK_CAPACITY;
    this.diagnostic = options.diagnostic ?? (() => undefined);
  }

  reserve(prompt: string, imageCount: number, traceId: string): number {
    const sequence = ++this.sequence;
    const entry: PendingTaskEntry = {
      sequence,
      traceId,
      fingerprint: fingerprint(prompt, imageCount),
      expiresAt: this.now() + this.ttlMs,
      status: "reserved",
    };
    if (this.quarantined) {
      this.emit("capacity_eviction", entry);
      return sequence;
    }
    if (this.entries.length >= this.capacity) {
      this.emit("capacity_eviction", this.entries[0] ?? entry);
      this.entries.length = 0;
      // ponytail: Session quarantine is the safe ceiling; host turn IDs would allow recovery without it.
      this.quarantined = true;
      return sequence;
    }
    this.entries.push(entry);
    return sequence;
  }

  markReady(sequence: number, compiledContent: string): boolean {
    if (this.quarantined) return false;
    const entry = this.entries.find(
      (candidate) => candidate.sequence === sequence,
    );
    if (!entry || entry.status !== "reserved") return false;
    entry.compiledContent = compiledContent;
    entry.status = "ready";
    return true;
  }

  skip(sequence: number): boolean {
    const entry = this.entries.find(
      (candidate) => candidate.sequence === sequence,
    );
    if (!entry) return false;
    delete entry.compiledContent;
    entry.status = "skipped";
    return true;
  }

  cancel(sequence: number): boolean {
    const index = this.entries.findIndex(
      (entry) => entry.sequence === sequence,
    );
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }

  consumeForAgentStart(
    prompt: string,
    imageCount: number,
    now: number,
  ): string | null {
    const expected = fingerprint(prompt, imageCount);
    if (this.quarantined) {
      this.emitMiss(expected);
      return null;
    }
    // Pi supplies no turn ID, so identical fingerprints rely on FIFO dispatch.
    const index = this.entries.findIndex(
      (entry) => entry.fingerprint === expected,
    );
    if (index < 0) {
      this.emitMiss(expected);
      return null;
    }
    const [entry] = this.entries.splice(index, 1);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.emit("expired", entry);
      return null;
    }
    if (entry.status === "skipped") return null;
    if (entry.status !== "ready" || entry.compiledContent === undefined) {
      this.emitMiss(expected, entry);
      return null;
    }
    return entry.compiledContent;
  }

  clear(): void {
    for (const entry of this.entries) this.emit("session_reset", entry);
    this.entries.length = 0;
    this.quarantined = false;
  }

  private emit(
    reason: PendingTaskDiagnosticReason,
    entry: PendingTaskEntry,
  ): void {
    this.diagnostic({
      reason,
      sequence: entry.sequence,
      traceId: entry.traceId,
      fingerprint: entry.fingerprint,
      status: entry.status,
    });
  }

  private emitMiss(fingerprint: string, entry?: PendingTaskEntry): void {
    this.diagnostic({
      reason: "correlation_miss",
      fingerprint,
      ...(entry
        ? {
            sequence: entry.sequence,
            traceId: entry.traceId,
            status: entry.status,
          }
        : {}),
    });
  }
}
