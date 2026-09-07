"use strict";

const { classifyDiscordError } = require("../../../adapters/discord/discordErrorClassifier");

/**
 * B5-c — Réconciliation / cleanup des salons vocaux temporaires au démarrage.
 *
 * Objectif : après un redémarrage, aligner public.temp_voice_channels (vérité
 * durable, écrite par B5-b) sur l'état réel de Discord. Le Set mémoire du
 * runtime n'étant pas hydraté au boot, cette étape supprime les salons devenus
 * orphelins ET signale (via `survivors`) les salons encore valides à
 * réinjecter dans le Set partagé.
 *
 * INVARIANTS FAIL-SAFE (aucun ordre de grandeur à respecter en dehors de ceux-ci) :
 *   1. on ne traite que les channel_id issus de temp_voice_channels ;
 *   2. jamais de suppression d'un salon non prouvé temporaire ;
 *   3. jamais de suppression d'un salon non vide ;
 *   4. jamais de conclusion « orphelin » à partir d'une panne réseau ;
 *   5. une erreur Supabase de lecture/écriture → skip, aucune suppression ;
 *   6. suppression Discord TOUJOURS avant suppression DB ;
 *   7. la ligne DB n'est supprimée qu'après un résultat Discord confirmé ;
 *   8. cloisonnement strict par guild_id (porté par le dépôt B5-b) ;
 *   9. comportement idempotent (suppressions Discord/DB idempotentes).
 *
 * Le nettoyage ne lit PAS le réglage tempvoice_enabled : la présence d'une
 * ligne dans temp_voice_channels suffit à prouver l'origine temporaire du
 * salon, quelle que soit la valeur actuelle du toggle (décision B).
 *
 * Ce service est PUR : aucune dépendance directe au runtime, au Set partagé ou
 * au cycle de vie du bot. Il reçoit un `client` Discord (pour énumérer les
 * guildes et manipuler les salons) et un `repository` TempVoice, et retourne un
 * résultat structuré. La réinjection dans le Set est à la charge de l'appelant.
 */

/** discord.js ChannelType.GuildVoice. */
const GUILD_VOICE_TYPE = 2;

/** Code Discord « Unknown Channel » (salon réellement absent). */
const UNKNOWN_CHANNEL_CODE = 10003;

/**
 * Énumère les guildes visibles par le client, indépendamment de la forme du
 * cache (Map discord.js, tableau injecté en test, etc.).
 */
function listGuilds(client) {
  const cache = client && client.guilds && client.guilds.cache;
  if (!cache) return [];
  if (Array.isArray(cache)) return cache;
  if (typeof cache.values === "function") return Array.from(cache.values());
  return [];
}

/**
 * Récupère un salon par id via l'API de la guilde.
 *
 * discord.js renvoie `null` (sans lever) quand le salon n'existe pas ; toute
 * exception est donc soit réseau, soit un 404 explicite selon la version — on
 * la renvoie telle quelle pour classification par l'appelant.
 */
async function fetchChannel(guild, channelId) {
  const channels = guild && guild.channels;
  if (!channels || typeof channels.fetch !== "function") {
    return { channel: null, error: new Error("guild.channels.fetch unavailable") };
  }
  try {
    const channel = await channels.fetch(channelId);
    return { channel: channel || null, error: null };
  } catch (error) {
    return { channel: null, error };
  }
}

/** true si l'erreur Discord signifie « salon réellement absent » (404 / 10003). */
function isUnknownChannelError(error) {
  return classifyDiscordError(error).discordCode === UNKNOWN_CHANNEL_CODE;
}

/**
 * Nombre de membres en voix, ou null si indéterminable.
 *
 * Un `null` est traité comme une INCERTITUDE : on ne supprime jamais sur un
 * doute (invariant 3). Un salon voice discord.js réel expose toujours
 * `channel.members.size` (intent GuildVoiceStates) ; un faux de test incomplet
 * ou un état partiel retombe ici en « skip ».
 */
function memberCount(channel) {
  const members = channel && channel.members;
  if (!members || typeof members.size !== "number") return null;
  return members.size;
}

class TempVoiceReconciliationService {
  /**
   * @param {object} options
   * @param {object} options.repository  Dépôt TempVoice (findByGuild, delete).
   * @param {object} options.client      Client Discord (guilds.cache + channels).
   * @param {object} [options.logger]    Logger (info/warn/error), optionnel.
   */
  constructor({ repository, client, logger = null } = {}) {
    if (!repository || typeof repository.findByGuild !== "function" || typeof repository.delete !== "function") {
      throw new TypeError("TempVoiceReconciliationService requires a TempVoice repository");
    }
    if (!client) {
      throw new TypeError("TempVoiceReconciliationService requires a Discord client");
    }
    this.repository = repository;
    this.client = client;
    this.logger = logger;
  }

  log(level, message, meta) {
    const fn = this.logger && typeof this.logger[level] === "function" ? this.logger[level] : null;
    if (fn) fn(message, meta);
  }

  /** Supprime la ligne DB d'un salon déjà traité côté Discord. Best-effort. */
  async removeRow(guildId, channelId, result) {
    try {
      await this.repository.delete(guildId, channelId);
      return true;
    } catch (error) {
      result.skipped += 1;
      result.errors.push({ guildId, channelId, reason: "SUPABASE_DELETE_FAILED" });
      this.log("warn", "tempvoice reconciliation: DB row removal failed", {
        event: "tempvoice_reconcile_error",
        guildId,
        channelId,
        reason: "SUPABASE_DELETE_FAILED",
        error: error && error.message ? error.message : String(error),
      });
      return false;
    }
  }

  async reconcileRow(guild, row, result) {
    const guildId = guild.id;
    const channelId = row && row.channelId;

    // Décision C — ligne invalide : skip + log, jamais de suppression.
    if (typeof channelId !== "string" || !channelId.trim()) {
      result.skipped += 1;
      result.errors.push({ guildId, channelId: channelId || null, reason: "INVALID_ROW" });
      this.log("warn", "tempvoice reconciliation: invalid row skipped", {
        event: "tempvoice_reconcile_error",
        guildId,
        reason: "INVALID_ROW",
      });
      return;
    }

    // 1. Le salon existe-t-il encore côté Discord ?
    const { channel, error } = await fetchChannel(guild, channelId);
    if (error) {
      // 404 / Unknown Channel → salon réellement absent → orphelin (pas de delete Discord).
      if (isUnknownChannelError(error)) {
        await this.removeRow(guildId, channelId, result);
        result.removedOrphanRows += 1;
        return;
      }
      // Toute autre erreur → incertitude → skip sans aucune suppression.
      result.skipped += 1;
      result.errors.push({ guildId, channelId, reason: "DISCORD_UNAVAILABLE" });
      this.log("warn", "tempvoice reconciliation: Discord unavailable, skipped", {
        event: "tempvoice_reconcile_error",
        guildId,
        channelId,
        reason: "DISCORD_UNAVAILABLE",
      });
      return;
    }
    if (!channel) {
      // `null` = salon réellement absent (discord.js) → orphelin, ligne DB seule.
      await this.removeRow(guildId, channelId, result);
      result.removedOrphanRows += 1;
      return;
    }

    // 2. Le salon existe. Preuve de type : uniquement les salons vocaux.
    if (channel.type !== GUILD_VOICE_TYPE) {
      result.skipped += 1;
      result.errors.push({ guildId, channelId, reason: "NOT_GUILD_VOICE" });
      this.log("warn", "tempvoice reconciliation: non-voice channel skipped", {
        event: "tempvoice_reconcile_error",
        guildId,
        channelId,
        reason: "NOT_GUILD_VOICE",
      });
      return;
    }

    // 3. Vacuité. Incertitude → skip ; non vide → réhydrater sans supprimer.
    const count = memberCount(channel);
    if (count === null) {
      result.skipped += 1;
      result.errors.push({ guildId, channelId, reason: "MEMBERSHIP_UNKNOWN" });
      this.log("warn", "tempvoice reconciliation: membership unknown, skipped", {
        event: "tempvoice_reconcile_error",
        guildId,
        channelId,
        reason: "MEMBERSHIP_UNKNOWN",
      });
      return;
    }
    if (count > 0) {
      result.rehydrated += 1;
      result.survivors.push(channelId);
      return;
    }

    // 4. Vide → suppression Discord D'ABORD.
    try {
      await channel.delete();
    } catch (deleteError) {
      result.skipped += 1;
      result.errors.push({ guildId, channelId, reason: "DISCORD_DELETE_FAILED" });
      this.log("warn", "tempvoice reconciliation: Discord delete failed, row kept", {
        event: "tempvoice_reconcile_error",
        guildId,
        channelId,
        reason: "DISCORD_DELETE_FAILED",
      });
      return;
    }

    // 5. … puis suppression DB uniquement après confirmation Discord.
    const removed = await this.removeRow(guildId, channelId, result);
    if (removed) result.deletedEmptyChannels += 1;
  }

  /** Réconcilie toutes les guildes visibles. Best-effort, n'échoue jamais globalement. */
  async reconcile() {
    const result = {
      guildsProcessed: 0,
      rowsProcessed: 0,
      removedOrphanRows: 0,
      deletedEmptyChannels: 0,
      rehydrated: 0,
      skipped: 0,
      survivors: [],
      errors: [],
    };

    for (const guild of listGuilds(this.client)) {
      result.guildsProcessed += 1;
      let rows;
      try {
        rows = await this.repository.findByGuild(guild.id);
      } catch (error) {
        // Erreur Supabase → skip de TOUTE la guilde, aucune suppression.
        result.errors.push({ guildId: guild.id, channelId: null, reason: "SUPABASE_UNAVAILABLE" });
        this.log("warn", "tempvoice reconciliation: guild read failed, guild skipped", {
          event: "tempvoice_reconcile_error",
          guildId: guild.id,
          reason: "SUPABASE_UNAVAILABLE",
          error: error && error.message ? error.message : String(error),
        });
        continue;
      }
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        result.rowsProcessed += 1;
        await this.reconcileRow(guild, row, result);
      }
    }

    return result;
  }
}

module.exports = {
  TempVoiceReconciliationService,
  GUILD_VOICE_TYPE,
  UNKNOWN_CHANNEL_CODE,
  isUnknownChannelError,
};
