#!/usr/bin/env node
// net.mjs DIR PORT: the box's only ways out, as two unix sockets in DIR.
//
// The box has its own network namespace (bwrap --unshare-net): loopback and
// nothing else. Round 4's agent, on the host's network, probed the host's own
// services and opened public SSH tunnels. Now:
//
//   DIR/slop.sock   pipes to 127.0.0.1:PORT, the run's test server
//   DIR/proxy.sock  an HTTP CONNECT proxy that admits only ALLOW (the model
//                   provider); every refusal is a line in DIR/denied.log,
//                   every admitted CONNECT one in DIR/allowed.log
//
// inbox.mjs, inside the box, puts both back on loopback ports.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const [dir, port] = process.argv.slice(2);
// Listen by relative path: a socket path over 108 bytes fails (EINVAL), and
// run directories are deep.
process.chdir(dir);
const ALLOW = /^([a-z0-9-]+\.)*lunaroute\.com:443$/;
const denied = path.resolve(dir, 'denied.log');
const deny = (what) => fs.appendFileSync(denied, `${new Date().toISOString()} ${what}\n`);

function listen(name, onConn) {
  const p = name;
  fs.rmSync(p, { force: true });
  const s = net.createServer(onConn);
  s.listen(p, () => fs.chmodSync(p, 0o666));
  return s;
}

listen('slop.sock', (c) => {
  const u = net.connect(Number(port), '127.0.0.1');
  c.pipe(u).pipe(c);
  c.on('error', () => u.destroy());
  u.on('error', () => c.destroy());
});

listen('proxy.sock', (c) => {
  let buf = Buffer.alloc(0);
  const onData = (d) => {
    buf = Buffer.concat([buf, d]);
    const end = buf.indexOf('\r\n\r\n');
    if (end < 0) {
      if (buf.length > 65536) c.destroy();
      return;
    }
    c.off('data', onData);
    const head = buf.subarray(0, end).toString('latin1');
    const rest = buf.subarray(end + 4);
    const [method, target] = head.split('\r\n')[0].split(' ');
    if (method !== 'CONNECT' || !ALLOW.test(target || '')) {
      // Plain-HTTP requests carry an absolute URL; record it whole.
      deny(`${method} ${target}`);
      c.end('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nblocked by the persona box: only the model provider is reachable\n');
      return;
    }
    fs.appendFileSync('allowed.log', `${new Date().toISOString()} CONNECT ${target}\n`);
    const [host, p] = target.split(':');
    const u = net.connect(Number(p), host, () => {
      c.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (rest.length) u.write(rest);
      c.pipe(u).pipe(c);
    });
    u.on('error', () => c.destroy());
    c.on('error', () => u.destroy());
  };
  c.on('data', onData);
  c.on('error', () => {});
});

fs.writeFileSync('ready', String(process.pid));
