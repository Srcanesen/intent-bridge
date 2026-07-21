import test from "node:test";
import assert from "node:assert/strict";
import { label } from "../src/index.js";
test("baseline remains stable", () => assert.equal(label, "stable"));
