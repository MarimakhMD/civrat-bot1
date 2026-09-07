"use strict";

const {
  EntitlementDecision,
  premiumRequiredView,
} = require("../../../core/entitlements");
const { TicketConfigKey: Key, TicketComponentId: Id } = require("../configuration/ticketConstants");
const { TicketPremiumConfigKey: PKey } = require("../configuration/ticketPremiumConstants");
const { validateTicketPremiumUpdates } = require("../configuration/ticketPremiumValidation");
const { TicketPanelService } = require("../services/TicketPanelService");
const { TicketWelcomeService } = require("../services/TicketWelcomeService");

// Les 5 champs de la modale panneau (limite Discord : 5 inputs par modale).
// style « paragraph » pour la description : texte long et multi-ligne possible.
const MODAL_FIELDS = Object.freeze([
  { id: "panel_title", key: PKey.PANEL_TITLE, labelKey: "tickets.premiumFieldTitle", style: "short" },
  { id: "panel_description", key: PKey.PANEL_DESCRIPTION, labelKey: "tickets.premiumFieldDescription", style: "paragraph" },
  { id: "panel_color", key: PKey.PANEL_COLOR, labelKey: "tickets.premiumFieldColor", style: "short" },
  { id: "panel_image_url", key: PKey.PANEL_IMAGE_URL, labelKey: "tickets.premiumFieldImage", style: "short" },
  { id: "panel_button_label", key: PKey.CREATE_BUTTON_LABEL, labelKey: "tickets.premiumFieldButtonLabel", style: "short" },
]);

// Champ de la modale d'accueil (Phase 10.3) : modale dédiée, la modale panneau
// est déjà pleine (5/5 inputs Discord).
const WELCOME_FIELD = Object.freeze({ id: "welcome_message", key: PKey.WELCOME_MESSAGE, labelKey: "tickets.premiumFieldWelcomeMessage", style: "paragraph" });

// Champ de la modale de nommage (Phase 10.4) : format court, ex. ticket-{number}.
const FORMAT_FIELD = Object.freeze({ id: "name_format", key: PKey.NAME_FORMAT, labelKey: "tickets.premiumFieldNameFormat", style: "short" });

// Clés remises à null par « Réinitialiser (Free) » : panneau (10.2) + contenu
// (10.3) + nommage (10.4). null = retour au default Free pour chaque clé.
const RESETTABLE_KEYS = Object.freeze([...MODAL_FIELDS.map((field) => field.key), PKey.WELCOME_MESSAGE, PKey.TRANSCRIPT_CHANNEL_ID, PKey.NAME_FORMAT]);

const ERROR_KEY_BY_FIELD = Object.freeze({
  [PKey.PANEL_TITLE]: "tickets.premiumErrorTitle",
  [PKey.PANEL_DESCRIPTION]: "tickets.premiumErrorDescription",
  [PKey.PANEL_COLOR]: "tickets.premiumErrorColor",
  [PKey.PANEL_IMAGE_URL]: "tickets.premiumErrorImage",
  [PKey.CREATE_BUTTON_LABEL]: "tickets.premiumErrorButtonLabel",
  [PKey.WELCOME_MESSAGE]: "tickets.premiumErrorWelcomeMessage",
  [PKey.TRANSCRIPT_CHANNEL_ID]: "tickets.premiumErrorGeneric",
  [PKey.NAME_FORMAT]: "tickets.premiumErrorNameFormat",
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

// La fonctionnalité reste visible depuis Tickets. Sans accès, la vue centrale
// explique Premium ou l'indisponibilité du contrôle et conserve le retour.
function premiumLockedView({ t, decision = EntitlementDecision.PREMIUM_REQUIRED }) {
  return premiumRequiredView(t, {
    decision,
    components: [backButton(t)],
  });
}

// Vue active : valeurs résolues (fallback Free affiché explicitement) +
// contrôles. Packing réel (DiscordResponseTransport) : 5 boutons sur la 1re
// ligne, puis le salon transcript (select), puis Retour = 3 lignes, sous la
// limite Discord de 5 lignes d'action.
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
    line("tickets.premiumFieldWelcomeMessage", premium[PKey.WELCOME_MESSAGE]),
    line("tickets.premiumFieldNameFormat", premium[PKey.NAME_FORMAT]),
    `${t("tickets.premiumFieldTranscriptChannel")} : ${premium[PKey.TRANSCRIPT_CHANNEL_ID] ? `<#${premium[PKey.TRANSCRIPT_CHANNEL_ID]}>` : t("tickets.premiumStateDefault")}`,
    t("tickets.premiumPlaceholdersHelp"),
    t("tickets.premiumNameFormatHelp"),
  ].filter(Boolean).join("\n");
  return {
    title: t("tickets.premiumActiveTitle"),
    content,
    components: [
      { type: "button", customId: Id.PREMIUM_EDIT, label: t("tickets.premiumEdit"), style: "primary" },
      { type: "button", customId: Id.PREMIUM_PREVIEW, label: t("tickets.premiumPreview"), style: "secondary" },
      { type: "button", customId: Id.PREMIUM_EDIT_WELCOME, label: t("tickets.premiumEditWelcome"), style: "primary" },
      { type: "button", customId: Id.PREMIUM_PREVIEW_WELCOME, label: t("tickets.premiumPreviewWelcome"), style: "secondary" },
      { type: "button", customId: Id.PREMIUM_EDIT_FORMAT, label: t("tickets.premiumEditNameFormat"), style: "primary" },
      { type: "button", customId: Id.PREMIUM_RESET, label: t("tickets.premiumReset"), style: "danger" },
      { type: "channel-select", customId: Id.PREMIUM_TRANSCRIPT, placeholder: t("tickets.premiumFieldTranscriptChannel"), channelTypes: [0] },
      backButton(t),
    ],
  };
}

async function getPremiumDecision({ guildId, premiumConfigResolver }) {
  if (!premiumConfigResolver || typeof premiumConfigResolver.checkAccess !== "function") {
    return { ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE };
  }
  return premiumConfigResolver.checkAccess(guildId);
}

async function requirePremium(context) {
  const decision = await getPremiumDecision(context);
  if (decision.granted) return decision;
  await context.envelope.transport.update({
    view: premiumLockedView({ t: context.t, decision: decision.code }),
  });
  return null;
}

async function resolvePremiumConfig(context, decision = null) {
  const config = await context.service.read(context.guildId);
  return context.premiumConfigResolver.resolve({ guildId: context.guildId, config, decision });
}

async function renderActive(context, notice = null, config = null, decision = null) {
  const resolved = config || await context.service.read(context.guildId);
  const premium = await context.premiumConfigResolver.resolve({
    guildId: context.guildId,
    config: resolved,
    decision,
  });
  return context.envelope.transport.update({ view: premiumPanelView({ t: context.t, premium, notice }) });
}

// Entrée « ✨ Personnalisation Premium » depuis la section Tickets.
async function openPremiumPanel(context) {
  const decision = await requirePremium(context);
  if (!decision) return null;
  const premium = await resolvePremiumConfig(context, decision);
  return context.envelope.transport.update({ view: premiumPanelView({ t: context.t, premium }) });
}

// Ouvre la modale d'édition du panneau (5 champs pré-remplis des valeurs résolues).
async function openPremiumPanelModal(context) {
  const decision = await requirePremium(context);
  if (!decision) return null;
  const premium = await resolvePremiumConfig(context, decision);
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

// Soumission modale générique : l'entitlement est revérifié (jamais d'écriture
// Premium sans entitlement actif), la validation rejette toute valeur invalide
// sans écrire (tout-ou-rien), sinon les clés sont persistées (champ vide =
// null = retour au default Free pour cette clé) et la vue est rafraîchie.
async function submitPremiumUpdates(context, updates, savedKey) {
  const decision = await requirePremium(context);
  if (!decision) return { saved: false, decision: null };
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
  await renderActive(context, `✅ ${context.t(savedKey)}`, config, decision);
  return { saved: true };
}

async function submitPremiumPanel(context) {
  const values = context.envelope.modalValues || {};
  const updates = Object.fromEntries(MODAL_FIELDS.map((field) => [field.key, normalizeModalValue(values[field.id])]));
  return submitPremiumUpdates(context, updates, "tickets.premiumSaved");
}

// Phase 10.3 — modale dédiée au message d'accueil du ticket (1 champ paragraph,
// pré-rempli de la valeur résolue).
async function openPremiumWelcomeModal(context) {
  const decision = await requirePremium(context);
  if (!decision) return null;
  const premium = await resolvePremiumConfig(context, decision);
  return context.envelope.transport.showModal({
    customId: Id.PREMIUM_EDIT_WELCOME_SUBMIT,
    title: context.t("tickets.premiumWelcomeModalTitle"),
    fields: [{ id: WELCOME_FIELD.id, label: context.t(WELCOME_FIELD.labelKey), value: premium[WELCOME_FIELD.key] || "", required: false, style: WELCOME_FIELD.style }],
  });
}

async function submitPremiumWelcome(context) {
  const values = context.envelope.modalValues || {};
  return submitPremiumUpdates(context, { [WELCOME_FIELD.key]: normalizeModalValue(values[WELCOME_FIELD.id]) }, "tickets.premiumWelcomeSaved");
}

// Phase 10.4 — modale dédiée au format de nommage des salons (1 champ court,
// pré-rempli de la valeur résolue ; placeholder d'unicité imposé par la
// validation, rejet sans écriture sinon).
async function openPremiumFormatModal(context) {
  const decision = await requirePremium(context);
  if (!decision) return null;
  const premium = await resolvePremiumConfig(context, decision);
  return context.envelope.transport.showModal({
    customId: Id.PREMIUM_EDIT_FORMAT_SUBMIT,
    title: context.t("tickets.premiumNameFormatModalTitle"),
    fields: [{ id: FORMAT_FIELD.id, label: context.t(FORMAT_FIELD.labelKey), value: premium[FORMAT_FIELD.key] || "", required: false, style: FORMAT_FIELD.style }],
  });
}

async function submitPremiumFormat(context) {
  const values = context.envelope.modalValues || {};
  return submitPremiumUpdates(context, { [FORMAT_FIELD.key]: normalizeModalValue(values[FORMAT_FIELD.id]) }, "tickets.premiumNameFormatSaved");
}

// Phase 10.3 — salon de destination des transcripts (select salon texte ;
// la remise à null passe par « Réinitialiser (Free) »).
async function selectPremiumTranscript(context) {
  const channelId = context.envelope.values?.[0] || null;
  return submitPremiumUpdates(context, { [PKey.TRANSCRIPT_CHANNEL_ID]: channelId }, "tickets.premiumTranscriptSaved");
}

// Réinitialisation : toutes les clés de la sous-vue repassent à null → defaults Free.
async function resetPremiumPanel(context) {
  const decision = await requirePremium(context);
  if (!decision) return { reset: false };
  const updates = Object.fromEntries(RESETTABLE_KEYS.map((key) => [key, null]));
  validateTicketPremiumUpdates(updates);
  const config = await context.service.update(context.guildId, updates);
  await renderActive(context, `✅ ${context.t("tickets.premiumResetDone")}`, config, decision);
  return { reset: true };
}

// Aperçu fidèle du panneau : construit par le même TicketPanelService que
// /ticketpanel, rendu en embed éphémère (couleur/image incluses).
async function previewPremiumPanel(context) {
  const decision = await requirePremium(context);
  if (!decision) return null;
  const panelService = new TicketPanelService({ configService: context.service, premiumConfigResolver: context.premiumConfigResolver });
  // M8 — mode APERÇU : aucun panel n'existe ici, donc aucun panelId à encoder.
  // panel: null fait retomber la vue sur le rendu historique à un bouton de
  // customId civrat:v1:tickets:create. L'aperçu montre le CHROME (titre,
  // description, couleur, image, libellé), qui reste global via guild_configs.
  const panel = await panelService.build({ guildId: context.guildId, panel: null, t: context.t });
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

// Phase 10.3 — aperçu fidèle de l'embed d'accueil du ticket : même
// TicketWelcomeService qu'à la création, membre = l'admin qui prévisualise,
// rôle support = celui configuré (placeholder neutre si non configuré).
async function previewPremiumWelcome(context) {
  const decision = await requirePremium(context);
  if (!decision) return null;
  const config = await context.service.read(context.guildId);
  const premium = await context.premiumConfigResolver.resolve({ guildId: context.guildId, config, decision });
  const member = context.envelope.discordMember || { id: context.userId };
  const supportRole = { id: config[Key.SUPPORT_ROLE_ID] || "0" };
  const welcome = new TicketWelcomeService().build({ t: context.t, member, supportRole, welcomeMessage: premium[PKey.WELCOME_MESSAGE] });
  await context.envelope.transport.replyEmbed({
    embed: { title: welcome.title, description: welcome.description, fields: welcome.fields },
    components: welcome.components,
    ephemeral: true,
  });
  return welcome;
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
  openPremiumWelcomeModal,
  submitPremiumWelcome,
  previewPremiumWelcome,
  selectPremiumTranscript,
  openPremiumFormatModal,
  submitPremiumFormat,
};
