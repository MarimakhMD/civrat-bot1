"use strict";

const { TicketPremiumConfigSchema } = require("./ticketPremiumConfigSchema");
const { ValidationError } = require("../../../core/errors");

// Placeholders reconnus dans ticket_name_format. Au moins un placeholder
// d'unicité est exigé afin que deux tickets ne puissent pas recevoir le même
// nom de salon.
const TICKET_NAME_UNIQUENESS_PLACEHOLDERS = Object.freeze(["{number}", "{username}", "{userid}"]);

function isValidTicketNameFormat(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 90) return false;
  if (!/^[a-z0-9\-_{}]+$/.test(value)) return false;
  if (!TICKET_NAME_UNIQUENESS_PLACEHOLDERS.some((placeholder) => value.includes(placeholder))) return false;
  const stripped = TICKET_NAME_UNIQUENESS_PLACEHOLDERS.reduce((rest, placeholder) => rest.split(placeholder).join(""), value);
  return !/[{}]/.test(stripped);
}

function isValidHttpsUrl(value, maxLength) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) return false;
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    return false;
  }
  return url.protocol === "https:";
}

// Vérification défensive non levante, utilisée par la résolution en couches :
// une valeur invalide stockée en base est simplement ignorée (fallback Free
// pour cette clé), jamais propagée.
function isValidTicketPremiumValue(key, value) {
  const rule = TicketPremiumConfigSchema[key];
  if (!rule) return false;
  if (value === null) return Boolean(rule.nullable);
  if (rule.type === "string") return typeof value === "string" && value.length >= 1 && value.length <= rule.maxLength;
  if (rule.type === "hex-color") return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  if (rule.type === "https-url") return isValidHttpsUrl(value, rule.maxLength);
  if (rule.type === "discord-channel") return typeof value === "string" && /^\d{15,22}$/.test(value);
  if (rule.type === "ticket-name-format") return isValidTicketNameFormat(value);
  return false;
}

// Chemin d'écriture (futures vues /settings Premium, 10.2+) : toute clé
// inconnue ou valeur invalide est rejetée avec une ValidationError ; null est
// accepté pour réinitialiser une clé (retour au default Free).
function validateTicketPremiumUpdates(updates) {
  for (const [key, value] of Object.entries(updates)) {
    const rule = TicketPremiumConfigSchema[key];
    if (!rule) throw new ValidationError({ field: key, reason: "unsupported_ticket_premium_setting" });
    if (value === null && rule.nullable) continue;
    if (!isValidTicketPremiumValue(key, value)) throw new ValidationError({ field: key, reason: `invalid_${rule.type}` });
  }
  return true;
}

module.exports = {
  validateTicketPremiumUpdates,
  isValidTicketPremiumValue,
  isValidTicketNameFormat,
  TICKET_NAME_UNIQUENESS_PLACEHOLDERS,
};
