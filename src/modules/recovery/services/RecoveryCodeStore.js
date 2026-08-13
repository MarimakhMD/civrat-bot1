"use strict";

// P20 — stockage en mémoire des codes temporaires de récupération.
//
// Choix délibéré (minimale et sûre) : pas de nouvelle table ni migration —
// un code temporaire n'a pas vocation à survivre au processus, et le bot est
// mono-process par hébergement. Conséquence ASSUMÉE et testée : un
// redémarrage du bot invalide tous les codes en cours ; l'utilisateur doit
// alors refaire une demande (nouveau Master Code). C'est le comportement
// souhaitable : aucun artefact de récupération ne persiste au-delà d'un
// crash ou d'une compromission de l'hébergeur en cours.
//
// Le store ne conserve JAMAIS le code en clair : uniquement son hash SHA-256,
// son expiration et son compteur de tentatives.

class RecoveryCodeStore {
  constructor() {
    this.entries = new Map(); // key "guildId:userId" -> { hash, expiresAt, attempts }
    this.lastRequestAt = new Map(); // userId -> timestamp (cooldown anti-spam)
    this.elevations = new Map(); // userId -> expiresAt (élévation après vérification réussie)
  }

  static key(guildId, userId) {
    return `${guildId || "no-guild"}:${userId}`;
  }

  saveCode(guildId, userId, hash, expiresAt) {
    this.entries.set(RecoveryCodeStore.key(guildId, userId), { hash, expiresAt, attempts: 0 });
  }

  readCode(guildId, userId) {
    return this.entries.get(RecoveryCodeStore.key(guildId, userId)) || null;
  }

  deleteCode(guildId, userId) {
    this.entries.delete(RecoveryCodeStore.key(guildId, userId));
  }

  incrementAttempts(guildId, userId) {
    const entry = this.readCode(guildId, userId);
    if (!entry) return 0;
    entry.attempts += 1;
    return entry.attempts;
  }

  getLastRequestAt(userId) {
    return this.lastRequestAt.get(userId) || 0;
  }

  markRequest(userId, at) {
    this.lastRequestAt.set(userId, at);
  }

  // --- Élévations (partagées : lues par le Owner Panel via le runtime) ---
  setElevation(userId, expiresAt) {
    this.elevations.set(userId, expiresAt);
  }

  hasActiveElevation(userId, now) {
    const expiresAt = this.elevations.get(userId);
    if (!expiresAt) return false;
    if (now > expiresAt) {
      this.elevations.delete(userId);
      return false;
    }
    return true;
  }

  // P20.1 — consommation explicite : après un transfert Owner via récupération
  // réussi, l'élévation est invalidée immédiatement (une élévation = un seul
  // transfert possible).
  clearElevation(userId) {
    this.elevations.delete(userId);
  }
}

module.exports = { RecoveryCodeStore };
