# Sources: the Pinboard prototype

The originals the user downloaded on 2026-11-07, kept unchanged.

| Path here | Original | sha256 |
|---|---|---|
| `pinboard-prototype/` | `~/Downloads/Pinboard.zip` (207,975 bytes), extracted; 9 files, each byte-identical to the archive | zip: `68aacd199ed0637ddd1cd27fc5621096bdc4f4cc19e1c1bafdbc57935e45f5e2` |
| `pinboard-api-examples-and-wireframes.html` | `~/Downloads/Pinboard · API examples and wireframes.html`: the full design document (wireframe sheets, pipeline, 14 examples in `<script type="text/x-src">` blocks) | `6dda75c187eea41364b7e9825c3d563d86d234b1a956103aaa7ca33d27ec6afb` |
| `pinboard-api-examples-and-wireframes.md` | `~/Downloads/Pinboard · API examples and wireframes.md`: the same document as text, without the example code | `f55b1ed2ebc2ab8a6e9e1c39b410e54594148cfabee11c92105733a776b33bc3` |
| `pinboard-api-examples-code.txt` | derived: the 14 example sources extracted from the HTML (`re` + `html.unescape`), for reading and grepping | — |

To run the prototype, open `pinboard-prototype/index.html` in a browser; it keeps everything in that browser's IndexedDB (`pinboard.v1`). The agent panel works only inside a claude.ai viewer; elsewhere it is a console (messages starting with `>` run as code).
