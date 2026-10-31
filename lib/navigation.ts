export function internalPath(value: unknown, fallback = "/tasks"): string {
  if (typeof value !== "string") return fallback;
  const raw = value.trim();
  if (
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(raw)
  )
    return fallback;
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("//") || /[\\\u0000-\u001f]/.test(decoded))
      return fallback;
    const url = new URL(raw, "https://taskapp.invalid");
    return url.origin === "https://taskapp.invalid"
      ? url.pathname + url.search + url.hash
      : fallback;
  } catch {
    return fallback;
  }
}
