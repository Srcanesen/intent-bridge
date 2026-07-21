import test from "node:test";
import assert from "node:assert/strict";
import { safeJoin } from "../src/index.js";
test("rejects traversal", () =>
  assert.throws(() => safeJoin("/tmp/root", "../escape")));
test("accepts child", () =>
  assert.equal(safeJoin("/tmp/root", "child"), "/tmp/root/child"));
