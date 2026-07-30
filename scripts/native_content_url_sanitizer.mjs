const SENSITIVE_QUERY_KEY = /(^|[_-])(access|api|auth|authorization|cookie|credential|jwt|key|password|refresh|secret|session|sig|signature|token)([_-]|$)|^(chksm|continue|dsh|followup|ifkv|osid|sn|state)$/i;
const URL_PATTERN = /https?:\/\/[^\s\\<>"'，。；！？、）】》]+/gu;
const MALFORMED_AI_STUDIO_STATE_URL_PATTERN = /https?:\/\/aistudio\.google\.com\/app\/prompts\?state=\{[^\s\\<>]*\}(?:&[^\s\\<>"'，。；！？、）】》]*)?/gu;

export const PRIVACY_PATTERNS = {
  aiStudioEmbeddedStatePayload: /aistudio\.google\.com\/app\/prompts[^\s\\<]*(?:"(?:userId|resourceKeys)"\s*:)/gi,
  aiStudioPromptQuery: /aistudio\.google\.com\/app\/prompts\?[^"'\\\s#]*(?:state|usp)=/gi,
  bilibiliTrackingQuery: /bilibili\.com\/[^"'\\\s#?]*\?[^"'\\\s#]*(?:vd_source|spm_id_from)=/gi,
  googleAuthenticationQuery: /[?&](?:continue|dsh|followup|ifkv|osid)=/gi,
  googleRedirectQuery: /google\.com\/url\?[^"'\\\s#]*(?:q|url|usg)=/gi,
  notebookPrivatePath: /notebooklm\.google\.com\/notebook\/[^"'\\/\s?#]+/gi,
  pathSessionIdentifier: /;jsessionid=/gi,
  seiueLoginQuery: /passport\.seiue\.com\/go\/?\?/gi,
  sensitiveQueryParameter: /https?:\/\/[^"'\\\s#]*[?&](?:(?:[^&#=_-]+[_-])*(?:access|api|auth|authorization|cookie|credential|jwt|key|password|refresh|secret|session|sig|signature|token)(?:[_-][^&#=]+)*|chksm|continue|dsh|followup|ifkv|osid|sn|state)=/gi,
  sitesAuthenticationQuery: /sites\.google\.com\/[^"'\\\s#?]*\?[^"'\\\s#]*authuser=/gi,
  workstationPath: /\/Users\//g,
  yuqueLoginQuery: /(?:^|\/\/)(?:[^/]+\.)?yuque\.com\/login\/?\?/gi,
};

export function decodePercentEscapes(value) {
  let decoded = String(value);
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export function privacyIssueCounts(value) {
  const raw = String(value);
  const decoded = decodePercentEscapes(raw);
  return Object.fromEntries(Object.entries(PRIVACY_PATTERNS).map(([name, pattern]) => {
    pattern.lastIndex = 0;
    const rawCount = (raw.match(pattern) || []).length;
    pattern.lastIndex = 0;
    const decodedCount = (decoded.match(pattern) || []).length;
    return [name, { raw: rawCount, decoded: decodedCount }];
  }));
}

export function createUrlSanitizer() {
  const redactions = {
    aiStudioPromptUrlsCollapsed: 0,
    authenticationUrlsCollapsed: 0,
    bilibiliTrackingParametersRemoved: 0,
    googleRedirectUrlsCollapsed: 0,
    googleRedirectUrlsUnwrapped: 0,
    notebookUrlsCollapsed: 0,
    pathSessionIdentifiersRemoved: 0,
    seiueLoginUrlsCollapsed: 0,
    sensitiveQueryParametersRemoved: 0,
    sitesAuthParametersRemoved: 0,
    urlCredentialsRemoved: 0,
    yuqueLoginUrlsCollapsed: 0,
  };

  function sanitizeUrl(candidate, depth = 0) {
    let url;
    try {
      url = new URL(candidate);
    } catch {
      return candidate;
    }
    if (!/^https?:$/.test(url.protocol)) return candidate;
    const hostname = url.hostname.toLowerCase();
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      redactions.urlCredentialsRemoved += 1;
    }
    const sessionMatches = url.pathname.match(/;jsessionid=[^/;]*/gi) || [];
    if (sessionMatches.length > 0) {
      url.pathname = url.pathname.replace(/;jsessionid=[^/;]*/gi, "");
      redactions.pathSessionIdentifiersRemoved += sessionMatches.length;
    }
    if (
      (hostname === "google.com" || hostname.endsWith(".google.com"))
      && url.pathname === "/url"
    ) {
      const removed = [...url.searchParams].length;
      const target = url.searchParams.get("q") || url.searchParams.get("url");
      if (depth < 4 && target) {
        try {
          const targetUrl = new URL(target);
          if (/^https?:$/.test(targetUrl.protocol)) {
            redactions.googleRedirectUrlsUnwrapped += 1;
            redactions.sensitiveQueryParametersRemoved += removed;
            return sanitizeUrl(targetUrl.toString(), depth + 1);
          }
        } catch {
          // Collapse malformed or non-HTTP redirects below.
        }
      }
      if (url.search || url.hash) redactions.googleRedirectUrlsCollapsed += 1;
      redactions.sensitiveQueryParametersRemoved += removed;
      url.search = "";
      url.hash = "";
      return url.toString();
    }
    if (hostname === "accounts.google.com") {
      const removed = [...url.searchParams].length;
      if (url.search || url.hash) redactions.authenticationUrlsCollapsed += 1;
      redactions.sensitiveQueryParametersRemoved += removed;
      url.search = "";
      url.hash = "";
      return url.toString();
    }
    if (
      hostname === "passport.seiue.com"
      && (url.pathname === "/go" || url.pathname === "/go/")
    ) {
      const removed = [...url.searchParams].length;
      if (url.search || url.hash) redactions.seiueLoginUrlsCollapsed += 1;
      redactions.sensitiveQueryParametersRemoved += removed;
      url.search = "";
      url.hash = "";
      return url.toString();
    }
    if (
      (hostname === "yuque.com" || hostname.endsWith(".yuque.com"))
      && (url.pathname === "/login" || url.pathname === "/login/")
    ) {
      const removed = [...url.searchParams].length;
      if (url.search || url.hash) redactions.yuqueLoginUrlsCollapsed += 1;
      redactions.sensitiveQueryParametersRemoved += removed;
      url.search = "";
      url.hash = "";
      return url.toString();
    }
    if (hostname === "notebooklm.google.com") {
      if (url.pathname !== "/" || url.search || url.hash) redactions.notebookUrlsCollapsed += 1;
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.toString();
    }
    if (hostname === "bilibili.com" || hostname.endsWith(".bilibili.com")) {
      for (const key of ["vd_source", "spm_id_from"]) {
        const count = url.searchParams.getAll(key).length;
        if (count > 0) {
          url.searchParams.delete(key);
          redactions.bilibiliTrackingParametersRemoved += count;
          redactions.sensitiveQueryParametersRemoved += count;
        }
      }
    }
    if (hostname === "sites.google.com") {
      const count = url.searchParams.getAll("authuser").length;
      if (count > 0) {
        url.searchParams.delete("authuser");
        redactions.sitesAuthParametersRemoved += count;
        redactions.sensitiveQueryParametersRemoved += count;
      }
    }
    if (hostname === "aistudio.google.com" && url.pathname.startsWith("/app/prompts")) {
      const removed = [...url.searchParams].length;
      if (url.search || url.hash) redactions.aiStudioPromptUrlsCollapsed += 1;
      redactions.sensitiveQueryParametersRemoved += removed;
      url.search = "";
      url.hash = "";
      return url.toString();
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) {
        redactions.sensitiveQueryParametersRemoved += url.searchParams.getAll(key).length;
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  }

  function sanitizeString(value) {
    const withoutMalformedAiStudioState = String(value).replace(
      MALFORMED_AI_STUDIO_STATE_URL_PATTERN,
      (candidate) => {
        redactions.aiStudioPromptUrlsCollapsed += 1;
        redactions.sensitiveQueryParametersRemoved += (
          candidate.slice(candidate.indexOf("?") + 1).split("&").length
        );
        return "https://aistudio.google.com/app/prompts";
      },
    );
    return withoutMalformedAiStudioState.replace(URL_PATTERN, (candidate) => {
      const hasHtmlAmpersand = /&(?:amp|#0*38|#x0*26);/i.test(candidate);
      let normalized = candidate;
      for (let pass = 0; pass < 3; pass += 1) {
        const next = normalized.replace(/&(?:amp|#0*38|#x0*26);/gi, "&");
        if (next === normalized) break;
        normalized = next;
      }
      const sanitized = sanitizeUrl(normalized);
      return hasHtmlAmpersand ? sanitized.replaceAll("&", "&amp;") : sanitized;
    });
  }

  function sanitizeValue(value) {
    if (typeof value === "string") return sanitizeString(value);
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]),
      );
    }
    return value;
  }

  return {
    redactions,
    sanitizeString,
    sanitizeUrl,
    sanitizeValue,
  };
}
