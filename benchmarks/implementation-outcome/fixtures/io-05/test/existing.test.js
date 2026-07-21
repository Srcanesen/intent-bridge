import test from "node:test";
import assert from "node:assert/strict";
import { clamp } from "../src/index.js";
test("middle", () => assert.equal(clamp(5), 5));
