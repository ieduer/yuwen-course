import { STAGES, CODES } from "./preview-log-contract.js";
const count = (value) => Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value))) : 0;
const status = (value) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;

function hostClass(target) {
  const host = target?.hostname?.toLowerCase() || "";
  if (host === "ctext.org" || host.endsWith(".ctext.org")) return "ctext";
  if (host === "shuge.org" || host.endsWith(".shuge.org")) return "shuge";
  if (host === "forum.rdfzer.com") return "forum";
  if (host === "img.bdfz.net") return "shared_image";
  return host ? "other_registered" : "unknown";
}

function mimeClass(value) {
  const mime = String(value || "").split(";", 1)[0].trim().toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (["text/html", "application/xhtml+xml"].includes(mime)) return "html";
  for (const prefix of ["image", "audio", "video", "text"]) {
    if (mime.startsWith(`${prefix}/`)) return prefix;
  }
  return "other";
}

// Construct every output field explicitly. URLs, headers, bodies and raw errors
// are never serialized. Start events locate requests killed before a terminal log.
export function createPreviewTelemetry(request, { now = () => performance.now(), emit = (event) => console.log(JSON.stringify(event)) } = {}) {
  const started = now();
  const correlationId = crypto.randomUUID();
  let stage = "admission", phaseStarted = started, targetClass = "unknown", mime = "other";
  let ended = false, responseConstructed = false, responseStatus = null, upstreamStatus = null;
  let bytes = 0, firstByte = null, lastChunk = null, maxGap = 0;
  let redirectCount = 0, retryCount = 0, fetchCount = 0, redirectLookup = "not_needed";
  const durations = { registry: 0, target_resolution: 0, auth_headers: 0, headers: 0 };
  const write = (event, extra) => {
    try {
      emit({ event, operation: "preview", source_site_key: "yw", correlation_id: correlationId,
        method: ["GET", "HEAD"].includes(request.method) ? request.method : "OTHER",
        range_request: request.headers.has("range"), host_class: targetClass, mime_class: mime,
        stage, duration_ms: count(now() - started), ...extra });
    } catch { /* Diagnostics must not replace the product outcome. */ }
  };
  const settlePhase = () => {
    if (Object.hasOwn(durations, stage)) durations[stage] += now() - phaseStarted;
    phaseStarted = now();
  };
  const observer = {
    target(target) { targetClass = hostClass(target); },
    phase(next) {
      if (ended) return;
      settlePhase();
      stage = STAGES.has(next) ? next : "response";
      write("YW_PREVIEW_STAGE_STARTED", { fetch_count: fetchCount });
    },
    fetching(phase) { fetchCount += 1; observer.phase(phase); },
    fetched(response) { settlePhase(); upstreamStatus = status(response.status); mime = mimeClass(response.headers.get("content-type")); },
    lookup(value) { redirectLookup = ["ok", "unavailable"].includes(value) ? value : "unavailable"; },
    redirect() { redirectCount += 1; },
    retry() { retryCount += 1; },
    chunk(size) {
      const time = now();
      bytes += count(size);
      if (firstByte === null) firstByte = time;
      if (lastChunk !== null) maxGap = Math.max(maxGap, time - lastChunk);
      lastChunk = time;
      stage = "stream";
    },
    response(response) {
      responseConstructed = true;
      responseStatus = status(response.status);
      response.headers.set("x-preview-request-id", correlationId);
      return response;
    },
    finish(error = null) {
      if (ended) return;
      settlePhase();
      if (error && STAGES.has(error.stage)) stage = error.stage;
      const code = error ? (CODES.has(error.code) ? error.code : "preview_response_failed") : null;
      const time = now();
      if (lastChunk !== null) maxGap = Math.max(maxGap, time - lastChunk);
      write("YW_PREVIEW_TERMINAL", {
        outcome: code === "preview_client_cancelled" ? "cancelled" : code ? "failure" : "success",
        error_code: code, retryable: ["preview_timeout", "preview_upstream_network", "preview_body_failed"].includes(code)
          || (code === "preview_upstream_http" && (upstreamStatus === 429 || upstreamStatus >= 500)),
        censored: ["preview_timeout", "preview_client_cancelled", "preview_body_failed", "preview_body_too_large", "preview_upstream_network"].includes(code), response_constructed: responseConstructed,
        response_status: responseStatus ?? status(error?.status), upstream_status: upstreamStatus,
        redirect_lookup: redirectLookup,
        registry_ms: count(durations.registry), target_resolution_ms: count(durations.target_resolution),
        auth_headers_ms: count(durations.auth_headers), headers_ms: count(durations.headers),
        first_byte_ms: firstByte === null ? null : count(firstByte - started),
        body_ms: firstByte === null ? 0 : count(time - firstByte), max_chunk_gap_ms: count(maxGap),
        bytes: count(bytes), redirect_count: count(redirectCount), retry_count: count(retryCount), fetch_count: count(fetchCount),
      });
      ended = true;
    },
  };
  return observer;
}

// A delivery failure is visible locally and never delays or replaces preview.
// Each request is bounded to 20 stage sends plus its one terminal send.
export function createPreviewEmitter(binding, ctx) {
  let starts = 0, warned = false;
  return (event) => {
    console.log(JSON.stringify(event));
    if (!binding || !ctx?.waitUntil) return;
    if (event.event === "YW_PREVIEW_STAGE_STARTED" && starts++ >= 20) return;
    const delivery = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const response = await binding.fetch("https://yw-preview-logs.internal/events", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(event), signal: controller.signal,
        });
        response.body?.cancel().catch(() => {});
        if (response.status !== 204) throw Error("log delivery unavailable");
      } catch {
        if (!warned) {
          warned = true;
          console.log(JSON.stringify({ event: "YW_PREVIEW_LOG_DELIVERY_FAILED", operation: "preview_log_delivery",
            source_site_key: "yw", correlation_id: event.correlation_id, error_code: "LOG_SINK_UNAVAILABLE" }));
        }
      } finally { clearTimeout(timer); }
    })();
    ctx.waitUntil(delivery);
  };
}
