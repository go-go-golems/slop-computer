// The source stamp of a committed build output. A web/ package whose build
// is committed (web/runtime → pkg/server/assets/claude.js, web/admin →
// pkg/doors/office/admin and apps/backoffice) writes the hash of its sources into
// the first line of each output; pkg/server's TestBuildOutputsFresh hashes
// the sources the same way, so a source change without a rebuild fails
// `go test` without needing node.
//
// The hash: sha256 over "<path>\0<sha256 of the file>\n" for build.mjs, the
// lockfile and every file under src/, sorted by path (relative to the
// package, with forward slashes).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCKS = ['package-lock.json', 'pnpm-lock.yaml'];

function walk(dir, rel, out) {
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, p, out);
    else out.push(p);
  }
}

/** The source hash of the package at dir (default: the current directory). */
export function sourceHash(dir = '.') {
  const files = ['build.mjs', ...LOCKS.filter((f) => existsSync(join(dir, f)))];
  walk(dir, 'src', files);
  files.sort();
  const h = createHash('sha256');
  for (const f of files) h.update(`${f}\0${createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')}\n`);
  return h.digest('hex');
}

/** The first line of a stamped output. */
export function stamp(what, dir = '.') {
  return `/* ${what}: do not edit. source sha256:${sourceHash(dir)} */`;
}
