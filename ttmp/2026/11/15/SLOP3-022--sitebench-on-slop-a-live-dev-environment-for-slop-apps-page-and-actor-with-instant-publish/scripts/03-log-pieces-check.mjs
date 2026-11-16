// Checks logPieces against what claude.js's checkBody measures: the UTF-8
// bytes of JSON.stringify({text}) for each piece, and that the pieces join back.
import fs from 'node:fs'
const src = fs.readFileSync(process.argv[2], 'utf8')
const grab = name => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break } return src.slice(i, j + 1) }
const utf8Len = new Function(grab('utf8Len') + '; return utf8Len')()
const logPieces = new Function(grab('logPieces') + '; return logPieces')()
const cases = {
  cjk: JSON.stringify({ files: { 'a.txt': '漢字'.repeat(35000), 'b.txt': '中文'.repeat(35000) } }),
  quotes: JSON.stringify({ t: '"\\'.repeat(150000) }),
  emoji: JSON.stringify({ t: '😀x'.repeat(90000) }),
  ascii: JSON.stringify({ t: 'a'.repeat(500000) }),
}
for (const [k, json] of Object.entries(cases)) {
  const ps = logPieces(json, 200000)
  const max = Math.max(...ps.map(p => Buffer.byteLength(JSON.stringify({ text: p }))))
  console.log(k, 'pieces', ps.length, 'max stored bytes', max, max <= 262144 ? 'ok' : 'OVER', ps.join('') === json ? 'joins' : 'BROKEN', 'utf8Len ok:', utf8Len(json) === Buffer.byteLength(json))
}
