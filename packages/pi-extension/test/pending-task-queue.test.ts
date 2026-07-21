import { describe, expect, it, vi } from "vitest";

import {
  PendingTaskQueue,
  type PendingTaskDiagnostic,
} from "../src/pending-task-queue.js";

function setup(options: { ttlMs?: number; capacity?: number } = {}) {
  let now = 100;
  const diagnostics: PendingTaskDiagnostic[] = [];
  const queue = new PendingTaskQueue({
    now: () => now,
    diagnostic: (entry) => diagnostics.push(entry),
    ...options,
  });
  return { queue, diagnostics, setNow: (value: number) => (now = value) };
}

describe("PendingTaskQueue", () => {
  it("reserves, marks ready, and consumes exactly once", () => {
    const { queue } = setup();
    const reservation = queue.reserve("prompt", 0, "trace-1");
    expect(queue.markReady(reservation, "compiled")).toBe(true);
    expect(queue.consumeForAgentStart("prompt", 0, 100)).toBe("compiled");
    expect(queue.consumeForAgentStart("prompt", 0, 100)).toBeNull();
  });

  it("consumes duplicate occurrences FIFO", () => {
    const { queue } = setup();
    const first = queue.reserve("same", 0, "trace-1");
    const second = queue.reserve("same", 0, "trace-2");
    queue.markReady(first, "first");
    queue.markReady(second, "second");
    expect(queue.consumeForAgentStart("same", 0, 100)).toBe("first");
    expect(queue.consumeForAgentStart("same", 0, 100)).toBe("second");
  });

  it("keeps a skipped duplicate occurrence as a no-injection outcome", () => {
    const { queue } = setup();
    const first = queue.reserve("same", 0, "trace-1");
    const second = queue.reserve("same", 0, "trace-2");
    expect(queue.skip(first)).toBe(true);
    expect(queue.markReady(second, "second")).toBe(true);
    expect(queue.consumeForAgentStart("same", 0, 100)).toBeNull();
    expect(queue.consumeForAgentStart("same", 0, 100)).toBe("second");
  });

  it("consumes one expired duplicate without deleting the later occurrence at reserve", () => {
    const { queue, diagnostics, setNow } = setup({ ttlMs: 10 });
    const first = queue.reserve("same", 0, "trace-1");
    queue.markReady(first, "first");
    setNow(110);
    const second = queue.reserve("same", 0, "trace-2");
    queue.markReady(second, "second");
    expect(queue.consumeForAgentStart("same", 0, 110)).toBeNull();
    expect(diagnostics.map(({ reason }) => reason)).toEqual(["expired"]);
    expect(queue.consumeForAgentStart("same", 0, 110)).toBe("second");
  });

  it("removes an unready duplicate on its one occurrence", () => {
    const { queue, diagnostics } = setup();
    const first = queue.reserve("same", 0, "trace-1");
    const second = queue.reserve("same", 0, "trace-2");
    queue.markReady(second, "second");
    expect(queue.consumeForAgentStart("same", 0, 100)).toBeNull();
    expect(queue.consumeForAgentStart("same", 0, 100)).toBe("second");
    expect(queue.markReady(first, "first")).toBe(false);
    expect(diagnostics.map(({ reason }) => reason)).toEqual([
      "correlation_miss",
    ]);
  });

  it("correlates different prompts independently", () => {
    const { queue } = setup();
    const a = queue.reserve("A", 0, "trace-a");
    const b = queue.reserve("B", 0, "trace-b");
    queue.markReady(a, "compiled A");
    queue.markReady(b, "compiled B");
    expect(queue.consumeForAgentStart("B", 0, 100)).toBe("compiled B");
    expect(queue.consumeForAgentStart("A", 0, 100)).toBe("compiled A");
  });

  it("cancel physically removes only the handled occurrence", () => {
    const { queue } = setup();
    const first = queue.reserve("same", 0, "trace-1");
    const second = queue.reserve("same", 0, "trace-2");
    expect(queue.cancel(first)).toBe(true);
    expect(queue.markReady(first, "first")).toBe(false);
    expect(queue.markReady(second, "second")).toBe(true);
    expect(queue.consumeForAgentStart("same", 0, 100)).toBe("second");
  });

  it("quarantines on capacity overflow until clear", () => {
    const { queue, diagnostics } = setup({ capacity: 2 });
    const first = queue.reserve("same", 0, "trace-a");
    const second = queue.reserve("same", 0, "trace-b");
    queue.markReady(first, "first");
    queue.markReady(second, "second");
    const rejected = queue.reserve("same", 0, "trace-c");
    expect(diagnostics[0]).toMatchObject({
      reason: "capacity_eviction",
      sequence: first,
      traceId: "trace-a",
      status: "ready",
    });
    expect(queue.markReady(rejected, "third")).toBe(false);
    expect(queue.consumeForAgentStart("same", 0, 100)).toBeNull();
    expect(queue.consumeForAgentStart("same", 0, 100)).toBeNull();
    expect(queue.consumeForAgentStart("same", 0, 100)).toBeNull();

    const quarantined = queue.reserve("same", 0, "trace-d");
    expect(queue.markReady(quarantined, "fourth")).toBe(false);
    expect(queue.consumeForAgentStart("same", 0, 100)).toBeNull();
    expect(
      diagnostics.filter(({ reason }) => reason === "capacity_eviction"),
    ).toHaveLength(2);

    queue.clear();
    const recovered = queue.reserve("same", 0, "trace-e");
    expect(queue.markReady(recovered, "recovered")).toBe(true);
    expect(queue.consumeForAgentStart("same", 0, 100)).toBe("recovered");
  });

  it("returns null on a miss, leaves unrelated entries, and emits bounded diagnostics", () => {
    const { queue, diagnostics } = setup();
    const reservation = queue.reserve("private prompt", 0, "trace-1");
    queue.markReady(reservation, "private compiled content");
    expect(queue.consumeForAgentStart("other", 0, 100)).toBeNull();
    expect(queue.consumeForAgentStart("private prompt", 0, 100)).toBe(
      "private compiled content",
    );
    const serialized = JSON.stringify(diagnostics);
    expect(diagnostics[0]).toEqual({
      reason: "correlation_miss",
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("private compiled content");
  });

  it("clears all session entries with prompt-free diagnostics", () => {
    const { queue, diagnostics } = setup();
    const reservation = queue.reserve("private prompt", 0, "trace-1");
    queue.markReady(reservation, "private compiled content");
    queue.clear();
    expect(queue.consumeForAgentStart("private prompt", 0, 100)).toBeNull();
    expect(diagnostics[0]).toEqual(
      expect.objectContaining({
        reason: "session_reset",
        sequence: reservation,
        traceId: "trace-1",
        status: "ready",
      }),
    );
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /private prompt|private compiled content/,
    );
  });

  it("does not cross-match the same prompt with different image counts", () => {
    const { queue } = setup();
    const noImages = queue.reserve("prompt", 0, "trace-0");
    const oneImage = queue.reserve("prompt", 1, "trace-1");
    queue.markReady(noImages, "zero");
    queue.markReady(oneImage, "one");
    expect(queue.consumeForAgentStart("prompt", 2, 100)).toBeNull();
    expect(queue.consumeForAgentStart("prompt", 1, 100)).toBe("one");
    expect(queue.consumeForAgentStart("prompt", 0, 100)).toBe("zero");
  });

  it("never serializes prompt or compiled content in any diagnostic", () => {
    const diagnostic = vi.fn();
    const queue = new PendingTaskQueue({
      now: () => 0,
      ttlMs: 1,
      capacity: 1,
      diagnostic,
    });
    const first = queue.reserve("PROMPT_SECRET", 0, "trace-1");
    queue.markReady(first, "CONTENT_SECRET");
    queue.reserve("other", 0, "trace-2");
    queue.consumeForAgentStart("missing", 0, 2);
    queue.clear();
    const serialized = JSON.stringify(diagnostic.mock.calls);
    expect(serialized).not.toContain("PROMPT_SECRET");
    expect(serialized).not.toContain("CONTENT_SECRET");
  });
});
