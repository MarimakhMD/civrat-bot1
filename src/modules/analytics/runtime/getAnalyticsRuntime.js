"use strict";

const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../../../core/guild-config");
const { AnalyticsConfigService } = require("../services/AnalyticsConfigService");
const { createAnalyticsRuntime } = require("./createAnalyticsRuntime");
const { InMemoryAnalyticsRepository } = require("../persistence/InMemoryAnalyticsRepository");

let runtime;

function getAnalyticsRuntime() {
  if (!runtime) {
    let guildConfigResolver;
    try {
      const legacy = require("../../../services/guildConfig");
      const repository = new LegacyGuildConfigRepository({
        getConfig: legacy.getGuildConfig,
        updateConfig: legacy.updateGuildConfig,
        invalidateConfig: legacy.invalidateCache,
      });
      guildConfigResolver = new GuildConfigResolver({ repository });
    } catch {
      guildConfigResolver = { get: async () => ({}), update: async () => ({}) };
    }
    const configService = new AnalyticsConfigService({ guildConfigResolver });
    // Phase 11 — unification des instances : les classements lisent LE MÊME
    // stockage que le chemin d'écriture.
    //  • XP : le repository réel du runtime XP (celui qui reçoit les upserts
    //    dans messageCreate), exposé par createXPRuntime — Mongo en prod,
    //    InMemory hors ligne.
    //  • Invites : le repository réel du service legacy d'invitations (celui
    //    qui reçoit addInvite/removeInvite dans guildMemberAdd/Remove).
    //    Aucune instance privée n'est plus créée ici.
    let xpRepository = null;
    let inviteRepository = null;
    try {
      xpRepository = require("../../xp/runtime/getXPRuntime").getXPRuntime()._repository || null;
    } catch {}
    try {
      inviteRepository = require("../../../services/inviteService").statsRepository || null;
    } catch {}
    // Stockage des événements : Supabase persistant quand le client est
    // configuré, InMemory sinon (hors ligne / tests) — comportement « non
    // configuré » inchangé. Migration analytics_events : documentée dans
    // docs/architecture/phase-11-analytics-unification.md (non exécutée).
    let analyticsRepository = null;
    try {
      const { supabase } = require("../../../config/database");
      if (supabase) {
        const { SupabaseAnalyticsRepository } = require("../persistence/SupabaseAnalyticsRepository");
        analyticsRepository = new SupabaseAnalyticsRepository({ supabase });
      }
    } catch {
      analyticsRepository = null;
    }
    runtime = createAnalyticsRuntime({ configService, analyticsRepository, xpRepository, inviteRepository });
  }
  return runtime;
}

function _resetForTests() {
  runtime = null;
}

module.exports = { getAnalyticsRuntime, _resetForTests };
