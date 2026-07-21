import { createHash } from "node:crypto";

export const DEFAULT_PENDING_TASK_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_PENDING_TASK_CAPACITY = 20;
export const DEFAULT_PENDING_TASK_TOMBSTONE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_PENDING_TASK_TOMBSTONE_CAPACITY = 20;

interface PendingTaskTombstone {
  fingerprint: string;
  expiresAt: number;
}

export type PendingTaskDiagnosticReason =
  | "expired"
  | "capacity_eviction"
  | "session_reset"
  | "correlation_miss"
  | "fingerprint_collision";

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
  tombstoneTtlMs?: number;
  tombstoneCapacity?: number;
  diagnostic?: (diagnostic: PendingTaskDiagnostic) => void;
}

function fingerprint(prompt: string, imageCount: number): string {
  return createHash("sha256")
    .update(JSON.stringify([prompt, imageCount]))
    .digest("hex");
}

export class PendingTaskQueue {
  private readonly entries: PendingTaskEntry[] = [];
  private readonly tombstones: PendingTaskTombstone[] = [];
  private sequence = 0;
  private quarantined = false;
  private tombstoneOverflowUntil = 0;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly capacity: number;
  private readonly tombstoneTtlMs: number;
  private readonly tombstoneCapacity: number;
  private readonly diagnostic: (diagnostic: PendingTaskDiagnostic) => void;

  constructor(options: PendingTaskQueueOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_PENDING_TASK_TTL_MS;
    this.capacity = options.capacity ?? DEFAULT_PENDING_TASK_CAPACITY;
    this.tombstoneTtlMs =
      options.tombstoneTtlMs ?? DEFAULT_PENDING_TASK_TOMBSTONE_TTL_MS;
    this.tombstoneCapacity =
      options.tombstoneCapacity ?? DEFAULT_PENDING_TASK_TOMBSTONE_CAPACITY;
    this.diagnostic = options.diagnostic ?? (() => undefined);
  }

  reserve(prompt: string, imageCount: number, traceId: string): number {
    const sequence = ++this.sequence;
    const now = this.now();
    const entry: PendingTaskEntry = {
      sequence,
      traceId,
      fingerprint: fingerprint(prompt, imageCount),
      expiresAt: now + this.ttlMs,
      status: "reserved",
    };
    this.expire(now);
    if (this.quarantined || this.tombstoneOverflowUntil > now) {
      if (!this.quarantined) {
        this.tombstoneOverflowUntil = Math.max(
          this.tombstoneOverflowUntil,
          entry.expiresAt + this.tombstoneTtlMs,
        );
      }
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
    const collisions = this.entries.filter(
      (candidate) => candidate.fingerprint === entry.fingerprint,
    );
    if (collisions.length > 0) {
      for (const collision of collisions) {
        delete collision.compiledContent;
        collision.status = "skipped";
      }
      entry.status = "skipped";
      this.emit("fingerprint_collision", entry);
    } else if (
      this.tombstones.some(
        (tombstone) => tombstone.fingerprint === entry.fingerprint,
      )
    ) {
      entry.status = "skipped";
    }
    this.entries.push(entry);
    return sequence;
  }

  markReady(sequence: number, compiledContent: string): boolean {
    const now = this.now();
    this.expire(now);
    if (this.quarantined || this.tombstoneOverflowUntil > now) return false;
    const entry = this.entries.find(
      (candidate) => candidate.sequence === sequence,
    );
    if (!entry || entry.status !== "reserved") return false;
    entry.compiledContent = compiledContent;
    entry.status = "ready";
    return true;
  }

  skip(sequence: number): boolean {
    this.expire(this.now());
    const entry = this.entries.find(
      (candidate) => candidate.sequence === sequence,
    );
    if (!entry) return false;
    delete entry.compiledContent;
    entry.status = "skipped";
    return true;
  }

  cancel(sequence: number): boolean {
    this.expire(this.now());
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
    this.expire(now);
    if (this.quarantined || this.tombstoneOverflowUntil > now) {
      this.emitMiss(expected);
      return null;
    }
    const tombstone = this.tombstones.findIndex(
      (entry) => entry.fingerprint === expected,
    );
    if (tombstone >= 0) {
      this.tombstones.splice(tombstone, 1);
      return null;
    }
    const index = this.entries.findIndex(
      (entry) => entry.fingerprint === expected,
    );
    if (index < 0) {
      this.emitMiss(expected);
      return null;
    }
    const [entry] = this.entries.splice(index, 1);
    if (!entry) return null;
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
    this.tombstones.length = 0;
    this.quarantined = false;
    this.tombstoneOverflowUntil = 0;
  }

  private expire(now: number): void {
    for (let index = this.tombstones.length - 1; index >= 0; index--) {
      const tombstone = this.tombstones[index];
      if (tombstone && tombstone.expiresAt <= now) {
        this.tombstones.splice(index, 1);
      }
    }
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry = this.entries[index];
      if (!entry || entry.expiresAt > now) continue;
      if (this.tombstones.length >= this.tombstoneCapacity) {
        this.emit("capacity_eviction", entry);
        this.tombstoneOverflowUntil = Math.max(
          now + this.tombstoneTtlMs,
          ...this.entries.map(
            (candidate) => candidate.expiresAt + this.tombstoneTtlMs,
          ),
          ...this.tombstones.map((tombstone) => tombstone.expiresAt),
        );
        this.entries.length = 0;
        return;
      }
      this.entries.splice(index, 1);
      this.emit("expired", entry);
      this.tombstones.unshift({
        fingerprint: entry.fingerprint,
        expiresAt: now + this.tombstoneTtlMs,
      });
    }
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
