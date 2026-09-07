"use strict";

const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../../../core/guild-config");
const { TempVoiceConfigService } = require("../services/TempVoiceConfigService");
const { createTempVoiceRuntime } = require("./createTempVoiceRuntime");
const { InMemoryTempVoiceRepository } = require("../persistence/TempVoiceRepository");

let runtime;

function getTempVoiceRuntime() {
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
    const configService = new TempVoiceConfigService({ guildConfigResolver });

    // B5-b — précédence : Supabase (durable) > InMemory (fallback), comme XP B3.
    //
    // UN SEUL dépôt est retenu : il ne peut donc pas y avoir de double stockage
    // incohérent entre Supabase et la mémoire.
    //
    // Supabase est obligatoirement le client PRIVILÉGIÉ : la RLS de
    // temp_voice_channels n'accorde aucun droit à anon/authenticated
    // (migration B5-a). supabaseAdmin vaut null si SUPABASE_SERVICE_ROLE_KEY est
    // absent, ce qui est exactement le signal « ne pas tenter d'écrire ».
    let repository = null;
    try {
      const { supabaseAdmin } = require("../../../config/database");
      if (supabaseAdmin && typeof supabaseAdmin.from === "function") {
        const { SupabaseTempVoiceRepository } = require("../persistence/SupabaseTempVoiceRepository");
        repository = new SupabaseTempVoiceRepository({ supabase: supabaseAdmin });
      }
    } catch {
      repository = null;
    }

    // InMemory — dernier repli, quand aucune persistance durable n'existe.
    // L'état des salons temporaires est alors perdu au redémarrage : c'est un
    // mode dégradé, pas le comportement nominal.
    if (!repository) repository = new InMemoryTempVoiceRepository();

    runtime = createTempVoiceRuntime({ configService, repository });
  }
  return runtime;
}

function _resetForTests() {
  runtime = null;
}

module.exports = { getTempVoiceRuntime, _resetForTests };
