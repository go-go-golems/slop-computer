// src/chatapp/ is pinocchio's chatapp browser client, copied from the module
// version go.mod requires (node sync-chatapp.mjs). It must stay a copy.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { copyDir, moduleSource } from "../sync-chatapp.mjs";

test("src/chatapp is the chatapp client of the pinocchio version in go.mod", (t: { skip: (m: string) => void }) => {
  let src: string;
  try {
    src = moduleSource();
  } catch (e) {
    t.skip("go is not available: " + (e as Error).message);
    return;
  }
  const files = (d: string) => fs.readdirSync(d).filter((f: string) => f.endsWith(".ts")).sort();
  assert.deepEqual(files(copyDir), files(src), "the same files (node sync-chatapp.mjs)");
  for (const f of files(src)) assert.equal(fs.readFileSync(path.join(copyDir, f), "utf8"), fs.readFileSync(path.join(src, f), "utf8"), f + " differs: node sync-chatapp.mjs");
});
