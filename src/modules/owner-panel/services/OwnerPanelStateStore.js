"use strict";

// P20 — état volatile du Owner Panel : sessions authentifiées, verrouillages
// anti force brute et actions en attente de confirmation.
//
// Choix délibéré (minimale et sûre) : tout reste EN MÉMOIRE processus —
// aucune table ni migration pour cet état. Conséquence assumée et testée :
// un redémarrage du bot invalide toutes les sessions et toutes les actions
// en attente ; l'utilisateur se ré-authentifie simplement (fail-closed).
// Cet état ne contient JAMAIS de secret : uniquement des userId et des
// timestamps (les cibles d'action sont des IDs Discord, non secrètes).

class OwnerPanelStateStore {
  constructor() {
    this.sessions = new Map(); // userId -> expiresAt
    this.failures = new Map(); // userId -> { count, lockedUntil }
    this.pending = new Map(); // userId -> { type, targetId, expiresAt, newOwnerId? }
  }

  // --- Sessions ---
  setSession(userId, expiresAt) {
    this.sessions.set(userId, expiresAt);
  }

  hasActiveSession(userId, now) {
    const expiresAt = this.sessions.get(userId);
    if (!expiresAt) return false;
    if (now > expiresAt) {
      this.sessions.delete(userId);
      return false;
    }
    return true;
  }

  // --- Verrouillage anti force brute sur le Master Code ---
  readFailures(userId) {
    return this.failures.get(userId) || { count: 0, lockedUntil: 0 };
  }

  registerFailure(userId, lockedUntil) {
    const current = this.readFailures(userId);
    this.failures.set(userId, { count: current.count + 1, lockedUntil });
  }

  clearFailures(userId) {
    this.failures.delete(userId);
  }

  // --- Actions en attente de confirmation (une seule par utilisateur) ---
  setPending(userId, action) {
    this.pending.set(userId, action);
  }

  peekPending(userId, now) {
    const action = this.pending.get(userId);
    if (!action) return null;
    if (now > action.expiresAt) {
      this.pending.delete(userId);
      return null;
    }
    return action;
  }

  consumePending(userId, now) {
    const action = this.peekPending(userId, now);
    this.pending.delete(userId);
    return action;
  }
}

module.exports = { OwnerPanelStateStore };
