import { useEffect, useState } from "react";
import { ROUTES } from "./config/frs-map.js";

export { ROUTES };

export function currentPath() {
  return window.location.hash.replace(/^#/, "") || ROUTES.overview;
}

export function navigate(path) {
  if (window.location.hash.slice(1) === path) return;
  window.location.hash = path;
}

export function useHashRoute() {
  const [path, setPath] = useState(currentPath);

  useEffect(() => router.subscribe(setPath), []);

  return path;
}

/** Router bridge handed to the React adapter. */
export const router = {
  current: currentPath,
  subscribe(cb) {
    const onChange = () => cb(currentPath());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  },
  href(route) {
    const path = typeof route === "string" ? route : (route?.path ?? ROUTES.overview);
    return `#${path}`;
  },
  push: navigate,
};
