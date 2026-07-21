import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe } from "../src/index.js";
test("behavior and helper", async () => {
  assert.equal(
    describe({ name: "Ada", role: "admin" }),
    "User: Ada (admin); audit: Ada (admin)",
  );
  assert.match(
    await readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    /function formatUser|const formatUser/,
  );
});
