import test from "node:test";
import assert from "node:assert/strict";
import { withDefault } from "../src/index.js";
test("keeps zero", () => assert.equal(withDefault(0), 0));
