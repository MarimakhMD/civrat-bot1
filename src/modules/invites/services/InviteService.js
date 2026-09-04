"use strict";

class InviteService {
  constructor({ cache, statsRepository } = {}) {
    this.cache = cache instanceof Map ? cache : new Map(); // guildId -> Map<code, uses>
    this.statsRepository = statsRepository;
  }

  hasCachedGuild(guildId) {
    return this.cache.has(guildId);
  }

  cacheGuildInvites(guildId, invites) {
    const map = new Map();
    if (invites) {
      for (const invite of invites.values ? invites.values() : Object.values(invites)) {
        map.set(invite.code, invite.uses);
      }
    }
    this.cache.set(guildId, map);
  }

  async refreshGuildInvites(guild) {
    try {
      const invites = await guild.invites.fetch().catch(() => null);
      if (invites) this.cacheGuildInvites(guild.id, invites);
    } catch {}
  }

  /**
   * B2 — Détermine quelle invitation vient d'être consommée.
   *
   * TROIS corrections par rapport à l'implémentation d'origine :
   *
   * 1. RECACHE SYSTÉMATIQUE. Le cache est mis à jour avec l'instantané qui
   *    vient d'être lu, QUELLE QUE SOIT la décision. Auparavant il n'était
   *    rafraîchi que sur inviteCreate/inviteDelete : une invitation déjà
   *    consommée restait donc indéfiniment « au-dessus du cache » et captait
   *    les arrivées suivantes. C'est le bug AAA/BBB — AAA à 6 et BBB à 6 face
   *    à un cache à 5/5 attribuaient les DEUX arrivées à l'inviteur de AAA.
   *    Le recache ne coûte aucun appel API : l'instantané est déjà en main.
   *
   * 2. DELTA MAXIMAL. On choisit l'invitation dont le compteur a le plus
   *    progressé, et non la première au-dessus du cache. L'ordre d'itération
   *    d'une Collection Discord n'est pas une information exploitable.
   *
   * 3. ABSTENTION EN CAS D'ÉGALITÉ. Si deux invitations ont progressé exactement
   *    autant entre deux rafraîchissements, l'information permettant de trancher
   *    n'existe pas. On ne devine pas : aucune attribution vaut mieux qu'une
   *    attribution inventée (§14). Le recache du point 1 rend ce cas résiduel.
   *
   * Reste SYNCHRONE : le contrat historique est appelé sans await.
   *
   * @returns {{code:string, inviter:string|null, uses:number}|null}
   */
  findUsedInvite(guildId, newInvites) {
    const oldCache = this.cache.get(guildId);
    if (!oldCache) return null;
    if (!newInvites) return null;

    const candidates = [];
    for (const invite of newInvites.values ? newInvites.values() : Object.values(newInvites)) {
      const oldUses = oldCache.get(invite.code) || 0;
      const uses = invite.uses || 0;
      const delta = uses - oldUses;
      if (delta > 0) {
        candidates.push({ code: invite.code, inviter: invite.inviter ? invite.inviter.id : null, uses, delta });
      }
    }

    // Décision 1 : recacher AVANT de conclure, y compris quand rien n'est
    // attribuable (vanity URL, fetch partiel). Sans cela l'instantané suivant
    // serait comparé à un cache périmé.
    this.cacheGuildInvites(guildId, newInvites);

    if (candidates.length === 0) return null;

    const best = Math.max(...candidates.map((candidate) => candidate.delta));
    const winners = candidates.filter((candidate) => candidate.delta === best);
    if (winners.length > 1) return null;

    const chosen = winners[0];
    return { code: chosen.code, inviter: chosen.inviter, uses: chosen.uses };
  }

  /**
   * B2 — Attribution en UNE écriture (lien + compteur implicite).
   * Remplace la paire addInvite() + setInvitedBy(), deux écritures séparées
   * dont l'interruption laissait un compteur crédité sans lien.
   */
  async attributeInvite({ guildId, invitedId, inviterId, inviteCode = null } = {}) {
    if (!this.statsRepository) return null;
    return this.statsRepository.attributeInvite({ guildId, invitedId, inviterId, inviteCode });
  }

  /** B2 — Révocation au départ. Idempotente, ne supprime jamais la ligne. */
  async revokeInvite(guildId, invitedId) {
    if (!this.statsRepository) return { revoked: false, guildId, invitedId };
    return this.statsRepository.revokeInvite(guildId, invitedId);
  }

  // ── Aliases antérieurs à B2 ──
  // Ils imposent désormais le membre invité : la PK (guild_id, invited_id)
  // interdit de créditer un inviteur sans nommer qui il a invité, et deux
  // appels identiques doivent produire une seule ligne.
  async addInvite(userId, guildId, invitedId) {
    if (!this.statsRepository) return;
    await this.statsRepository.addInvite(userId, guildId, invitedId);
  }

  async removeInvite(userId, guildId, invitedId) {
    if (!this.statsRepository) return;
    await this.statsRepository.removeInvite(userId, guildId, invitedId);
  }

  async setInvitedBy(memberId, guildId, inviterId) {
    if (!this.statsRepository) return;
    await this.statsRepository.setInvitedBy(memberId, guildId, inviterId);
  }

  async getInviteStats(userId, guildId) {
    if (!this.statsRepository) return { userId, guildId, current: 0 };
    return this.statsRepository.getInviteStats(userId, guildId);
  }

  clear() {
    this.cache.clear();
  }
}

module.exports = { InviteService };
