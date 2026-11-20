import test from "node:test";
import assert from "node:assert/strict";
import { hello } from "../src/hello.js";

test("hello", () => {
  assert.equal(hello("clem"), "hello clem");
});
