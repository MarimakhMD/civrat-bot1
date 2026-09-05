"use strict";

const { MAX_PANELS_PER_GUILD, MAX_BUTTONS_PER_PANEL, DISCORD_ID_PATTERN, PANEL_BUTTON_STYLES } = require("../configuration/ticketConstants");

/**
 * M8 — Contrat des panels de tickets (public.ticket_panels).
 *
 * APPEND + INVALIDATION : un panel n'est JAMAIS supprimé. Le désactiver pose
 * is_active = false. La base ne concède d'ailleurs pas DELETE à service_role.
 *
 * Un panel est identifié par son `id` (bigint identity). C'est cet identifiant
 * qui est encodé dans le customId du bouton :
 *     civrat:v1:tickets:create:<panelId>:<buttonIndex>
 *
 * ⚠️ PostgREST renvoie un bigint en CHAÎNE. `id` est donc toujours manipulé en
 *    string, jamais converti en number (même piège que giveaway_id).
 */
class TicketPanelRepository {
  async create(_panel) { throw new Error("TicketPanelRepository.create must be implemented."); }
  async findActive(_guildId, _panelId) { throw new Error("TicketPanelRepository.findActive must be implemented."); }
  async listActive(_guildId) { throw new Error("TicketPanelRepository.listActive must be implemented."); }
  async countActive(_guildId) { throw new Error("TicketPanelRepository.countActive must be implemented."); }
  async updatePanel(_guildId, _panelId, _updates) { throw new Error("TicketPanelRepository.updatePanel must be implemented."); }
  async deactivate(_guildId, _panelId) { throw new Error("TicketPanelRepository.deactivate must be implemented."); }
}

/**
 * Normalise la colonne `buttons` (jsonb).
 *
 * Parsing défensif, sur le modèle de role_rewards (A3) : une valeur invalide ne
 * doit jamais faire planter le rendu d'un panel ni l'ouverture d'un ticket.
 *
 * Règles :
 *  - ce qui n'est pas un tableau devient [] ;
 *  - au-delà de MAX_BUTTONS_PER_PANEL, le tableau est tronqué (pas d'erreur) ;
 *  - `style: "link"` est REJETÉ : un bouton lien n'a pas de customId, donc il
 *    n'ouvrirait aucun ticket — c'est un bouton mort ;
 *  - un style inconnu retombe sur "primary" ;
 *  - category_id / support_role_id absents ou invalides deviennent null : c'est
 *    le fallback sur les valeurs du PANEL qui s'appliquera à l'ouverture.
 */
function normalizeButtons(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const buttons = [];
  for (const entry of source) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

    const label = typeof entry.label === "string" ? entry.label.trim() : "";
    if (!label) continue;

    const style = PANEL_BUTTON_STYLES.includes(entry.style) ? entry.style : "primary";
    // Un bouton « link » est structurellement inutilisable ici.
    if (entry.style === "link") continue;

    const emoji = typeof entry.emoji === "string" && entry.emoji.trim() ? entry.emoji.trim() : null;
    const categoryId = DISCORD_ID_PATTERN.test(String(entry.category_id ?? "")) ? String(entry.category_id) : null;
    const supportRoleId = DISCORD_ID_PATTERN.test(String(entry.support_role_id ?? "")) ? String(entry.support_role_id) : null;

    buttons.push({ label, emoji, style, category_id: categoryId, support_role_id: supportRoleId });
    if (buttons.length >= MAX_BUTTONS_PER_PANEL) break;
  }
  return buttons;
}

/** Forme domaine d'un panel. `id` est TOUJOURS une chaîne. */
function toDomainPanel(row) {
  if (!row || typeof row !== "object") return null;
  return Object.freeze({
    id: String(row.id),
    guildId: String(row.guild_id),
    channelId: String(row.channel_id),
    messageId: String(row.message_id),
    categoryId: String(row.category_id),
    supportRoleId: String(row.support_role_id),
    buttons: Object.freeze(normalizeButtons(row.buttons)),
    isActive: row.is_active !== false,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  });
}

/**
 * Résout la cible réelle d'un bouton : valeur du bouton d'abord, puis celle du
 * panel. C'est le même schéma de résolution en couches que le resolver Premium
 * de TicketPanelService (`override(key) || défaut`).
 */
function resolveButtonTarget(panel, buttonIndex) {
  if (!panel) return null;
  const index = Number(buttonIndex);
  if (!Number.isInteger(index) || index < 0 || index >= panel.buttons.length) return null;
  const button = panel.buttons[index];
  return Object.freeze({
    index,
    label: button.label,
    emoji: button.emoji,
    style: button.style,
    categoryId: button.category_id || panel.categoryId,
    supportRoleId: button.support_role_id || panel.supportRoleId,
  });
}

/**
 * Implémentation dégradée (offline / tests).
 *
 * UNE seule source de vérité : this.rows. Le compteur de panels actifs est
 * dérivé, jamais stocké — comme le compteur d'invitations en B2.
 */
class InMemoryTicketPanelRepository extends TicketPanelRepository {
  constructor() {
    super();
    this.rows = new Map(); // "guildId:id" -> ligne snake_case
    this.nextId = 1;
  }

  _key(guildId, panelId) { return `${guildId}:${panelId}`; }

  async create({ guildId, channelId, messageId, categoryId, supportRoleId, buttons = [] } = {}) {
    if (!guildId || !channelId || !messageId || !categoryId || !supportRoleId) {
      throw new TypeError("InMemoryTicketPanelRepository.create requires guildId, channelId, messageId, categoryId and supportRoleId");
    }
    const id = String(this.nextId++);
    const now = new Date().toISOString();
    const row = {
      id,
      guild_id: String(guildId),
      channel_id: String(channelId),
      message_id: String(messageId),
      category_id: String(categoryId),
      support_role_id: String(supportRoleId),
      buttons: normalizeButtons(buttons),
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    this.rows.set(this._key(row.guild_id, id), row);
    return toDomainPanel(row);
  }

  async findActive(guildId, panelId) {
    if (!guildId || panelId === undefined || panelId === null || panelId === "") return null;
    const row = this.rows.get(this._key(guildId, String(panelId)));
    if (!row || row.is_active === false) return null;
    return toDomainPanel(row);
  }

  async listActive(guildId) {
    if (!guildId) return [];
    return [...this.rows.values()]
      .filter((row) => row.guild_id === String(guildId) && row.is_active !== false)
      // id est un bigint : tri NUMÉRIQUE, pas lexicographique ("10" < "9" en string).
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map(toDomainPanel);
  }

  async countActive(guildId) {
    return (await this.listActive(guildId)).length;
  }

  async updatePanel(guildId, panelId, updates = {}) {
    const key = this._key(guildId, String(panelId));
    const row = this.rows.get(key);
    if (!row || row.is_active === false) return null;
    const next = { ...row, updated_at: new Date().toISOString() };
    if (updates.channelId !== undefined) next.channel_id = String(updates.channelId);
    if (updates.messageId !== undefined) next.message_id = String(updates.messageId);
    if (updates.categoryId !== undefined) next.category_id = String(updates.categoryId);
    if (updates.supportRoleId !== undefined) next.support_role_id = String(updates.supportRoleId);
    if (updates.buttons !== undefined) next.buttons = normalizeButtons(updates.buttons);
    this.rows.set(key, next);
    return toDomainPanel(next);
  }

  /** Idempotent : un second appel ne matche plus de ligne active. */
  async deactivate(guildId, panelId) {
    const key = this._key(guildId, String(panelId));
    const row = this.rows.get(key);
    if (!row || row.is_active === false) return { deactivated: false, guildId: String(guildId), panelId: String(panelId) };
    this.rows.set(key, { ...row, is_active: false, updated_at: new Date().toISOString() });
    return { deactivated: true, guildId: String(guildId), panelId: String(panelId) };
  }

  /** Plafond validé : 10 panels actifs par guilde. */
  async canCreate(guildId) {
    return (await this.countActive(guildId)) < MAX_PANELS_PER_GUILD;
  }

  clear() { this.rows.clear(); this.nextId = 1; }
}

module.exports = {
  TicketPanelRepository,
  InMemoryTicketPanelRepository,
  normalizeButtons,
  toDomainPanel,
  resolveButtonTarget,
};
