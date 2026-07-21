import test from "node:test";
import assert from "node:assert/strict";
import { first } from "../src/index.js";
test("empty is null", () => assert.equal(first([]), null));
