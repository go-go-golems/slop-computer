// Copies pinocchio's chatapp browser client (pkg/chatapp/webclient/src) from
// the Go module that go.mod requires into src/chatapp/. Run after changing
// the pinocchio version: node sync-chatapp.mjs (test/chatapp-copy.test.ts
// fails while the copy differs from the module's source).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export function moduleSource() {
  const dir = execFileSync("go", ["list", "-m", "-f", "{{.Dir}}", "github.com/go-go-golems/pinocchio"], { cwd: path.join(here, "../.."), encoding: "utf8" }).trim();
  if (!dir) throw new Error("go list found no pinocchio module directory (run go mod download)");
  return path.join(dir, "pkg/chatapp/webclient/src");
}
export const copyDir = path.join(here, "src/chatapp");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = moduleSource();
  fs.mkdirSync(copyDir, { recursive: true });
  for (const f of fs.readdirSync(copyDir)) if (f.endsWith(".ts")) fs.rmSync(path.join(copyDir, f));
  for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".ts"))) {
    fs.copyFileSync(path.join(src, f), path.join(copyDir, f));
    fs.chmodSync(path.join(copyDir, f), 0o644);
  }
  console.log("copied", src, "→", copyDir);
}
