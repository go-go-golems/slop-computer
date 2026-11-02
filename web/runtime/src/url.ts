// The view's fragment is the app's place in itself (#page_o1p8). The shell
// mirrors it into the address bar, so a place can be bookmarked and shared,
// and sends its own fragment (typed, or Back over a typed one) back in. The
// shell opens the view with its fragment, so the first place needs no
// message. Only the fragment travels: a page never changes the shell's
// path, and the shell never reloads the page.
import { boot, on, post } from "./transport.ts";

const MAX = 1024;

export function syncFragment() {
  if (window.parent === window || boot.mode !== "app") return;
  let last = location.hash;
  const report = () => {
    if (location.hash === last) return;
    last = location.hash;
    post({ type: "hash", hash: last.length <= MAX ? last : "" });
  };
  addEventListener("hashchange", report);
  addEventListener("popstate", report);
  // pushState and replaceState change the fragment without an event.
  for (const k of ["pushState", "replaceState"] as const) {
    const f = history[k].bind(history);
    history[k] = (data: unknown, unused: string, url?: string | URL | null) => {
      f(data, unused, url);
      report();
    };
  }
  on("shell:hash", (m) => {
    const h = m.hash;
    if (typeof h !== "string" || h.length > MAX || (h !== "" && h[0] !== "#") || h === location.hash) return;
    const oldURL = location.href;
    last = h;
    if (h) {
      location.replace(oldURL.split("#")[0] + h); // a fragment navigation: hashchange, no new entry
    } else {
      history.replaceState(history.state, "", location.pathname + location.search); // dropping the fragment must not reload
      dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: location.href }));
    }
  });
}
