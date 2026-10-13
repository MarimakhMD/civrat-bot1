"use strict";

const { PermissionName } = require("../../core/permissions");
const { prefix } = require("../../core/interactions/routeMatchers");
const { AutoModComponentId: Id } = require("./configuration/automodConstants");
const { autoModView, autoModExemptView } = require("./interactions/automodViews");
const {
  toggleAutoModEnable,
  toggleAutoModDelete,
  toggleAutoModRule,
  openAutoModThresholds,
  submitAutoModThresholds,
  openAutoModBadWords,
  submitAutoModBadWords,
  selectAutoModEnforcement,
  selectAutoModExemptRoles,
  selectAutoModExemptChannels,
  resetAutoModExemptRoles,
  resetAutoModExemptChannels,
} = require("./interactions/configureAutoMod");

function registerAutoMod({ registry, service, settingsHome = null }) {
  const permissions = { allOf: [PermissionName.MANAGE_GUILD] };
  const render = async (context) =>
    context.envelope.transport.update({ view: autoModView({ t: context.t, config: await service.read(context.guildId) }) });
  // P7 — sous-vue Exemptions ; re-rendue après chaque écriture validée.
  const renderExempt = async (context) =>
    context.envelope.transport.update({ view: autoModExemptView({ t: context.t, config: await service.read(context.guildId) }) });

  registry.registerButton({ customId: Id.SECTION, permissions, execute: render });
  registry.registerButton({
    customId: Id.TOGGLE,
    permissions,
    execute: async (context) => {
      await toggleAutoModEnable({ ...context, service });
      return render(context);
    },
  });
  registry.registerButton({
    customId: Id.DELETE_MESSAGE,
    permissions,
    execute: async (context) => {
      await toggleAutoModDelete({ ...context, service });
      return render(context);
    },
  });
  registry.registerButton({ customId: Id.THRESHOLDS_OPEN, permissions, execute: async (context) => openAutoModThresholds({ ...context, service }) });
  registry.registerButton({ customId: Id.BAD_WORDS_OPEN, permissions, execute: async (context) => openAutoModBadWords({ ...context, service }) });
  registry.registerButton({ customId: Id.BACK, permissions, execute: settingsHome });
  registry.registerButton({
    // Route prefix DÉJÀ enregistrée depuis P2/P3 — AUCUNE route ajoutée.
    // Dispatch par segment (GO correction routes P7) :
    //   exempt-open / exempt-back / exempt-reset-* → sous-vue Exemptions ;
    //   tout autre segment → toggle de règle historique (inchangé).
    matcher: prefix(`${Id.TOGGLE_PREFIX}:`),
    permissions,
    execute: async (context) => {
      const segment = context.envelope.customId.split(":").pop();
      if (segment === "exempt-open") return renderExempt(context);
      if (segment === "exempt-back") return render(context);
      if (segment === "exempt-reset-roles" || segment === "exempt-reset-channels") {
        const saved = segment === "exempt-reset-roles"
          ? await resetAutoModExemptRoles({ ...context, service })
          : await resetAutoModExemptChannels({ ...context, service });
        if (saved === null) return; // rate-limit P6 : réponse déjà éphémère, pas de render
        return renderExempt(context);
      }
      await toggleAutoModRule({ ...context, service });
      return render(context);
    },
  });
  registry.registerModal({
    matcher: prefix(Id.THRESHOLDS_MODAL),
    permissions,
    execute: async (context) => {
      await submitAutoModThresholds({ ...context, service });
      return render(context);
    },
  });
  registry.registerModal({
    matcher: prefix(Id.BAD_WORDS_MODAL),
    permissions,
    execute: async (context) => {
      await submitAutoModBadWords({ ...context, service });
      return render(context);
    },
  });
  registry.registerSelectMenu({
    // Route prefix unique pour TOUS les selects AutoMod (GO correction
    // routes P7) : enforce + exemptions rôles/salons partagent CE SEUL
    // enregistrement — les compteurs Phase 0 restent à 21 SELECT_MENU
    // (précédent : logs `prefix(CHANNEL_PREFIX:)`).
    matcher: prefix(Id.SELECT_PREFIX),
    permissions,
    execute: async (context) => {
      const customId = context.envelope.customId;
      if (customId === Id.EXEMPT_ROLES_SELECT) {
        const saved = await selectAutoModExemptRoles({ ...context, service });
        if (saved === null) return; // rate-limit P6 : pas de render
        return renderExempt(context);
      }
      if (customId === Id.EXEMPT_CHANNELS_SELECT) {
        const saved = await selectAutoModExemptChannels({ ...context, service });
        if (saved === null) return;
        return renderExempt(context);
      }
      await selectAutoModEnforcement({ ...context, service });
      return render(context);
    },
  });

  const command = {
    name: "automod",
    description: "Open AutoMod settings",
    permissions,
    execute: async (context) => {
      await context.envelope.transport.reply({
        view: autoModView({ t: context.t, config: await service.read(context.guildId) }),
        ephemeral: true,
      });
    },
  };
  registry.registerCommand(command);

  return { id: Id.SECTION, permissions, commands: [command] };
}

module.exports = { registerAutoMod };
