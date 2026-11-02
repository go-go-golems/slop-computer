/* Deep links for Claude Blocks on slop: the page is the URL's fragment
   (/b/ws-team#page_o1p8). Not part of the upstream export (src/ stays
   byte-identical, SHA256SUMS); build.sh adds this file after blocks.js.
   It uses only what blocks.js exposes on window.blocks:

   - the first page: the one the fragment names. Nav.restore() opens the
     last page it stored ("cb:page"), so the fragment's page is stored
     there before the workspace loads; a page that does not exist falls
     back as before.
   - every page change writes the fragment: S.page becomes an accessor (only
     Nav.go assigns it). The first write replaces, later ones add history
     entries, so Back and Forward step through pages.
   - Back, Forward, or a fragment typed into the address bar (slop's shell
     passes it in): go to that page.

   slop's runtime mirrors the fragment into the address bar. */
(function () {
  "use strict";
  const api = window.blocks;
  if (!api || !api.S) return;
  const S = api.S;
  const named = () => { try { return decodeURIComponent(location.hash.slice(1)); } catch (e) { return ""; } };
  const exists = (p) => !!p && (p[0] === "@" || !!(S.K && S.K.isBranch(p)));

  const first = named();
  if (first) try { localStorage.setItem("cb:page", JSON.stringify(first)); } catch (e) { /* no storage: the default page */ }

  let page = S.page, written = false;
  Object.defineProperty(S, "page", {
    configurable: true, enumerable: true,
    get: () => page,
    set: (p) => {
      page = p;
      if (!p || location.hash === "#" + p) { written = written || !!p; return; }
      if (written) location.hash = p;
      else { written = true; history.replaceState(history.state, "", "#" + p); }
    },
  });

  addEventListener("hashchange", () => { const p = named(); if (p !== page && exists(p)) api.go(p); });
})();
