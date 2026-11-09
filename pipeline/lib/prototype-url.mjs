import { PROJECT_CONFIG } from "./paths.mjs";

export function prototypeUrl(base, route, parameters = {}) {
  if (typeof route !== "string" || !/^\/(?!\/)/.test(route) || route.includes("\\")) {
    throw new Error(`Expected a local prototype route: ${route}`);
  }
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP(S) prototype base without embedded credentials");
  if (PROJECT_CONFIG.routeMode === "history") {
    const relative = new URL(route, url.origin);
    url.pathname = url.pathname.replace(/\/$/, "") + relative.pathname;
    for (const [key, value] of relative.searchParams) url.searchParams.set(key, value);
    url.hash = relative.hash;
  } else url.hash = route;
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
  return url.href;
}
