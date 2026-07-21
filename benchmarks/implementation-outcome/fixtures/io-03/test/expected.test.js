import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../src/index.js";
test("normalizes", () =>
  assert.equal(normalize("  Hola   Mundo "), "hola-mundo"));
