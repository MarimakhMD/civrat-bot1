"use strict";

const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const { TicketPremiumConfigKey: PKey } = require("../configuration/ticketPremiumConstants");
const { validateTicketPremiumUpdates } = require("../configuration/ticketPremiumValidation");
const { TicketPanelService } = require("../services/TicketPanelService");

// Les 5 champs de la modale (limite Discord : 5 inputs par modale). style
// « paragraph » pour la description : texte long et multi-ligne possible.
const MODAL_FIELDS = Object.freeze([
  { id: "panel_title", key: PKey.PANEL_TITLE, labelKey: "tickets.premiumFieldTitle", style: "short" },
  { id: "panel_description", key: PKey.PANEL_DESCRIPTION, labelKey: "tickets.premiumFieldDescription", style: "paragraph" },
  { id: "panel_color", key: PKey.PANEL_COLOR, labelKey: "tickets.premiumFieldColor", style: "short" },
  { id: "panel_image_url", key: PKey.PANEL_IMAGE_URL, labelKey: "tickets.premiumFieldImage", style: "short" },
  { id: "panel_button_label", key: PKey.CREATE_BUTTON_LABEL, labelKey: "tickets.premiumFieldButtonLabel", style: "short" },
]);

const ERROR_KEY_BY_FIELD = Object.freeze({
  [PKey.PANEL_TITLE]: "tickets.premiumErrorTitle",
  [PKey.PANEL_DESCRIPTION]: "tickets.premiumErrorDescription",
  [PKey.PANEL_COLOR]: "tickets.premiumErrorColor",
  [PKey.PANEL_IMAGE_URL]: "tickets.premiumErrorImage",
  [PKey.CREATE_BUTTON_LABEL]: "tickets.premiumErrorButtonLabel",
});

// Les valeurs affichées dans la vue sont tronquées : le content d'un message
// Discord est limité à 2000 caractères.
function truncate(value, max = 140) {
  const text = String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function backButton(t) {
  return { type: "button", customId: Id.PANEL, label: t("tickets.back"), style: "secondary" };
}

// Vue verrouillée : aucun contrôle Premium utilisable, uniquement le Retour.
function premiumLockedView({ t }) {
  return {
    title: t("tickets.premiumLockedTitle"),
    content: t("tickets.premiumLockedDescription"),
    components: [backButton(t)],
  };
}

// Vue active : valeurs résolues (fallback Free affiché explicitement) +
// 4 boutons = 1 seule action row, loin de la limite Discord de 5.
function premiumPanelView({ t, premium, notice = null }) {
  const line = (labelKey, value) => `${t(labelKey)} : ${value ? truncate(value) : t("tickets.premiumStateDefault")}`;
  const content = [
    notice,
    t("tickets.premiumActiveDescription"),
    line("tickets.premiumFieldTitle", premium[PKey.PANEL_TITLE]),
    line("tickets.premiumFieldDescription", premium[PKey.PANEL_DESCRIPTION]),
    line("tickets.premiumFieldColor", premium[PKey.PANEL_COLOR]),
    line("tickets.premiumFieldImage", premium[PKey.PANEL_IMAGE_URL]),
    line("tickets.premiumFieldButtonLabel", premium[PKey.CREATE_BUTTON_LABEL]),
  ].filter(Boolean).join("\n");
  return {
    title: t("tickets.premiumActiveTitle"),
    content,
    components: [
      { type: "button", customId: Id.PREMIUM_EDIT, label: t("tickets.premiumEdit"), style: "primary" },
      { type: "button", customId: Id.PREMIUM_PREVIEW, label: t("tickets.premiumPreview"), style: "secondary" },
      { type: "button", customId: Id.PREMIUM_RESET, label: t("tickets.premiumReset"), style: "danger" },
      backButton(t),
    ],
  };
}

async function isPremiumActive({ guildId, premiumConfigResolver }) {
  if (!premiumConfigResolver || typeof premiumConfigResolver.isActive !== "function") return false;
  return premiumConfigResolver.isActive(guildId);
}

async function renderLocked(context) {
  return context.envelope.transport.update({ view: premiumLockedView({ t: context.t }) });
}

// Entrée « ✨ Personnalisation Premium » depuis la section Tickets.
async function openPremiumPanel(context) {
  if (!(await isPremiumActive(context))) return renderLocked(context);
  const config = await context.service.read(context.guildId);
  const premium = await context.premiumConfigResolver.resolve({ guildId: context.guildId, config });
  return context.envelope.transport.update({ view: premiumPanelView({ t: context.t, premium }) });
}

// Ouvre la modale d'édition (5 champs pré-remplis des valeurs résolues).
async function openPremiumPanelModal(context) {
  if (!(await isPremiumActive(context))) return renderLocked(context);
  const config = await context.service.read(context.guildId);
  const premium = await context.premiumConfigResolver.resolve({ guildId: context.guildId, config });
  return context.envelope.transport.showModal({
    customId: Id.PREMIUM_EDIT_SUBMIT,
    title: context.t("tickets.premiumModalTitle"),
    fields: MODAL_FIELDS.map((field) => ({
      id: field.id,
      label: context.t(field.labelKey),
      value: premium[field.key] || "",
      required: false,
      style: field.style,
    })),
  });
}

function normalizeModalValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Soumission : l'entitlement est revérifié (jamais d'écriture Premium sans
// entitlement actif), puis la validation rejette toute valeur invalide sans
// écrire (tout-ou-rien), sinon les 5 clés sont persistées (champ vide = null =
// retour au default Free pour cette clé).
async function submitPremiumPanel(context) {
  if (!(await isPremiumActive(context))) return renderLocked(context);
  const values = context.envelope.modalValues || {};
  const updates = Object.fromEntries(MODAL_FIELDS.map((field) => [field.key, normalizeModalValue(values[field.id])]));
  try {
    validateTicketPremiumUpdates(updates);
  } catch (error) {
    const key = ERROR_KEY_BY_FIELD[error.metadata?.field] || "tickets.premiumErrorGeneric";
    await context.envelope.transport.reply({
      view: { title: context.t("tickets.premiumActiveTitle"), content: context.t(key), components: [] },
      ephemeral: true,
    });
    return { saved: false, error };
  }
  const config = await context.service.update(context.guildId, updates);
  const premium = await context.premiumConfigResolver.resolve({ guildId: context.guildId, config });
  await context.envelope.transport.update({
    view: premiumPanelView({ t: context.t, premium, notice: `✅ ${context.t("tickets.premiumSaved")}` }),
  });
  return { saved: true };
}

// Réinitialisation : les 5 clés panneau repassent à null → defaults Free.
async function resetPremiumPanel(context) {
  if (!(await isPremiumActive(context))) return renderLocked(context);
  const updates = Object.fromEntries(MODAL_FIELDS.map((field) => [field.key, null]));
  validateTicketPremiumUpdates(updates);
  const config = await context.service.update(context.guildId, updates);
  const premium = await context.premiumConfigResolver.resolve({ guildId: context.guildId, config });
  await context.envelope.transport.update({
    view: premiumPanelView({ t: context.t, premium, notice: `✅ ${context.t("tickets.premiumResetDone")}` }),
  });
  return { reset: true };
}

// Aperçu fidèle : le panneau est construit par le même TicketPanelService que
// /ticketpanel, puis rendu en embed éphémère (couleur/image incluses).
async function previewPremiumPanel(context) {
  if (!(await isPremiumActive(context))) return renderLocked(context);
  const panelService = new TicketPanelService({ configService: context.service, premiumConfigResolver: context.premiumConfigResolver });
  const panel = await panelService.build(context.guildId, context.t);
  if (!panel.ready) {
    await context.envelope.transport.reply({
      view: { title: context.t("tickets.title"), content: context.t(`tickets.${panel.code}`), components: [] },
      ephemeral: true,
    });
    return panel;
  }
  await context.envelope.transport.replyEmbed({
    embed: {
      title: panel.view.title,
      description: panel.view.content,
      color: panel.view.embed?.color || null,
      image: panel.view.embed?.image || null,
    },
    components: panel.view.components,
    ephemeral: true,
  });
  return panel;
}

module.exports = {
  MODAL_FIELDS,
  premiumLockedView,
  premiumPanelView,
  openPremiumPanel,
  openPremiumPanelModal,
  submitPremiumPanel,
  resetPremiumPanel,
  previewPremiumPanel,
};
