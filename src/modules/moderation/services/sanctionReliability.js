"use strict";
const { classifyDiscordError, DiscordErrorCategory: Category } = require("../../../adapters/discord/discordErrorClassifier");

// Free-text Discord IDs must not be coerced to Number (loss of precision).
function validUserId(id) {
  return typeof id === "string" && /^[1-9]\d{16,19}$/.test(id) && BigInt(id) <= 18446744073709551615n;
}
function validReason(reason) {
  return reason == null || (typeof reason === "string" && reason.length <= 500);
}
function failure(prefix, error) {
  const classified = classifyDiscordError(error);
  let suffix = "FAILED";
  if (error?.code === "AUTHORIZATION_DENIED" || error?.code === "FORBIDDEN"
      || [401, 403].includes(classified.httpStatus)
      || [Category.MISSING_ACCESS, Category.MISSING_PERMISSIONS].includes(classified.category)) suffix = "PERMISSION_DENIED";
  else if (classified.category === Category.UNAVAILABLE) suffix = "UNAVAILABLE";
  else if (classified.category === Category.RATE_LIMITED) suffix = "RATE_LIMITED";
  else if (classified.category === Category.VALIDATION_FAILED) suffix = "INVALID_REQUEST";
  else if (prefix === "UNBAN" && classified.discordCode === 10026) suffix = "NOT_BANNED";
  else if (prefix !== "UNBAN" && [10007, 10013].includes(classified.discordCode)) suffix = "INVALID_TARGET";
  return { ok: false, code: `${prefix}_${suffix}` };
}
module.exports = { validUserId, validReason, failure };
