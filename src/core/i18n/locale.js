"use strict";

const SupportedLocale = Object.freeze({ EN: "en", FR: "fr" });
const DEFAULT_GUILD_LOCALE = SupportedLocale.FR;

function isSupportedLocale(value) {
  return Object.values(SupportedLocale).includes(value);
}

/** Resolves unknown persisted values safely without selecting another language. */
function resolveGuildLocale(value) {
  return isSupportedLocale(value) ? value : DEFAULT_GUILD_LOCALE;
}

module.exports = { SupportedLocale, DEFAULT_GUILD_LOCALE, isSupportedLocale, resolveGuildLocale };
