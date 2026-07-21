import test from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/index.js";
test("redacts synthetic marker", () =>
  assert.equal(redact("EXAMPLE_NOT_A_SECRET_VALUE"), "[REDACTED]"));
