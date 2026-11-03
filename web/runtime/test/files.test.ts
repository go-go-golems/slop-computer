// caps.ts files against a scripted transport: a non-empty file is read and
// downloaded (review of PR #20: the deep freeze threw on its bytes), and an
// empty listing is a listing.
import assert from "node:assert/strict";
import { mock, test } from "node:test";

const replies: Record<string, (p: any) => unknown> = {};
const asked: { type: string; payload: any }[] = [];
mock.module("../src/transport.ts", {
  namedExports: {
    ask: async (type: string, payload: any) => (asked.push({ type, payload }), { status: "saved" }),
    boot: {},
    connect: async () => ({}),
    post: () => {},
    request: async () => ({}),
    rpc: async (method: string, p: any) => replies[method](p),
  },
});
const { files } = await import("../src/caps.ts");
const f = files();
const text = "hello, project";
replies["files.read"] = (p) => {
  const part = text.slice(p.offset, p.length ? p.offset + p.length : undefined);
  return { bytes: btoa(part), size: text.length, revision: "r1" };
};

test("files.read returns a non-empty file's bytes", async () => {
  const r = await f.read("notes/readme.txt");
  assert.equal(new TextDecoder().decode(r.bytes), text);
  assert.equal(r.size, text.length);
  assert.equal(r.revision, "r1");
  assert.ok(Object.isFrozen(r));
});

test("files.download saves a non-empty file", async () => {
  assert.deepEqual(await f.download("notes/readme.txt"), { status: "saved" });
  const got = asked.at(-1)!;
  assert.equal(got.type, "download");
  assert.equal(await (got.payload.data as Blob).text(), text);
});

test("read_project_file reads text through asSampleTools", async () => {
  const tools = await f.asSampleTools();
  const read = tools.find((t: any) => t.name === "read_project_file")!;
  assert.deepEqual(await read.execute({ path: "notes/readme.txt" }), { text, size: text.length });
});

test("an empty listing is an empty list", async () => {
  replies["files.list"] = () => ({ entries: [] });
  assert.deepEqual((await f.list()).entries, []);
  replies["files.list"] = () => ({ entries: null }); // an older server's empty listing
  assert.deepEqual((await f.list()).entries, []);
});
