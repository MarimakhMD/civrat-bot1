"use strict";

const { TicketComponentId: Id, MAX_PANELS_PER_GUILD, MAX_BUTTONS_PER_PANEL, PANEL_BUTTON_STYLES, DISCORD_ID_PATTERN } = require("../configuration/ticketConstants");
const { TicketPanelService } = require("../services/TicketPanelService");
const { TicketPanelDeliveryService } = require("../services/TicketPanelDeliveryService");
const { DiscordTicketTransport } = require("../../../adapters/discord/DiscordTicketTransport");
const { ticketPanelsView, ticketPanelDetailView } = require("./ticketPanelViews");

/**
 * M8 — gestion des panels de tickets depuis /settings.
 *
 * La section Tickets de /settings occupe déjà les 5 lignes d'action autorisées
 * par Discord (vérifié : rows() LÈVE au-delà). La gestion des panels vit donc
 * dans une SOUS-VUE, sur le modèle de la sous-vue Premium.
 *
 * Trois niveaux, tous dans le budget Discord :
 *   1. liste      : ≤ 10 boutons (2 lignes) + sélecteur de salon (1) + Back (1) = 4
 *   2. détail     : Éditer + Supprimer + Back = 1 ligne
 *   3. modale     : 5 champs (limite Discord)
 *
 * Toutes ces routes sont protégées par MANAGE_GUILD (register.js).
 */

function panelServiceOf(context) {
  return new TicketPanelService({
    configService: context.service,
    premiumConfigResolver: context.premiumConfigResolver,
  });
}

function deliveryOf(context) {
  return new TicketPanelDeliveryService({
    panelService: panelServiceOf(context),
    transport: new DiscordTicketTransport({ guild: context.envelope.discordMember?.guild }),
    panelRepository: context.panelRepository,
  });
}

async function replyError(context, code) {
  await context.envelope.transport.reply({
    view: { title: context.t("tickets.title"), content: context.t(`tickets.${code}`), components: [] },
    ephemeral: true,
  });
}

/** `civrat:v1:tickets:panels:edit:<panelId>` → panelId. */
function idFromCustomId(customId, prefix) {
  if (typeof customId !== "string" || !customId.startsWith(prefix)) return null;
  const value = customId.slice(prefix.length);
  return /^\d+$/.test(value) ? value : null;
}

/** Niveau 1 — liste des panels actifs. */
async function openTicketPanels(context) {
  if (!context.panelRepository) return replyError(context, "TICKET_PANELS_UNAVAILABLE");
  let panels;
  try {
    panels = await context.panelRepository.listActive(context.guildId);
  } catch (_error) {
    return replyError(context, "TICKET_PANELS_UNAVAILABLE");
  }
  await context.envelope.transport.update({
    view: ticketPanelsView({ t: context.t, panels, max: MAX_PANELS_PER_GUILD }),
  });
  return { panels: panels.length };
}

/**
 * Niveau 1 — création d'un panel dans le salon sélectionné.
 *
 * Le salon vient d'un channel-select : depuis /settings il n'y a pas de « salon
 * de l'interaction » évident, et inventer une destination serait exactement le
 * défaut corrigé en P12.2 (B1).
 */
async function createTicketPanel(context) {
  const channelId = context.envelope.values?.[0] || null;
  if (!channelId) return replyError(context, "CHANNEL_UNAVAILABLE");

  const panelService = panelServiceOf(context);
  const draft = await panelService.defaultDraft({ guildId: context.guildId, t: context.t });
  const result = await deliveryOf(context).deliver({
    guildId: context.guildId,
    t: context.t,
    channelId,
    draft,
  });
  if (!result.delivered) return replyError(context, result.code);
  await context.envelope.transport.reply({
    view: {
      title: context.t("tickets.title"),
      content: context.t("tickets.panelCreated", { channel: `<#${channelId}>`, id: result.panelId }),
      components: [],
    },
    ephemeral: true,
  });
  return result;
}

/** Niveau 2 — détail d'un panel. */
async function openPanelDetail(context) {
  const panelId = idFromCustomId(context.envelope.customId, Id.PANELS_DETAIL_PREFIX);
  if (!panelId || !context.panelRepository) return replyError(context, "TICKET_PANEL_UNAVAILABLE");

  let panel;
  try {
    panel = await context.panelRepository.findActive(context.guildId, panelId);
  } catch (_error) {
    return replyError(context, "TICKET_PANELS_UNAVAILABLE");
  }
  if (!panel) return replyError(context, "TICKET_PANEL_UNAVAILABLE");

  await context.envelope.transport.update({ view: ticketPanelDetailView({ t: context.t, panel }) });
  return { panelId: panel.id };
}

/**
 * Niveau 3 — modale d'édition (décision D-D).
 *
 * Cinq champs, soit la limite Discord :
 *   catégorie · rôle support · libellé 1 · emoji 1 · libellés 2-5 (JSON compact)
 *
 * Le dernier champ accepte une liste compacte « Libellé|emoji|style » par ligne.
 * C'est un compromis assumé : une modale ne peut pas porter 5 boutons × 4
 * attributs, et ajouter une seconde modale ferait perdre le contexte.
 */
async function openPanelEditModal(context) {
  const panelId = idFromCustomId(context.envelope.customId, Id.PANELS_EDIT_PREFIX);
  if (!panelId || !context.panelRepository) return replyError(context, "TICKET_PANEL_UNAVAILABLE");

  let panel;
  try {
    panel = await context.panelRepository.findActive(context.guildId, panelId);
  } catch (_error) {
    return replyError(context, "TICKET_PANELS_UNAVAILABLE");
  }
  if (!panel) return replyError(context, "TICKET_PANEL_UNAVAILABLE");

  const first = panel.buttons[0] || { label: "", emoji: null, style: "primary" };
  const rest = panel.buttons.slice(1)
    .map((b) => [b.label, b.emoji || "", b.style].join("|"))
    .join("\n");

  await context.envelope.transport.showModal({
    customId: `${Id.PANELS_EDIT_SUBMIT_PREFIX}${panel.id}`,
    title: context.t("tickets.panelEditTitle"),
    fields: [
      { id: "category_id", label: context.t("tickets.panelFieldCategory"), style: "short", value: panel.categoryId, required: false },
      { id: "support_role_id", label: context.t("tickets.panelFieldRole"), style: "short", value: panel.supportRoleId, required: false },
      { id: "button_label", label: context.t("tickets.panelFieldButtonLabel"), style: "short", value: first.label, required: false },
      { id: "button_emoji", label: context.t("tickets.panelFieldButtonEmoji"), style: "short", value: first.emoji || "", required: false },
      { id: "buttons_extra", label: context.t("tickets.panelFieldButtonsExtra"), style: "paragraph", value: rest, required: false },
    ],
  });
  return { panelId: panel.id };
}

/**
 * M8 — analyse des lignes « Libellé|emoji|style ».
 * Une ligne vide ou malformée est ignorée silencieusement ICI, mais
 * validateButtons refusera ensuite tout bouton sans libellé : la saisie
 * humaine est validée, jamais tronquée en silence.
 */
function parseExtraButtons(raw) {
  const lines = String(raw || "").split("\n");
  const buttons = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [label, emoji, style] = trimmed.split("|").map((part) => (part || "").trim());
    if (!label) continue;
    buttons.push({
      label,
      emoji: emoji || null,
      style: PANEL_BUTTON_STYLES.includes(style) ? style : "primary",
      category_id: null,
      support_role_id: null,
    });
  }
  return buttons;
}

/** Niveau 3 — soumission de la modale. */
async function submitPanelEdit(context) {
  const panelId = idFromCustomId(context.envelope.customId, Id.PANELS_EDIT_SUBMIT_PREFIX);
  if (!panelId || !context.panelRepository) return replyError(context, "TICKET_PANEL_UNAVAILABLE");

  let panel;
  try {
    panel = await context.panelRepository.findActive(context.guildId, panelId);
  } catch (_error) {
    return replyError(context, "TICKET_PANELS_UNAVAILABLE");
  }
  if (!panel) return replyError(context, "TICKET_PANEL_UNAVAILABLE");

  const fields = context.envelope.fields || {};
  const categoryId = (fields.category_id || "").trim() || panel.categoryId;
  const supportRoleId = (fields.support_role_id || "").trim() || panel.supportRoleId;
  // ───────────────────────────────────────────────────────────────────────
  // 4G C3 — ces deux valeurs viennent d'une modale : un client modifié peut y
  // mettre n'importe quelle chaîne. On valide le format snowflake AVANT toute
  // écriture, sur le même principe que validateButtons juste en dessous.
  //
  // Sans cela, build() ne vérifie que la non-vacuité et publiait un panel dont
  // la catégorie ou le rôle n'existe pas : le panel s'affichait, puis chaque
  // ouverture échouait en TICKET_CONFIG_INCOMPLETE. Le transport étant scopé
  // par guilde, il n'y avait pas de fuite cross-guilde — seulement un panel
  // mort. Le refus est maintenant explicite et immédiat.
  // ───────────────────────────────────────────────────────────────────────
  if (!DISCORD_ID_PATTERN.test(categoryId) || !DISCORD_ID_PATTERN.test(supportRoleId)) {
    return replyError(context, "TICKET_INVALID_DISCORD_ID");
  }
  const firstLabel = (fields.button_label || "").trim();
  const firstEmoji = (fields.button_emoji || "").trim() || null;

  const buttons = [];
  if (firstLabel) {
    buttons.push({ label: firstLabel, emoji: firstEmoji, style: panel.buttons[0]?.style || "primary", category_id: null, support_role_id: null });
  }
  buttons.push(...parseExtraButtons(fields.buttons_extra));

  // Validation stricte AVANT toute écriture : une saisie invalide est refusée,
  // jamais nettoyée en silence.
  const validated = panelServiceOf(context).validateButtons(buttons);
  if (!validated.valid) return replyError(context, validated.code);
  if (validated.buttons.length > MAX_BUTTONS_PER_PANEL) return replyError(context, "TICKET_PANEL_TOO_MANY_BUTTONS");

  const result = await deliveryOf(context).redeliver({
    guildId: context.guildId,
    t: context.t,
    panel,
    updates: { categoryId, supportRoleId, buttons: validated.buttons },
  });
  if (!result.delivered) return replyError(context, result.code);

  await context.envelope.transport.reply({
    view: { title: context.t("tickets.title"), content: context.t("tickets.panelUpdated", { id: panel.id }), components: [] },
    ephemeral: true,
  });
  await context.envelope.transport.update({ view: ticketPanelsView({ t: context.t, panels: await context.panelRepository.listActive(context.guildId), max: MAX_PANELS_PER_GUILD }) });
  return result;
}

/**
 * Suppression = désactivation.
 *
 * is_active = false, JAMAIS de DELETE : la base ne le concède pas à
 * service_role, et l'historique des panels doit rester consultable. Le message
 * Discord est supprimé en best-effort.
 */
async function deleteTicketPanel(context) {
  const panelId = idFromCustomId(context.envelope.customId, Id.PANELS_DELETE_PREFIX);
  if (!panelId || !context.panelRepository) return replyError(context, "TICKET_PANEL_UNAVAILABLE");

  let panel;
  try {
    panel = await context.panelRepository.findActive(context.guildId, panelId);
  } catch (_error) {
    return replyError(context, "TICKET_PANELS_UNAVAILABLE");
  }
  if (!panel) return replyError(context, "TICKET_PANEL_UNAVAILABLE");

  const result = await deliveryOf(context).deactivate({ guildId: context.guildId, panel });
  if (!result.deactivated) return replyError(context, result.code || "TICKET_PANEL_UNAVAILABLE");

  await context.envelope.transport.reply({
    view: { title: context.t("tickets.title"), content: context.t("tickets.panelDeleted", { id: panel.id }), components: [] },
    ephemeral: true,
  });
  await context.envelope.transport.update({
    view: ticketPanelsView({ t: context.t, panels: await context.panelRepository.listActive(context.guildId), max: MAX_PANELS_PER_GUILD }),
  });
  return result;
}

module.exports = {
  openTicketPanels,
  createTicketPanel,
  openPanelDetail,
  openPanelEditModal,
  submitPanelEdit,
  deleteTicketPanel,
  parseExtraButtons,
};
