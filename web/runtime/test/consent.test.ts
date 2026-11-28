// A capability asks consent only through the Grant it was built with
// (SLOP3-025 design 02): no module but consent.ts holds permission state,
// and no module but index.ts makes grants, so a capability cannot ask for
// another capability's consent by naming it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const dir = new URL("../src/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

test("only index.ts makes grants", () => {
  for (const f of files) {
    if (f === "consent.ts" || f === "index.ts") continue;
    assert.doesNotMatch(readFileSync(new URL(f, dir), "utf8"), /grantFor\s*\(/, `${f} makes a grant`);
  }
});

// types.ts is declarations only (build.mjs emits it into page.d.ts; it is not
// in the bundle), so it may name permissions' type too, but only as a type.
test("other modules import only the Grant type from consent.ts", () => {
  for (const f of files) {
    if (f === "consent.ts" || f === "index.ts") continue;
    for (const m of readFileSync(new URL(f, dir), "utf8").matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"\.\/consent\.ts"/g)) {
      const allowed = f === "types.ts" ? ["Grant", "permissions"] : ["Grant"];
      assert.ok(m[1] && allowed.includes(m[2].trim()), `${f} imports ${m[0]}`);
    }
  }
});

test("index.ts grants each capability its own name", () => {
  const src = readFileSync(new URL("index.ts", dir), "utf8");
  const calls = [...src.matchAll(/grantFor\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(calls.length >= 3);
  assert.deepEqual([...new Set(calls)], ["name"], "grantFor is called with the name being resolved, never a literal");
});
