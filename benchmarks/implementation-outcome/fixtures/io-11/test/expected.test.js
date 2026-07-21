import test from "node:test";
import assert from "node:assert/strict";
import { greet } from "../src/index.js";
test("greets in Spanish", () => assert.equal(greet("Luz", "es"), "Hola Luz"));
