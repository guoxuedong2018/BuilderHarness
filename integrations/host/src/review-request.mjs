export function isSameOrigin(req) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    const protocol = req.socket?.encrypted ? "https" : "http";
    return Boolean(req.headers.host) && origin === new URL(`${protocol}://${req.headers.host}`).origin;
  } catch {
    return false;
  }
}

export function isReviewWrite(req) {
  const type = req.headers["content-type"];
  return isSameOrigin(req) && typeof type === "string" &&
    type.split(";", 1)[0].trim().toLowerCase() === "application/json";
}
