// E09: what Blocks' in-page Claude is told about Spore (blocks.js:331 applies two replaces to CC5Spore.prompt()).
// node e09-prompt.js <spore.js> <hypha.js> <index.html>
const L = require(__dirname + "/load.js")(process.argv[2], process.argv[3], process.argv[4]);
const raw = L.CC5Spore.prompt();
const blocks = raw.replace(/give its app desk\.[^.]*\./, "").replace(/desk/g, "workspace");
const hits = s => (s.match(/\$\.(desk|workspace)\.[^\s,)]*|"(desk|workspace)\.[^"]*"/g) || []).slice(0, 8);
console.log("--- raw prompt length", raw.length, "starts with reference?", raw.includes("## 16. Reference"));
console.log("--- raw mentions", JSON.stringify(hits(raw)));
console.log("--- as Blocks sends it", JSON.stringify(hits(blocks)));
