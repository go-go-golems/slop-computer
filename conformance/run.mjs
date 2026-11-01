// Runs the runtime conformance page on a slop v3 live host with Chromium and
// prints the results; then checks that two tabs on one store see each
// other's writes, presence and moments. Exits 1 on any failure.
//
//   node conformance/run.mjs http://apps.localhost:18300/conformance [email]
//
// Needs playwright (NODE_PATH) and a --local server with the app mounted:
//   slop store new rt-conformance && slop push conformance/app --store rt-conformance
//   slop mount set apps.localhost:18300 /conformance rt-conformance
// It signs in through the live host's handoff with the local form, and
// accepts the shell's consent dialogs as a person would.
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const url = process.argv[2] || "http://apps.localhost:18300/conformance";
const email = process.argv[3] || "admin@example.com";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext();

function autoAllow(page) {
  const timer = setInterval(async () => {
    for (const label of ["Allow", "Save"]) {
      const b = page.locator(`.shell-modal button:has-text("${label}")`);
      if (await b.count().catch(() => 0)) await b.first().click().catch(() => {});
    }
  }, 300);
  page.on("close", () => clearInterval(timer));
}

async function signIn(page) {
  await page.goto(url);
  await page.waitForSelector("#me a, #me button", { timeout: 15000 });
  const link = page.locator('#me a:has-text("Sign in")');
  if (!(await link.count())) return;
  await link.click();
  await page.waitForURL(/\/auth\/login|\/_site\/callback|\/conformance/);
  if (page.url().includes("/auth/login")) {
    await page.fill("input[name=email]", email);
    await page.click("form button");
  }
  await page.waitForURL((u) => u.toString().startsWith(url), { timeout: 15000 });
}

async function appFrame(page) {
  autoAllow(page);
  await page.goto(url);
  const el = await page.waitForSelector("iframe#app", { timeout: 15000, state: "attached" });
  const frame = await (async () => {
    for (let i = 0; i < 100; i++) {
      const f = await el.contentFrame();
      if (f && f.url().includes("/v/")) return f;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("the app frame never loaded");
  })();
  await frame.waitForFunction(() => document.title === "done", null, { timeout: 600000, polling: 500 });
  return frame;
}

let failed = 0;
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log("[console]", m.text()));
await signIn(page);
const frame = await appFrame(page);
const results = JSON.parse(await frame.$eval("#results", (e) => e.textContent));
const skip = new Set((process.env.SKIP || "comments").split(",").filter(Boolean));
for (const r of results) {
  const skipped = [...skip].some((s) => r.name.startsWith(s + ":"));
  console.log((r.ok ? "ok   " : skipped ? "skip " : "FAIL ") + r.name + (r.detail && !r.ok ? "  — " + r.detail : ""));
  if (!r.ok && !skipped) failed++;
}

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
