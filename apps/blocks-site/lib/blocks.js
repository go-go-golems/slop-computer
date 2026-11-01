// The editor's own libraries, loaded as the editor loads them: the kernel,
// Fruit, then the block kit (which registers the block kinds' positional
// props: without it `x.ui.1 is p "hi"` would not set text). Fruit and the
// kit are browser IIFEs that install a global; hypha.js exports through
// module.exports when there is one, so it is installed by hand.
globalThis.Hypha = globalThis.Hypha || require('../vendor/hypha.js');
require('../vendor/fruit.js');
require('../vendor/blocks-kit.js');

module.exports = { H: globalThis.Hypha, F: globalThis.Fruit, B: globalThis.Blocks };
