# Fix the overflow

Project: Corner Coffee · thread started 2026-11-15 23:02:55 · exported 2026-11-15 23:03:04
Mode: auto · writes to: proposals · model: default

---

## You · 2026-11-15 23:02:59

Fix the overflow

---

## Claude · 2026-11-15 23:02:59 · default

### eval 1 · ok · 133 ms · files.list, frames.check

```js
const fl = await files.list(); const c = await frames.check(); return { files: fl.map(f => f.path), c }
```

Result:

```yaml
files:
  - README.md
  - app.js
  - cart.html
  - index.html
  - menu.html
  - orders.html
  - styles.css
c:
  route: index.html
  errors: []
  issues: []
```

### eval 2 · ok · 15 ms · frames.list, frames.check

```js
const fs = await frames.list(); const menu = fs.find(f => f.route === 'menu.html'); return await frames.check(menu.id)
```

Result:

```yaml
route: menu.html
errors: []
issues:
  - kind: overflow
    src: menu.html:19
    selector: "#cats"
    message: the 2 children of div#cats run 181px past the 375px viewport
```

### eval 3 · ok · 7 ms · files.replace

```js
return await files.replace('styles.css', '.cats { display: flex; gap: 8px; margin-bottom: 12px; }', '.cats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }')
```

Result:

```yaml
path: styles.css
replaced: 1
```

### eval 4 · ok · 7 ms · frames.list, frames.check, session.mark

```js
const fs = await frames.list(); const menu = fs.find(f => f.route === 'menu.html'); const r = await frames.check(menu.id); await session.mark('cats wrap'); return r
```

Result:

```yaml
route: menu.html
errors: []
issues: []
```

### Fixed the menu overflow

The category buttons now **wrap** instead of running off the edge at 375px.

- Added `flex-wrap: wrap` to `.cats` in `styles.css:73`
- The buttons live at menu.html:19
  - nested note with *emphasis*

| Frame | Before | After |
|---|---|---|
| menu 375px | 1 issue | 0 |

```css
.cats { display: flex; flex-wrap: wrap; }
```

> Still open: the buttons have a fixed `min-width`.

_1 file changed in "Fix the overflow"_
