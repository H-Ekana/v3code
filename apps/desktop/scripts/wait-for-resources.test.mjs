import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import { resourceFileIsReady } from "./wait-for-resources.mjs";

const access = async () => undefined;

NodeTest.test("accepts an existing resource without a build boundary", async () => {
  NodeAssert.equal(
    await resourceFileIsReady("/bundle", undefined, {
      access,
      stat: async () => ({ mtimeMs: 1 }),
    }),
    true,
  );
});

NodeTest.test("waits for resources produced by the current development run", async () => {
  NodeAssert.equal(
    await resourceFileIsReady("/bundle", 100, {
      access,
      stat: async () => ({ mtimeMs: 99 }),
    }),
    false,
  );
  NodeAssert.equal(
    await resourceFileIsReady("/bundle", 100, {
      access,
      stat: async () => ({ mtimeMs: 100 }),
    }),
    true,
  );
});

NodeTest.test("treats missing resources as not ready", async () => {
  NodeAssert.equal(
    await resourceFileIsReady("/missing", 100, {
      access: async () => {
        throw new Error("missing");
      },
      stat: async () => ({ mtimeMs: 100 }),
    }),
    false,
  );
});
