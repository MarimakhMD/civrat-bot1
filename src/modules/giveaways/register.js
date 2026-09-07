"use strict";

const { PermissionName } = require("../../core/permissions");
const { prefix } = require("../../core/interactions/routeMatchers");
const { GiveawayComponentId: Id } = require("./configuration/giveawayConstants");
const { ENTRIES_SCAN_CAP } = require("./persistence/SupabaseGiveawayRepository");

/**
 * Mapping code de retour → clé de traduction.
 *
 * Avant M5, le bouton Join réduisait TOUT échec à `giveaway.notFound` :
 * un membre cliquant sur un giveaway fermé lisait « Giveaway introuvable. »,
 * alors que la clé `giveaway.closed` existait déjà en fr ET en — définie,
 * jamais servie. Un échec réel de base produisait le même message trompeur.
 *
 * Toute valeur absente de la table retombe sur une clé d'échec explicite,
 * jamais sur « introuvable ».
 */
const JOIN_MESSAGE_KEY = Object.freeze({
  GIVEAWAY_JOINED: "giveaway.joined",
  GIVEAWAY_ALREADY_JOINED: "giveaway.alreadyJoined",
  GIVEAWAY_CLOSED: "giveaway.closed",
  GIVEAWAY_NOT_FOUND: "giveaway.notFound",
});

const DRAW_MESSAGE_KEY = Object.freeze({
  GIVEAWAY_DRAWN: "giveaway.drawSuccess",
  GIVEAWAY_NO_PARTICIPANTS: "giveaway.noParticipants",
  GIVEAWAY_CLOSED: "giveaway.closed",
  GIVEAWAY_NOT_FOUND: "giveaway.notFound",
});

const { giveawayView } = require("./interactions/giveawayViews");
const { toggleGiveaway } = require("./interactions/configureGiveaways");
const { GiveawayService } = require("./services/GiveawayService");
const { SupabaseGiveawayRepository } = require("./persistence/SupabaseGiveawayRepository");
const { DiscordGiveawayTransport } = require("../../adapters/discord/DiscordGiveawayTransport");

function registerGiveaways({ registry, configService, supabase, logsRuntimeFactory, settingsHome = null }) {
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  const render = async (context) => context.envelope.transport.update({ view: giveawayView({ t: context.t, config: await configService.read(context.guildId) }) });

  registry.registerButton({ customId: Id.SECTION, permissions, execute: render });
  registry.registerButton({
    customId: Id.TOGGLE,
    permissions,
    execute: async (context) => {
      await toggleGiveaway({ service: configService, guildId: context.guildId });
      return render(context);
    },
  });
  // C1 : l'enregistrement du sélecteur de salon a été retiré avec le composant.
  // Il persistait vers giveaway_channel_id, colonne inexistante.
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });

  const createCommand = {
    name: "giveaway",
    description: "Manage giveaways",
    permissions,
    options: [
      { type: "string", name: "action", description: "create or draw", required: true },
      { type: "string", name: "prize", description: "Prize", required: false },
      { type: "string", name: "id", description: "Giveaway ID", required: false },
    ],
    execute: async (context) => {
      // Déferrement immédiat : create/draw font de l'I/O Supabase/Discord avant
      // de répondre ; sans deferReply, une réponse tardive (>3 s) rendrait
      // l'interaction « l'application ne répond plus ».
      await context.envelope.transport.deferReply?.({ ephemeral: true });
      const action = context.envelope.options.getString("action");
      const guildId = context.guildId;
      const guild = context.envelope.discordMember.guild;
      const repository = new SupabaseGiveawayRepository({ supabase: supabase || context.envelope.supabase });
      const transport = new DiscordGiveawayTransport({ guild });
      const logsRuntime = logsRuntimeFactory ? logsRuntimeFactory() : null;
      const service = new GiveawayService({ configService, repository, transport, logsRuntime });
      let result;
      if (action === "create") {
        // L'option de commande conserve le nom `prize` : aucun changement
        // visible de l'interface de /giveaway create. C'est la colonne réelle
        // giveaways.title qui la reçoit, le mapping se fait ici.
        const prize = context.envelope.options.getString("prize");
        // C1 : le salon de publication est celui où la commande est exécutée.
        // Il n'existe aucune colonne giveaways_channel_id.
        result = await service.create({ guildId, channelId: context.envelope.channelId, title: prize, winnersCount: 1, durationMinutes: 1440 });
        await context.envelope.transport.reply({ view: { title: context.t(result.ok ? "giveaway.createSuccess" : "giveaway.createFailed", { prize }), content: "", components: [] }, ephemeral: true });
      } else if (action === "draw") {
        const id = context.envelope.options.getString("id");
        result = await service.draw({ guildId, giveawayId: id });
        // Décision K5 : au-delà du plafond de participations, le tirage est
        // annoncé comme PARTIEL et le total porte un « + ». Un nombre tronqué
        // n'est jamais présenté comme exact.
        const truncated = result.ok && result.entriesTruncated === true;
        const drawKey = truncated ? "giveaway.drawPartial" : (DRAW_MESSAGE_KEY[result.code] || "giveaway.drawFailed");
        const drawVars = {
          winners: (result.winners || []).join(", "),
          total: `${result.entriesTotal ?? 0}${truncated ? "+" : ""}`,
          cap: ENTRIES_SCAN_CAP,
        };
        await context.envelope.transport.reply({ view: { title: context.t(drawKey, drawVars), content: "", components: [] }, ephemeral: true });
      } else {
        // Réponse garantie même pour une valeur d'action inconnue : Discord
        // accepte n'importe quelle chaîne ; sans ce else, la commande ne
        // répondait jamais (« l'application ne répond plus »).
        result = { ok: false, code: "GIVEAWAY_INVALID_ACTION" };
        await context.envelope.transport.reply({ view: { title: context.t("giveaway.invalidAction"), content: "", components: [] }, ephemeral: true });
      }
      return result;
    },
  };
  registry.registerCommand(createCommand);

  registry.registerButton({
    matcher: prefix(`${Id.JOIN}:`),
    permissions: null,
    execute: async (context) => {
      const giveawayId = context.envelope.customId.split(":")[1];
      const guildId = context.guildId;
      const userId = context.envelope.discordMember.id;
      const repository = new SupabaseGiveawayRepository({ supabase: supabase || context.envelope.supabase });
      const service = new GiveawayService({ configService, repository });
      const result = await service.join({ guildId, giveawayId, userId });
      const key = JOIN_MESSAGE_KEY[result.code] || "giveaway.joinFailed";
      await context.envelope.transport.reply({ view: { title: context.t(key), content: "", components: [] }, ephemeral: true });
      return result;
    },
  });

  return { commands: [createCommand] };
}

module.exports = { registerGiveaways };
