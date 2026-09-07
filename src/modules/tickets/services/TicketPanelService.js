"use strict";

const {
  TicketConfigKey: Key,
  TicketComponentId: Id,
  MAX_BUTTONS_PER_PANEL,
  PANEL_BUTTON_STYLES,
} = require("../configuration/ticketConstants");
const { TicketPremiumConfigKey: PKey } = require("../configuration/ticketPremiumConstants");
const { normalizeButtons, resolveButtonTarget } = require("../persistence/TicketPanelRepository");

/**
 * M8 — Construction de la vue d'un panel de tickets.
 *
 * DEUX modes, une seule fonction :
 *
 *  1. `panel` fourni (cas nominal) : la vue est construite depuis la LIGNE de
 *     public.ticket_panels. Les boutons portent le customId
 *         civrat:v1:tickets:create:<panelId>:<buttonIndex>
 *     qui identifie le panel ET le type de ticket demandé.
 *
 *  2. `panel` absent (aperçu Premium de /settings) : aucun panel n'existe
 *     encore, il n'y a donc pas d'identifiant à encoder. La vue retombe sur le
 *     rendu historique à UN bouton de customId `civrat:v1:tickets:create`.
 *     C'est volontaire : l'aperçu montre le CHROME (titre, description,
 *     couleur, image, libellé), pas un panel réel.
 *
 * Le chrome reste GLOBAL : titre, description, couleur et image viennent de
 * guild_configs via le resolver Premium (décision M8 validée). Seuls les
 * boutons — libellé, emoji, style, catégorie, rôle — sont propres au panel.
 */
class TicketPanelService {
  constructor({ configService, premiumConfigResolver = null }) {
    this.configService = configService;
    this.premiumConfigResolver = premiumConfigResolver;
  }

  /**
   * @param {object}  options
   * @param {string}  options.guildId
   * @param {object|null} [options.panel] Ligne de ticket_panels (forme domaine).
   * @param {Function} options.t Traducteur.
   */
  async build({ guildId, panel = null, t } = {}) {
    const config = await this.configService.read(guildId);
    if (!config[Key.ENABLED]) return { ready: false, code: "TICKETS_DISABLED", details: {} };

    // En mode panel, la catégorie et le rôle viennent de la LIGNE (validée à la
    // création). En mode aperçu, ils viennent encore de guild_configs.
    const categoryId = panel ? panel.categoryId : config[Key.CATEGORY_ID];
    const supportRoleId = panel ? panel.supportRoleId : config[Key.SUPPORT_ROLE_ID];
    if (!categoryId || !supportRoleId) return { ready: false, code: "TICKET_CONFIG_INCOMPLETE", details: {} };

    // Phase 10.2 — personnalisations Premium du CHROME : consommées uniquement
    // quand l'entitlement TICKET_PREMIUM est actif (résolution en couches,
    // fail-closed). Sans resolver injecté (composition Free) ou sans
    // entitlement, le rendu reste strictement le rendu Free historique.
    const premium = this.premiumConfigResolver
      ? await this.premiumConfigResolver.resolve({ guildId, config })
      : null;
    const override = (key) => (premium && premium[key]) || null;

    const components = panel
      ? this.buildButtons(panel)
      : [{
          type: "button",
          customId: Id.CREATE,
          label: override(PKey.CREATE_BUTTON_LABEL) || t("tickets.create"),
          style: "primary",
        }];

    // Un panel sans aucun bouton valide ne doit pas être publié : le message
    // serait décoratif et n'ouvrirait rien.
    if (components.length === 0) return { ready: false, code: "TICKET_PANEL_NO_BUTTON", details: {} };

    const view = {
      title: override(PKey.PANEL_TITLE) || t("tickets.panelTitle"),
      content: override(PKey.PANEL_DESCRIPTION) || t("tickets.panelDescription"),
      components,
    };
    const color = override(PKey.PANEL_COLOR);
    const image = override(PKey.PANEL_IMAGE_URL);
    if (color || image) view.embed = { color, image };
    // P12.2 (B1) : le service ne décide PLUS de la destination. La catégorie
    // (ticket_category_id) est la destination des SALONS de tickets, jamais du
    // panneau — un envoi vers une catégorie échoue toujours (isTextBased=false).
    // La cible est fournie par l'appelant (salon de l'interaction /ticketpanel).
    return { ready: true, view };
  }

  /**
   * M8 (D-C) — brouillon de panel par défaut, dérivé de la configuration
   * actuelle de la guilde. C'est ce que /ticketpanel publie quand on ne lui
   * donne rien : un panel à UN bouton, qui reproduit le comportement historique.
   *
   * Les valeurs viennent de guild_configs :
   *   - ticket_category_id     → category_id du panel
   *   - ticket_support_role_id → support_role_id du panel
   *   - ticket_create_button_label → libellé du bouton (via le resolver
   *     Premium, donc uniquement si l'entitlement TICKET_PREMIUM est actif)
   *
   * Aucune nouvelle clé de configuration : ces trois clés existent déjà et
   * restent les défauts utilisés à la création d'un panel.
   */
  async defaultDraft({ guildId, t } = {}) {
    const config = await this.configService.read(guildId);
    const premium = this.premiumConfigResolver
      ? await this.premiumConfigResolver.resolve({ guildId, config })
      : null;
    const override = (key) => (premium && premium[key]) || null;
    return {
      categoryId: config[Key.CATEGORY_ID] || null,
      supportRoleId: config[Key.SUPPORT_ROLE_ID] || null,
      buttons: [
        {
          label: override(PKey.CREATE_BUTTON_LABEL) || t("tickets.create"),
          emoji: null,
          style: "primary",
          // null ⇒ fallback sur les valeurs du panel, elles-mêmes issues de
          // guild_configs. Un bouton par défaut n'a pas besoin de les répéter.
          category_id: null,
          support_role_id: null,
        },
      ],
    };
  }

  /**
   * M8 — boutons d'un panel réel.
   *
   * Le customId encode le panel ET l'index du bouton :
   *     civrat:v1:tickets:create:<panelId>:<buttonIndex>
   *
   * L'index dans le customId a une conséquence assumée : réordonner les boutons
   * invalide les panels déjà publiés. C'est pourquoi l'édition d'un panel
   * réécrit AUSSI le message Discord (ticketPanelRoutes.js), ce n'est pas
   * optionnel.
   *
   * `normalizeButtons` a déjà écarté les boutons `link` (sans customId, donc
   * incapables d'ouvrir un ticket) et borné le tableau à MAX_BUTTONS_PER_PANEL.
   */
  buildButtons(panel) {
    if (!panel || !Array.isArray(panel.buttons)) return [];
    return panel.buttons.slice(0, MAX_BUTTONS_PER_PANEL).map((button, index) => ({
      type: "button",
      customId: `${Id.CREATE_PREFIX}${panel.id}:${index}`,
      label: button.label,
      style: PANEL_BUTTON_STYLES.includes(button.style) ? button.style : "primary",
      ...(button.emoji ? { emoji: button.emoji } : {}),
    }));
  }

  /**
   * M8 — validation d'une saisie de boutons (modale d'édition).
   *
   * Contrairement à normalizeButtons, qui NETTOIE silencieusement pour le
   * rendu, cette fonction REFUSE et explique : une saisie humaine invalide
   * doit être rejetée avant toute écriture, jamais tronquée en silence.
   *
   * @returns {{valid:boolean, code:string|null, buttons:Array}}
   */
  validateButtons(raw) {
    const source = Array.isArray(raw) ? raw : [];
    if (source.length === 0) return { valid: false, code: "TICKET_PANEL_NO_BUTTON", buttons: [] };
    if (source.length > MAX_BUTTONS_PER_PANEL) {
      return { valid: false, code: "TICKET_PANEL_TOO_MANY_BUTTONS", buttons: [] };
    }
    const buttons = [];
    for (const entry of source) {
      if (!entry || typeof entry !== "object") {
        return { valid: false, code: "TICKET_PANEL_BUTTON_INVALID", buttons: [] };
      }
      const label = typeof entry.label === "string" ? entry.label.trim() : "";
      if (!label) return { valid: false, code: "TICKET_PANEL_BUTTON_INVALID", buttons: [] };
      // Un bouton « link » n'a pas de customId : il n'ouvrirait aucun ticket.
      if (entry.style === "link") return { valid: false, code: "TICKET_PANEL_BUTTON_LINK_REFUSED", buttons: [] };
      if (entry.style !== undefined && entry.style !== null && !PANEL_BUTTON_STYLES.includes(entry.style)) {
        return { valid: false, code: "TICKET_PANEL_BUTTON_INVALID", buttons: [] };
      }
      buttons.push({
        label,
        emoji: typeof entry.emoji === "string" && entry.emoji.trim() ? entry.emoji.trim() : null,
        style: entry.style || "primary",
        category_id: entry.category_id ?? null,
        support_role_id: entry.support_role_id ?? null,
      });
    }
    return { valid: true, code: null, buttons };
  }
}

module.exports = { TicketPanelService, normalizeButtons, resolveButtonTarget };
