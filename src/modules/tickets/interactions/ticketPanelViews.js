"use strict";

const { TicketComponentId: Id } = require("../configuration/ticketConstants");

/**
 * M8 — sous-vue « Panels » de /settings.
 *
 * Budget Discord vérifié : rows() LÈVE au-delà de 5 lignes d'action.
 *
 *   ≤ 10 boutons de panel → packés 5 par ligne → 2 lignes
 *   + sélecteur de salon  →                      1 ligne
 *   + Back                →                      1 ligne
 *   ────────────────────────────────────────────────────
 *                                                 4 lignes  ✅
 *
 * L'ordre compte : les boutons sont placés EN PREMIER pour être packés
 * ensemble. Un sélecteur intercalé forcerait un flush et gaspillerait une
 * ligne.
 */
function ticketPanelsView({ t, panels = [], max = 10 }) {
  const components = [];

  for (const panel of panels) {
    const labels = panel.buttons.map((button) => button.label);
    const summary = labels.length === 0
      ? t("tickets.panelNoButton")
      : labels.length === 1
        ? labels[0]
        : t("tickets.panelSummary", { count: labels.length, first: labels[0] });
    components.push({
      type: "button",
      customId: `${Id.PANELS_DETAIL_PREFIX}${panel.id}`,
      label: `#${panel.id} — ${summary}`.slice(0, 80),
      style: "secondary",
    });
  }

  // Création : le salon vient d'un channel-select. Depuis /settings il n'y a
  // pas de « salon de l'interaction » évident, et inventer une destination
  // serait exactement le défaut corrigé en P12.2 (B1).
  components.push({
    type: "channel-select",
    customId: Id.PANELS_CREATE,
    placeholder: panels.length >= max ? t("tickets.panelLimitReached") : t("tickets.panelCreateIn"),
    channelTypes: [0],
    // Au plafond, le sélecteur est désactivé plutôt que de laisser l'admin
    // choisir un salon pour un envoi qui sera refusé.
    disabled: panels.length >= max,
  });
  components.push({ type: "button", customId: Id.BACK, label: t("tickets.back"), style: "secondary" });

  return {
    title: t("tickets.panelsTitle"),
    content: panels.length === 0
      ? t("tickets.panelsEmpty")
      : t("tickets.panelsCount", { count: panels.length, max }),
    components,
  };
}

/**
 * M8 — détail d'un panel : 3 boutons = 1 ligne d'action.
 */
function ticketPanelDetailView({ t, panel }) {
  const lines = [
    t("tickets.panelDetailId", { id: panel.id }),
    t("tickets.panelDetailChannel", { channel: `<#${panel.channelId}>` }),
    t("tickets.panelDetailCategory", { id: panel.categoryId }),
    t("tickets.panelDetailRole", { id: panel.supportRoleId }),
  ];
  panel.buttons.forEach((button, index) => {
    lines.push(t("tickets.panelDetailButton", {
      index: index + 1,
      label: button.label,
      emoji: button.emoji || "—",
      style: button.style,
    }));
  });

  return {
    title: t("tickets.panelDetailTitle", { id: panel.id }),
    // Un content Discord est limité à 2000 caractères.
    content: lines.join("\n").slice(0, 1900),
    components: [
      { type: "button", customId: `${Id.PANELS_EDIT_PREFIX}${panel.id}`, label: t("tickets.panelEdit"), style: "primary" },
      { type: "button", customId: `${Id.PANELS_DELETE_PREFIX}${panel.id}`, label: t("tickets.panelDelete"), style: "danger" },
      { type: "button", customId: Id.PANELS_SECTION, label: t("tickets.back"), style: "secondary" },
    ],
  };
}

module.exports = { ticketPanelsView, ticketPanelDetailView };
