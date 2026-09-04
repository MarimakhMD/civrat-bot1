"use strict";

/**
 * B2 — Persistance des invitations sur public.invite_links.
 *
 * MODÈLE : une ligne par membre invité, PK (guild_id, invited_id).
 * Le compteur d'un inviteur n'est JAMAIS stocké : c'est un COUNT(*) des liens
 * actifs (revoked_at IS NULL) dont il est l'inviter. Il n'y a donc aucune
 * valeur à perdre — le lost update devient structurellement impossible, et un
 * décrément manqué ne peut plus faire dériver un compteur de façon permanente.
 *
 * APPEND-ONLY côté suppression : une révocation pose revoked_at, elle ne
 * supprime jamais la ligne. La base ne concède d'ailleurs aucun DELETE à
 * service_role.
 */
class InviteStatsRepository {
  /**
   * B2 — Attribution. UNE seule écriture portant à la fois le compteur
   * (implicite, dérivé) et le lien invité → inviteur.
   *
   * Remplace l'ancienne paire addInvite() + setInvitedBy(), qui était deux
   * écritures séparées : une panne entre les deux laissait un compteur crédité
   * sans lien, et le décrément au départ devenait impossible.
   */
  async attributeInvite() { throw new Error("Not implemented"); }

  /** B2 — Révocation au départ : pose revoked_at. Idempotent. Ne supprime jamais. */
  async revokeInvite() { throw new Error("Not implemented"); }

  async getInviteStats(userId, guildId) { throw new Error("Not implemented"); }
  async getLeaderboard(guildId, limit) { throw new Error("Not implemented"); }
  async findOne(guildId, userId) { throw new Error("Not implemented"); }

  // ── Méthodes antérieures à B2, conservées comme aliases ──
  // Elles exigeaient de créditer un inviteur SANS nommer le membre invité, ce
  // que la PK (guild_id, invited_id) rend impossible : deux appels identiques
  // doivent produire une seule ligne. Elles imposent donc désormais le membre
  // invité et délèguent au modèle liens.
  async addInvite(userId, guildId, invitedId) { return this.attributeInvite({ guildId, invitedId, inviterId: userId, inviteCode: null }); }
  async removeInvite(userId, guildId, invitedId) { return this.revokeInvite(guildId, invitedId); }
  async setInvitedBy(memberId, guildId, inviterId) { return this.attributeInvite({ guildId, invitedId: memberId, inviterId, inviteCode: null }); }
}

/**
 * Repli en mémoire, utilisé quand Supabase n'est pas disponible.
 *
 * UNE seule source de vérité : `links`. Les deux Map historiques (`invites`,
 * `invitedBy`) sont devenues des VUES calculées à la demande — il est donc
 * impossible qu'elles divergent de `links`, ce qui était la faille du modèle
 * précédent (un compteur incrémenté d'un côté, un lien posé de l'autre).
 *
 * Les liens y sont perdus au redémarrage : mode dégradé, pas le nominal.
 */
class InMemoryInviteStatsRepository extends InviteStatsRepository {
  constructor({ clock } = {}) {
    super();
    // "guildId:invitedId" → lien. Seule structure écrite.
    this.links = new Map();
    this.clock = typeof clock === "function" ? clock : () => Date.now();
  }

  _linkKey(guildId, invitedId) { return `${guildId}:${invitedId}`; }
  _userKey(guildId, userId) { return `${guildId}:${userId}`; }

  /** Vue : nombre de liens ACTIFS par inviteur, pour une guilde ou toutes. */
  get invites() {
    const view = new Map();
    for (const link of this.links.values()) {
      if (link.revokedAt !== null) continue;
      const key = this._userKey(link.guildId, link.inviterId);
      view.set(key, (view.get(key) || 0) + 1);
    }
    return view;
  }

  /** Vue : lien actif invité → inviteur. */
  get invitedBy() {
    const view = new Map();
    for (const link of this.links.values()) {
      if (link.revokedAt !== null) continue;
      view.set(this._userKey(link.guildId, link.invitedId), link.inviterId);
    }
    return view;
  }

  async attributeInvite({ guildId, invitedId, inviterId, inviteCode = null } = {}) {
    if (!guildId || !invitedId || !inviterId) {
      throw new TypeError("attributeInvite requires guildId, invitedId and inviterId");
    }
    // Un lien déjà révoqué est réactivé par la même écriture : c'est le retour
    // d'un membre. Une seule ligne active par (guildId, invitedId), toujours.
    const link = Object.freeze({
      guildId,
      invitedId,
      inviterId,
      inviteCode: inviteCode === undefined ? null : inviteCode,
      createdAt: new Date(this.clock()).toISOString(),
      revokedAt: null,
    });
    this.links.set(this._linkKey(guildId, invitedId), link);
    return link;
  }

  async revokeInvite(guildId, invitedId) {
    if (!guildId || !invitedId) {
      throw new TypeError("revokeInvite requires guildId and invitedId");
    }
    const key = this._linkKey(guildId, invitedId);
    const link = this.links.get(key);
    // Idempotent : un second départ ne trouve plus de lien actif.
    if (!link || link.revokedAt !== null) return { revoked: false, guildId, invitedId };
    // La ligne n'est JAMAIS supprimée : revokedAt la marque, c'est tout.
    this.links.set(key, Object.freeze({ ...link, revokedAt: new Date(this.clock()).toISOString() }));
    return { revoked: true, guildId, invitedId };
  }

  async getInviteStats(userId, guildId) {
    const current = this.invites.get(this._userKey(guildId, userId)) || 0;
    const invitedBy = this.invitedBy.get(this._userKey(guildId, userId)) || null;
    return { userId, guildId, current, invitedBy };
  }

  async getLeaderboard(guildId, limit = 10) {
    const bounded = Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 100) : 10;
    return [...this.invites.entries()]
      .filter(([key]) => key.startsWith(`${guildId}:`))
      .map(([key, count]) => ({ userId: key.slice(guildId.length + 1), current: count }))
      // Égalité départagée sur userId : classement déterministe, comme la RPC.
      .sort((a, b) => (b.current - a.current) || a.userId.localeCompare(b.userId))
      .slice(0, bounded);
  }

  async findOne(guildId, userId) {
    const stats = await this.getInviteStats(userId, guildId);
    if (stats.current === 0 && !stats.invitedBy) return null;
    return stats;
  }

  clear() {
    this.links.clear();
  }
}

class MongoInviteStatsRepository extends InviteStatsRepository {
  constructor({ model } = {}) {
    super();
    let Model = model;
    if (!Model) {
      try {
        const mongoose = require("mongoose");
        const schema = new mongoose.Schema({
          guildId: { type: String, required: true, index: true },
          userId: { type: String, required: true, index: true },
          invites: { type: Number, default: 0 },
          invitedBy: { type: String, default: null },
        }, { timestamps: true });
        schema.index({ guildId: 1, userId: 1 }, { unique: true });
        Model = mongoose.models.InviteStats || mongoose.model("InviteStats", schema);
      } catch {
        throw new Error("MongoInviteStatsRepository requires mongoose model");
      }
    }
    this.model = Model;
  }

  async addInvite(userId, guildId) {
    const doc = await this.model.findOneAndUpdate({ guildId, userId }, { $inc: { invites: 1 } }, { upsert: true, new: true });
    return { userId, guildId, current: doc.invites };
  }

  async removeInvite(userId, guildId) {
    const doc = await this.model.findOneAndUpdate({ guildId, userId }, { $inc: { invites: -1 } }, { new: true });
    const current = doc ? Math.max(0, doc.invites) : 0;
    if (doc && doc.invites < 0) await this.model.updateOne({ guildId, userId }, { invites: 0 });
    return { userId, guildId, current };
  }

  async setInvitedBy(memberId, guildId, inviterId) {
    await this.model.findOneAndUpdate({ guildId, userId: memberId }, { invitedBy: inviterId }, { upsert: true });
    return { memberId, guildId, inviterId };
  }

  async getInviteStats(userId, guildId) {
    const doc = await this.model.findOne({ guildId, userId }).lean();
    if (!doc) return { userId, guildId, current: 0, invitedBy: null };
    return { userId, guildId, current: doc.invites || 0, invitedBy: doc.invitedBy || null };
  }

  async getLeaderboard(guildId, limit = 10) {
    const docs = await this.model.find({ guildId }).sort({ invites: -1 }).limit(limit).lean();
    return docs.map((d) => ({ userId: d.userId, current: d.invites }));
  }

  async findOne(guildId, userId) {
    const doc = await this.model.findOne({ guildId, userId }).lean();
    if (!doc) return null;
    return { guildId, userId, current: doc.invites, invitedBy: doc.invitedBy };
  }
}

module.exports = { InviteStatsRepository, InMemoryInviteStatsRepository, MongoInviteStatsRepository };
