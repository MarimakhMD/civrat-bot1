"use strict";

const LOG_LEVELS = ["debug", "info", "success", "warn", "error"];
const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";
const MAX_DEPTH = 10;

const SENSITIVE_KEY_FRAGMENTS = Object.freeze([
  "token",
  "password",
  "passwd",
  "secret",
  "authorization",
  "cookie",
  "credential",
  "apikey",
  "privatekey",
  "clientsecret",
  "mastercode",
  "recoverycode",
  "transfercode",
  "tempcode",
  "smtpuser",
  "mongouri",
  "connectionstring",
  "servicerolekey",
  "anonkey",
  "publishablekey",
  "supabaseurl",
  "recoveryemail",
]);

function isSensitiveKey(key) {
  const normalized = String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function redactString(value) {
  let output = String(value);

  // Supabase endpoint configuration must never be emitted, even without user-info.
  output = output.replace(/\bhttps?:\/\/[a-z0-9-]+\.supabase\.(?:co|net)(?:\/[^\s]*)?/gi, REDACTED);

  // URI user-info: keep the protocol and endpoint, remove both credentials.
  output = output.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@/\s]+)@/gi,
    `$1${REDACTED}@`,
  );

  // Sensitive query-string parameters and textual key/value assignments.
  output = output.replace(
    /([?&](?:access[_-]?token|token|password|passwd|secret|api[_-]?key|key|signature|sig)=)[^&#\s]+/gi,
    `$1${REDACTED}`,
  );
  output = output.replace(
    /\b(discord[_-]?token|owner[_-]?panel[_-]?master[_-]?code|owner[_-]?transfer[_-]?code|recovery[_-]?(?:master[_-]?)?code|smtp[_-]?password|supabase[_-]?(?:url|service[_-]?role[_-]?key|anon[_-]?key|publishable[_-]?key)|mongo[_-]?uri|api[_-]?key|client[_-]?secret|password|passwd|secret)\b(\s*[:=]\s*)["']?[^\s,;"']+["']?/gi,
    `$1$2${REDACTED}`,
  );
  output = output.replace(
    /(\b(?:master|owner|recovery|transfer|temporary|temp|verification|one[- ]time|otp)[ _-]*code\b\s*(?:is|[:=])\s*)[^\s,;]+/gi,
    `$1${REDACTED}`,
  );

  // Authorization headers and common high-confidence credential formats.
  output = output.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`);
  output = output.replace(/\b(Basic\s+)[A-Za-z0-9+/=]{8,}/gi, `$1${REDACTED}`);
  output = output.replace(/\bmfa\.[A-Za-z0-9_-]{20,}\b/g, REDACTED);
  output = output.replace(/\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}\b/g, REDACTED);
  output = output.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, REDACTED);
  output = output.replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9._-]{12,}\b/gi, REDACTED);
  output = output.replace(/\b(?:github_pat_[A-Za-z0-9_]{40,}|gh[pousr]_[A-Za-z0-9]{30,})\b/g, REDACTED);
  output = output.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED);
  output = output.replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, REDACTED);
  output = output.replace(/\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g, REDACTED);
  output = output.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, REDACTED);

  return output;
}

function sanitizeError(error, seen, depth) {
  if (seen.has(error)) return CIRCULAR;
  seen.add(error);

  const output = {
    name: redactString(error.name || "Error"),
    message: redactString(error.message || ""),
  };
  if (error.code !== undefined) output.code = sanitizeValue(error.code, seen, depth + 1);
  if (error.cause !== undefined) output.cause = sanitizeValue(error.cause, seen, depth + 1);

  for (const key of Object.keys(error)) {
    if (key === "name" || key === "message" || key === "code" || key === "cause" || key === "stack") continue;
    output[key] = isSensitiveKey(key)
      ? REDACTED
      : sanitizeProperty(error, key, seen, depth + 1);
  }

  seen.delete(error);
  return output;
}

function sanitizeProperty(object, key, seen, depth) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor && typeof descriptor.get === "function" && !("value" in descriptor)) return "[Getter]";
    return sanitizeValue(object[key], seen, depth);
  } catch {
    return "[Unserializable]";
  }
}

function sanitizeValue(value, seen = new WeakSet(), depth = 0) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return redactString(value.description || "Symbol");
  if (typeof value === "function") return `[Function${value.name ? `: ${value.name}` : ""}]`;
  if (depth > MAX_DEPTH) return "[MaxDepth]";

  if (value instanceof Error) return sanitizeError(value, seen, depth);
  if (Buffer.isBuffer(value)) return `[Buffer length=${value.length}]`;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  if (typeof URL !== "undefined" && value instanceof URL) return redactString(value.toString());

  if (seen.has(value)) return CIRCULAR;
  seen.add(value);

  let output;
  if (Array.isArray(value)) {
    output = value.map((entry) => sanitizeValue(entry, seen, depth + 1));
  } else if (value instanceof Map) {
    output = {};
    for (const [key, entry] of value.entries()) {
      const safeKey = redactString(String(key));
      output[safeKey] = isSensitiveKey(key) ? REDACTED : sanitizeValue(entry, seen, depth + 1);
    }
  } else if (value instanceof Set) {
    output = [...value].map((entry) => sanitizeValue(entry, seen, depth + 1));
  } else {
    output = {};
    let keys;
    try {
      keys = Object.keys(value);
    } catch {
      seen.delete(value);
      return "[Unserializable]";
    }
    for (const key of keys) {
      output[key] = isSensitiveKey(key)
        ? REDACTED
        : sanitizeProperty(value, key, seen, depth + 1);
    }
  }

  seen.delete(value);
  return output;
}

function serialize(value) {
  try {
    return JSON.stringify(sanitizeValue(value));
  } catch {
    return JSON.stringify("[Unserializable]");
  }
}

function hasMetadata(meta) {
  if (meta === null || meta === undefined) return false;
  if (typeof meta !== "object" || meta instanceof Error) return true;
  try {
    return Object.keys(meta).length > 0;
  } catch {
    return true;
  }
}

function formatMessage(message) {
  if (typeof message === "string") return redactString(message);
  return serialize(message);
}

function format(level, message, meta) {
  const timestamp = new Date().toISOString();
  const msg = formatMessage(message);
  const metaStr = hasMetadata(meta) ? ` ${serialize(meta)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}

const logger = {};

for (const level of LOG_LEVELS) {
  logger[level] = (message, meta) => {
    const line = format(level, message, meta);
    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  };
}

module.exports = logger;
module.exports.logger = logger;
