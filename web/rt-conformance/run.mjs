// Runs the conformance page in the Workshop with Chromium and prints the
// results; exits 1 on any failure. Then checks two tabs on one target see
// each other's writes and presence.
//
//   node run.mjs http://localhost:8080 [target]
//
// Needs playwright (NODE_PATH) and a local-mode server with the app pushed:
//   slop push web/rt-conformance/app -a rt-conformance
//   slop push web/rt-conformance/sample -a rt-sample      (needs --pi-worker)
// Consent dialogs in the Workshop are accepted as a person would.
import { createRequire } from "node:module";

// CommonJS resolution, so NODE_PATH can point at a playwright install.
const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.argv[2] || "http://localhost:8080";
const target = process.argv[3] || "rt-conformance";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext();

// Local mode: a nickname form post signs in (the context keeps the cookie).
async function signIn(page, nick) {
  const r = await page.context().request.post(base + "/auth/local", { form: { nickname: nick }, headers: { Origin: base }, maxRedirects: 0 });
  if (r.status() !== 303) throw new Error("sign in: HTTP " + r.status());
}

// Accepts the Workshop's consent dialog whenever it shows.
function autoAllow(page) {
  const timer = setInterval(async () => {
    for (const label of ["Allow", "Save"]) {
      const b = page.locator(`.dialog button:has-text("${label}")`);
      if (await b.count().catch(() => 0)) await b.first().click().catch(() => {});
    }
  }, 300);
  page.on("close", () => clearInterval(timer));
}

async function appFrame(page) {
  autoAllow(page);
  await page.goto(base + "/run/" + target);
  const el = await page.waitForSelector("iframe", { timeout: 15000 });
  const frame = await el.contentFrame();
  await frame.waitForFunction(() => document.title === "done", null, { timeout: 600000, polling: 500 });
  return frame;
}

let failed = 0;
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log("[console]", m.text()));
await signIn(page, "manuel");
const frame = await appFrame(page);
const results = JSON.parse(await frame.$eval("#results", (e) => e.textContent));
for (const r of results) {
  console.log((r.ok ? "ok   " : "FAIL ") + r.name + (r.detail && (!r.ok || process.env.VERBOSE) ? "  — " + r.detail : ""));
  if (!r.ok) failed++;
}

if (target !== "rt-conformance") {
  await browser.close();
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
}

// Two tabs on one target.
const page2 = await ctx.newPage();
const frame2 = await appFrame(page2);
const check = async (name, fn) => {
  try {
    const ok = await fn();
    console.log((ok ? "ok   " : "FAIL ") + name);
    if (!ok) failed++;
  } catch (e) {
    console.log("FAIL " + name + "  — " + e.message);
    failed++;
  }
};
await check("two tabs: a write in one reaches the other's onSnapshot", async () => {
  const seen = frame2.evaluate(async () => {
    const db = await claude.use("db");
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 5000);
      const off = db.doc("shared/x").onSnapshot((s) => {
        if (s.exists && s.data().from === "tab1") { clearTimeout(t); off(); resolve(true); }
      });
    });
  });
  await new Promise((r) => setTimeout(r, 500));
  await frame.evaluate(async () => (await claude.use("db")).doc("shared/x").set({ from: "tab1", at: Date.now() }));
  return seen;
});
await check("two tabs: presence from the other tab arrives with by", async () => {
  await frame.evaluate(async () => (await claude.use("room")).presence({ tab: 1 }));
  return frame2.evaluate(async () => {
    const room = await claude.use("room");
    const me = await (await claude.use("user")).id();
    for (let i = 0; i < 40; i++) {
      const other = room.peers().find((p) => !p.isMe && p.presence.tab === 1);
      if (other) return other.by === me && other.sameTab === false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  });
});
await check("two tabs: a moment from one tab reaches the other", async () => {
  const got = frame2.evaluate(async () => {
    const room = await claude.use("room");
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 4000);
      const off = room.on("ping", (m) => { if (!m.isMe) { clearTimeout(t); off(); resolve(m.data === "hi"); } });
    });
  });
  await new Promise((r) => setTimeout(r, 300));
  await frame.evaluate(async () => (await claude.use("room")).emit("ping", "hi"));
  return got;
});
await check("downloads: the shell asks, and the file arrives in the browser", async () => {
  const dl = page.waitForEvent("download", { timeout: 8000 });
  const res = await frame.evaluate(async () => (await claude.use("downloads")).save({ filename: "notes.txt", data: "hello" }));
  const d = await dl;
  return res.status === "saved" && d.suggestedFilename() === "notes.txt";
});
await check("a reload converges: the document is there after reloading", async () => {
  const f = await appFrame(page2);
  return f.evaluate(async () => (await (await claude.use("db")).doc("shared/x").get()).data().from === "tab1");
});

await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
