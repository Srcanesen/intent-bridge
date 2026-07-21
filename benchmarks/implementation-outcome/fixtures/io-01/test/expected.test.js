import test from "node:test";
import assert from "node:assert/strict";
import { add } from "../src/index.js";
test("adds", () => assert.equal(add(2, 3), 5));
