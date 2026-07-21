import test from "node:test";
import assert from "node:assert/strict";
import { increment } from "../src/index.js";
test("increments once", () => assert.equal(increment(1), 2));
