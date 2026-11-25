#!/usr/bin/env node
// inbox.mjs PORT -- cmd…: runs inside the box. It puts the two sockets of
// net.mjs (bound at /opt/net) back on loopback, then runs cmd:
//
//   127.0.0.1:PORT and [::1]:PORT  → /opt/net/slop.sock  (the test server,
//                                     so http://slop.localhost:PORT works)
//   127.0.0.1:3128                 → /opt/net/proxy.sock (HTTPS_PROXY)
import net from 'node:net';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const port = Number(argv[0]);
const cmd = argv.slice(argv.indexOf('--') + 1);

const fwd = (sock) => (c) => {
  const u = net.connect(sock);
  c.pipe(u).pipe(c);
  c.on('error', () => u.destroy());
  u.on('error', () => c.destroy());
};
const up = (host, p, sock) => new Promise((ok) => {
  const s = net.createServer(fwd(sock));
  s.on('error', () => ok()); // no ::1 in this namespace: 127.0.0.1 is enough
  s.listen(p, host, ok);
});
await Promise.all([
  up('127.0.0.1', port, '/opt/net/slop.sock'),
  up('::1', port, '/opt/net/slop.sock'),
  up('127.0.0.1', 3128, '/opt/net/proxy.sock'),
]);
// stdin is /dev/null: pi -p reads a piped stdin to its end before it starts.
const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'inherit', 'inherit'] });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, sig) => process.exit(code ?? (sig ? 128 : 1)));
