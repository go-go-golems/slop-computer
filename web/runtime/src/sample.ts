// The sample capability: Claude through slop's Pi worker. Filled in with
// the sample phase; until then use("sample") resolves a namespace whose
// calls reject sampling_disabled.
import type { Hello } from "./transport.ts";
import { fail } from "./util.ts";

export function sample(_h: Hello) {
  const off = () => Promise.reject(fail("sampling_disabled", "sampling is not served yet"));
  return Object.freeze(Object.assign(off, { json: off, limits: async () => ({ maxPromptBytes: 256 << 10 }) }));
}
