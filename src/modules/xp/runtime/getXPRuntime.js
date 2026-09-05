"use strict";

const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../../../core/guild-config");
const { XPConfigService } = require("../services/XPConfigService");
const { createXPRuntime } = require("./createXPRuntime");
const { InMemoryXPRepository } = require("../persistence/XPRepository");

let runtime;

function getXPRuntime() {
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
      guildConfigResolver = {
        get: async () => ({}),
        update: async () => ({}),
      };
    }
    const configService = new XPConfigService({ guildConfigResolver });
    // B3 — précédence : Supabase (durable) > Mongo (legacy) > InMemory.
    //
    // UN SEUL dépôt est retenu : il ne peut donc pas y avoir de double
    // stockage incohérent entre Supabase et Mongo.
    //
    // Le garde-fou Mongo d'origine est CONSERVÉ : le modèle UserXP se construit
    // même sans connexion, et sans ce test readyState toute lecture/écriture se
    // bufferisait indéfiniment hors ligne. readyState 1 = connected. Mongo
    // n'est pas supprimé : il reste le dépôt actif si MONGO_URI est configuré
    // et que Supabase n'est pas disponible.
    let repository = null;

    // 1. Supabase — obligatoirement via le client PRIVILÉGIÉ.
    //    La RLS de public.member_xp n'accorde aucun droit à anon/authenticated
    //    (migration B3) : le client non privilégié échouerait en 42501 sur
    //    chaque message. supabaseAdmin vaut null si SUPABASE_SERVICE_ROLE_KEY
    //    est absent (src/config/database.js), ce qui est exactement le signal
    //    « ne pas tenter d'écrire ».
    try {
      const { supabaseAdmin } = require("../../../config/database");
      if (supabaseAdmin && typeof supabaseAdmin.from === "function") {
        const { SupabaseXPRepository } = require("../persistence/SupabaseXPRepository");
        repository = new SupabaseXPRepository({ supabase: supabaseAdmin });
      }
    } catch {
      repository = null;
    }

    // 2. Mongo — seulement si Supabase n'est pas disponible.
    if (!repository) {
      try {
        const mongoose = require("mongoose");
        if (mongoose.connection?.readyState === 1) {
          const { MongoXPRepository } = require("../persistence/MongoXPRepository");
          repository = new MongoXPRepository();
        }
      } catch {
        repository = null;
      }
    }

    // 3. InMemory — dernier repli, quand aucune persistance durable n'existe.
    //    L'XP est alors perdue au redémarrage : c'est un mode dégradé, pas le
    //    comportement nominal.
    if (!repository) repository = new InMemoryXPRepository();
    runtime = createXPRuntime({
      configService,
      repository,
      logsRuntimeFactory: () => {
        try {
          return require("../../logs/runtime/getLogsRuntime").getLogsRuntime();
        } catch {
          return null;
        }
      },
    });
  }
  return runtime;
}

function _resetForTests() {
  runtime = null;
}

module.exports = { getXPRuntime, _resetForTests };
