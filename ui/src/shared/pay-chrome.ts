/** Checkout chrome modes for /pay (shell only — not part of invoice payload). */

export type PayChrome = "full" | "minimal" | "none";

export function parsePayChrome(search: string = typeof location !== "undefined" ? location.search : ""): PayChrome {
  const raw = new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("header");
  if (raw === "minimal" || raw === "none" || raw === "full") return raw;
  return "full";
}

/** Append or replace `header` on a pay query/path/URL string. */
export function withPayChrome(payQueryOrUrl: string, chrome: PayChrome): string {
  const isPath = payQueryOrUrl.startsWith("/");
  const isAbsolute = /^https?:\/\//i.test(payQueryOrUrl);
  let base = "";
  let query = payQueryOrUrl;
  if (isAbsolute) {
    const u = new URL(payQueryOrUrl);
    base = `${u.origin}${u.pathname}`;
    query = u.search.startsWith("?") ? u.search.slice(1) : u.search;
  } else if (isPath) {
    const q = payQueryOrUrl.indexOf("?");
    base = q >= 0 ? payQueryOrUrl.slice(0, q) : payQueryOrUrl;
    query = q >= 0 ? payQueryOrUrl.slice(q + 1) : "";
  }
  const params = new URLSearchParams(query);
  if (chrome === "full") params.delete("header");
  else params.set("header", chrome);
  const qs = params.toString();
  if (isAbsolute || isPath) return qs ? `${base}?${qs}` : base;
  return qs;
}

export function currentPayChromeFromLocation(): PayChrome {
  return parsePayChrome(typeof location !== "undefined" ? location.search : "");
}
