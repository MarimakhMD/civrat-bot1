"use strict";

const {
  ErrorCode,
  BackendUnavailableError,
  PersistenceError,
} = require("../../core/errors");

const SupabaseErrorCategory = Object.freeze({
  BACKEND_UNAVAILABLE: "BACKEND_UNAVAILABLE",
  SCHEMA_MISMATCH: "SCHEMA_MISMATCH",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  CONFLICT: "CONFLICT",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNKNOWN: "UNKNOWN",
});

const SCHEMA_CODES = new Set([
  "3F000", // invalid_schema_name
  "42P01", // undefined_table
  "42703", // undefined_column
  "42883", // undefined_function
  "PGRST202", // function not found in schema cache
  "PGRST204", // column not found in schema cache
  "PGRST205", // table not found in schema cache
]);

const PERMISSION_CODES = new Set([
  "42501", // insufficient_privilege / RLS
  "PGRST301",
  "PGRST302",
  "PGRST303",
]);

const CONFLICT_CODES = new Set([
  "23000",
  "23502", // not_null_violation
  "23503", // foreign_key_violation
  "23505", // unique_violation
  "23514", // check_violation
  "23P01", // exclusion_violation
]);

const NOT_FOUND_CODES = new Set([
  "PGRST116", // singular response did not contain exactly one row
]);

const VALIDATION_CODES = new Set([
  "22P02", // invalid_text_representation
  "22001", // string_data_right_truncation
  "22003", // numeric_value_out_of_range
  "22007", // invalid_datetime_format
]);

const NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function normalizeCode(error) {
  const candidates = [error?.code, error?.cause?.code, error?.error?.code];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().toUpperCase();
  }
  return null;
}

function normalizeStatus(error) {
  const candidates = [error?.status, error?.statusCode, error?.response?.status, error?.error?.status];
  for (const candidate of candidates) {
    const status = Number(candidate);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return null;
}

function classifySupabaseError(error) {
  const code = normalizeCode(error);
  const httpStatus = normalizeStatus(error);
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";

  let category = SupabaseErrorCategory.UNKNOWN;
  let retryable = false;
  let backendAvailable = true;

  if (
    (code && NETWORK_CODES.has(code))
    || httpStatus === 408
    || httpStatus === 429
    || (httpStatus !== null && httpStatus >= 500)
    || (!code && (message.includes("fetch failed") || message.includes("network error")))
  ) {
    category = SupabaseErrorCategory.BACKEND_UNAVAILABLE;
    retryable = true;
    backendAvailable = false;
  } else if (code && SCHEMA_CODES.has(code)) {
    category = SupabaseErrorCategory.SCHEMA_MISMATCH;
  } else if ((code && PERMISSION_CODES.has(code)) || httpStatus === 401 || httpStatus === 403) {
    category = SupabaseErrorCategory.PERMISSION_DENIED;
  } else if ((code && CONFLICT_CODES.has(code)) || httpStatus === 409) {
    category = SupabaseErrorCategory.CONFLICT;
  } else if (code && NOT_FOUND_CODES.has(code)) {
    category = SupabaseErrorCategory.NOT_FOUND;
  } else if ((code && VALIDATION_CODES.has(code)) || httpStatus === 400 || httpStatus === 422) {
    category = SupabaseErrorCategory.VALIDATION_FAILED;
  }

  return Object.freeze({
    category,
    kind: category,
    code,
    httpStatus,
    retryable,
    backendAvailable,
  });
}

function toPersistenceError(error, metadata = {}) {
  const classified = classifySupabaseError(error);
  const safeMetadata = {
    ...metadata,
    classification: classified.category,
    source: "supabase",
  };

  switch (classified.category) {
    case SupabaseErrorCategory.BACKEND_UNAVAILABLE:
      return new BackendUnavailableError(safeMetadata, error);
    case SupabaseErrorCategory.SCHEMA_MISMATCH:
      return new PersistenceError({ code: ErrorCode.PERSISTENCE_SCHEMA_MISMATCH, metadata: safeMetadata, cause: error });
    case SupabaseErrorCategory.PERMISSION_DENIED:
      return new PersistenceError({ code: ErrorCode.PERSISTENCE_PERMISSION_DENIED, metadata: safeMetadata, cause: error });
    case SupabaseErrorCategory.CONFLICT:
      return new PersistenceError({ code: ErrorCode.PERSISTENCE_CONFLICT, metadata: safeMetadata, cause: error });
    default:
      return new PersistenceError({
        code: ErrorCode.PERSISTENCE_FAILED,
        metadata: safeMetadata,
        cause: error,
        retryable: classified.retryable,
      });
  }
}

module.exports = {
  SupabaseErrorCategory,
  classifySupabaseError,
  toPersistenceError,
};
