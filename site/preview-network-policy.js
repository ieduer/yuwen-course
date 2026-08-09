const NON_PUBLIC_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".lan",
  ".test",
  ".invalid",
];

function canonicalHostname(value) {
  const host = String(value || "").trim().toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

// Preview targets are source-curated documents, never arbitrary network
// destinations. No current source requires an address literal, so rejecting all
// IPv4/IPv6 literals is both simpler and safer than maintaining a partial list
// of private, mapped, link-local and reserved address ranges.
export function previewUrlHasPublicHostname(url) {
  if (!(url instanceof URL) || url.protocol !== "https:" || url.username || url.password) return false;
  const hostname = canonicalHostname(url.hostname);
  if (!hostname || hostname.length > 253) return false;
  if (url.hostname.startsWith("[") || /^[0-9.]+$/.test(hostname)) return false;
  if (hostname === "localhost" || NON_PUBLIC_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;
  if (!hostname.includes(".")) return false;
  return hostname.split(".").every(
    (label) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/.test(label),
  );
}
