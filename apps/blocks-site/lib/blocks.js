// The editor's own libraries, loaded as the editor loads them: the kernel,
// Fruit, then the block kit (which registers the block kinds' positional
// props: without it `x.ui.1 is p "hi"` would not set text). Fruit and the
// kit are browser IIFEs that install a global; hypha.js exports through
// module.exports when there is one, so it is installed by hand.
// goja's Number.prototype.toLocaleString passes its argument to toString
// as a radix, so the editor's toLocaleString("en-US") (Hypha's money(),
// Fruit's numbers from 1000 up) throws there. Where it does, numbers get
// the en-US shape the editor shows: digits grouped by three, at most three
// decimals (or opts' fraction digits). Node and browsers keep their own.
(function () {
  try { (1).toLocaleString('en-US'); return; } catch (e) { /* goja */ }
  Number.prototype.toLocaleString = function (locales, opts) {
    const n = Number(this);
    if (!isFinite(n)) return String(n);
    const o = opts || {};
    const min = typeof o.minimumFractionDigits === 'number' ? o.minimumFractionDigits : 0;
    const max = Math.max(min, typeof o.maximumFractionDigits === 'number' ? o.maximumFractionDigits : 3);
    const parts = Math.abs(n).toFixed(Math.min(20, max)).split('.');
    let frac = (parts[1] || '').replace(/0+$/, '');
    while (frac.length < min) frac += '0';
    const int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 && (int !== '0' || frac) ? '-' : '') + int + (frac ? '.' + frac : '');
  };
})();

globalThis.Hypha = globalThis.Hypha || require('../vendor/hypha.js');
require('../vendor/fruit.js');
require('../vendor/blocks-kit.js');

module.exports = { H: globalThis.Hypha, F: globalThis.Fruit, B: globalThis.Blocks };
