export const STAGES = new Set(["admission", "registry", "target_resolution", "auth_headers", "headers", "redirect", "body", "stream", "response"]);
export const CODES = new Set([
  "preview_bad_url", "preview_target_denied", "preview_registry_unavailable",
  "preview_target_unregistered", "preview_target_resolution_failed",
  "preview_redirect_denied", "preview_redirect_missing", "preview_redirect_limit",
  "preview_redirect_invalid", "preview_upstream_http", "preview_upstream_network",
  "preview_timeout", "preview_body_failed", "preview_body_too_large",
  "preview_client_cancelled", "preview_response_failed", "preview_mime_unsupported",
  "preview_pdf_unavailable",
]);

const NUMBER_FIELDS = ["duration_ms", "fetch_count", "registry_ms", "target_resolution_ms", "auth_headers_ms", "headers_ms", "body_ms", "max_chunk_gap_ms", "bytes", "redirect_count", "retry_count"];
const enumValue = (value, choices, fallback) => choices.includes(value) ? value : fallback;
const safeStatus = (value) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;

// This is an independent receive-side allowlist, shared with the leaf's tests.
// Never forward arbitrary JSON, headers or error text to Workers Logs.
export function sanitizePreviewLog(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !["YW_PREVIEW_STAGE_STARTED", "YW_PREVIEW_TERMINAL"].includes(input.event)
    || input.operation !== "preview" || input.source_site_key !== "yw"
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.correlation_id || "")) return null;
  const output = {
    event: input.event, operation: "preview", source_site_key: "yw", correlation_id: input.correlation_id,
    method: enumValue(input.method, ["GET", "HEAD"], "OTHER"), range_request: input.range_request === true,
    host_class: enumValue(input.host_class, ["ctext", "shuge", "forum", "shared_image", "other_registered"], "unknown"),
    mime_class: enumValue(input.mime_class, ["pdf", "html", "image", "audio", "video", "text"], "other"),
    stage: STAGES.has(input.stage) ? input.stage : "response",
  };
  for (const field of NUMBER_FIELDS) {
    if (input[field] !== undefined) output[field] = Number.isSafeInteger(input[field]) && input[field] >= 0 ? input[field] : 0;
  }
  if (input.event === "YW_PREVIEW_TERMINAL") {
    Object.assign(output, {
      outcome: enumValue(input.outcome, ["success", "failure", "cancelled"], "failure"),
      error_code: input.error_code === null ? null : CODES.has(input.error_code) ? input.error_code : "preview_response_failed",
      retryable: input.retryable === true, censored: input.censored === true,
      response_constructed: input.response_constructed === true,
      response_status: safeStatus(input.response_status), upstream_status: safeStatus(input.upstream_status),
      redirect_lookup: enumValue(input.redirect_lookup, ["ok", "unavailable"], "not_needed"),
      first_byte_ms: Number.isSafeInteger(input.first_byte_ms) && input.first_byte_ms >= 0 ? input.first_byte_ms : null,
    });
  }
  return output;
}
