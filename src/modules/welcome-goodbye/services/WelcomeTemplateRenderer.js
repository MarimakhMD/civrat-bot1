"use strict";
const { PlaceholderName } = require("../configuration/welcomeGoodbyeConstants");

/**
 * Rend un modèle Welcome/Goodbye en remplaçant ses `{placeholders}`.
 *
 * PHASE 2 (B2) — TOLÉRANCE AUX DEUX CASSES.
 *
 * Les noms canoniques (`PlaceholderName`) sont en minuscules, mais les
 * administrateurs écrivent naturellement `{memberCount}`, `{userId}`,
 * `{displayName}`, `{joinDate}`. L'ancienne version faisait
 * `providers.has(name)` avec le nom TEL QU'ÉCRIT : seule la casse minuscule
 * résolvait, et `{memberCount}` restait littéral dans le message Discord.
 *
 * La comparaison passe donc par une clé normalisée (minuscules). Les messages
 * déjà enregistrés en `{membercount}` continuent de fonctionner : les deux
 * casses sont acceptées, aucune n'est privilégiée.
 *
 * PHASE 2 (B3) — un provider dont la valeur est `null`/`undefined` rend une
 * chaîne vide, jamais le texte « null ».
 */
function normalizePlaceholderName(name) {
  return String(name).toLowerCase();
}

class WelcomeTemplateRenderer {
  constructor({ providers = [] } = {}) {
    this.providers = new Map();
    providers.forEach((provider) => this.register(provider));
  }

  register(provider) {
    if (!provider?.name || typeof provider.resolve !== "function") throw new TypeError("Invalid placeholder provider");
    const key = normalizePlaceholderName(provider.name);
    if (this.providers.has(key)) throw new Error(`Duplicate placeholder: ${provider.name}`);
    this.providers.set(key, provider);
  }

  render(template, context) {
    const source = template === null || template === undefined ? "" : String(template);
    return source.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (token, name) => {
      const provider = this.providers.get(normalizePlaceholderName(name));
      // Placeholder inconnu : laissé tel quel, jamais inventé.
      if (!provider) return token;
      const value = provider.resolve(context);
      return value === null || value === undefined ? "" : String(value);
    });
  }
}

/**
 * Providers Free disponibles pour Welcome, Goodbye, Embed et DM.
 *
 * Chaque provider accepte les deux casses côté CONTEXTE également : selon
 * l'appelant (adaptateur Discord, aperçu, test), la clé peut être `memberCount`
 * ou `membercount`.
 */
function defaultPlaceholderProviders() {
  return [
    { name: PlaceholderName.USER, resolve: (c) => c.user || c.mention || "" },
    { name: PlaceholderName.MENTION, resolve: (c) => c.mention || c.user || "" },
    { name: PlaceholderName.USERNAME, resolve: (c) => c.username || "" },
    { name: PlaceholderName.DISPLAY_NAME, resolve: (c) => c.displayname || c.displayName || "" },
    { name: PlaceholderName.USER_ID, resolve: (c) => c.userid || c.userId || "" },
    { name: PlaceholderName.SERVER, resolve: (c) => c.server || "" },
    { name: PlaceholderName.MEMBER_COUNT, resolve: (c) => c.membercount ?? c.memberCount ?? "" },
    { name: PlaceholderName.JOIN_DATE, resolve: (c) => c.joindate || c.joinDate || "" },
    // B3 — déjà calculés par l'adaptateur, jusqu'ici sans provider.
    { name: PlaceholderName.ACCOUNT_AGE, resolve: (c) => c.accountage || c.accountAge || "" },
    { name: PlaceholderName.DATE, resolve: (c) => c.date || "" },
    { name: PlaceholderName.TIME, resolve: (c) => c.time || "" },
  ];
}

module.exports = { WelcomeTemplateRenderer, defaultPlaceholderProviders, normalizePlaceholderName };
