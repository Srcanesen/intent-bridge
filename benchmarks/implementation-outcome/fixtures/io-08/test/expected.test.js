import test from "node:test";
import assert from "node:assert/strict";
import { unique } from "../src/index.js";
test("deduplicates without dependency", () =>
  assert.deepEqual(unique([1, 1, 2]), [1, 2]));
