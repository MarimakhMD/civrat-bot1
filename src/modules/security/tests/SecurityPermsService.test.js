"use strict";

/**
 * P2-B — compteur dédié `SecurityPermsService` (alert-only).
 *
 * Verrouille :
 *  • les seuils initiaux DÉDIÉS (5 salons distincts / 3 rôles distincts,
 *    fenêtre 15 s) — aucun seuil SecurityNuke (10/12/30/32) n'est touché ;
 *  • le décompte par cible DISTINTE (une répète ne gonfle pas le compteur) ;
 *  • une seule alerte par fenêtre (le 6e événement ne spamme pas) ;
 *  • le réarmement après expiration de fenêtre ;
 *  • l'isolation totale par guild ;
 *  • le calcul des gains de permissions sensibles (gain = signal, perte = non).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { SecurityPermsService, gainedSensitivePermissions } = require("../services/SecurityPermsService");
const { SecurityPermsDefaults, SecurityNukeDefaults } = require("../configuration/securityConstants");

// ─────────────────────────────────────────────────────────────────────
// Seuils et fenêtres
// ─────────────────────────────────────────────────────────────────────

test("P2B: seuils dédiés 5/3, fenêtre 15 s — seuils nuke 10/12/30/32 intacts", () => {
  assert.equal(SecurityPermsDefaults.CHANNEL_DISTINCT_THRESHOLD, 5);
  assert.equal(SecurityPermsDefaults.ROLE_DISTINCT_THRESHOLD, 3);
  assert.equal(SecurityPermsDefaults.WINDOW_MS, 15000);
  assert.deepEqual(SecurityNukeDefaults.THRESHOLDS, { channelCreate: 10, channelDelete: 12, roleCreate: 30, roleDelete: 32 });
  const service = new SecurityPermsService();
  assert.equal(service.thresholds.channelPerms, 5);
  assert.equal(service.thresholds.rolePerms, 3);
  assert.equal(service.windowMs, 15000);
});

// ─────────────────────────────────────────────────────────────────────
// Compteur de salons (rafale d'overwrites)
// ─────────────────────────────────────────────────────────────────────

test("P2B canal: 4/5 → pas de déclenchement ; 5/5 → déclenchement UNE fois", () => {
  let now = 0;
  const service = new SecurityPermsService({ clock: () => now });
  for (let i = 1; i <= 4; i += 1) {
    const result = service.recordChannelPermissions({ guildId: "g1", channelId: `c${i}` });
    assert.equal(result.triggered, false, `4/5 : aucun déclenchement (${result.distinct})`);
    assert.equal(result.distinct, i);
  }
  const fifth = service.recordChannelPermissions({ guildId: "g1", channelId: "c5" });
  assert.equal(fifth.triggered, true, "5/5 : seuil atteint");
  assert.equal(fifth.distinct, 5);
  assert.equal(fifth.threshold, 5);
});

test("P2B canal: 6e événement dans la même fenêtre → pas de spam", () => {
  let now = 0;
  const service = new SecurityPermsService({ clock: () => now });
  for (let i = 1; i <= 5; i += 1) service.recordChannelPermissions({ guildId: "g1", channelId: `c${i}` });
  const sixth = service.recordChannelPermissions({ guildId: "g1", channelId: "c6" });
  assert.equal(sixth.triggered, false, "la fenêtre a déjà alerté : pas de second déclenchement");
  assert.equal(sixth.distinct, 6, "le compteur continue d'observer");
});

test("P2B canal: un même salon répété ne compte pas comme plusieurs salons distincts", () => {
  let now = 0;
  const service = new SecurityPermsService({ clock: () => now });
  let last = null;
  for (let i = 0; i < 7; i += 1) last = service.recordChannelPermissions({ guildId: "g1", channelId: "cSame" });
  assert.equal(last.distinct, 1, "toujours 1 salon distinct après 7 modifications");
  assert.equal(last.triggered, false, "jamais de seuil atteint avec un seul salon");
});

test("P2B canal: fenêtre expirée → compteur réarmé", () => {
  let now = 0;
  const service = new SecurityPermsService({ clock: () => now });
  for (let i = 1; i <= 5; i += 1) service.recordChannelPermissions({ guildId: "g1", channelId: `w1-c${i}` });
  const afterFirst = service.recordChannelPermissions({ guildId: "g1", channelId: "w1-c6" });
  assert.equal(afterFirst.triggered, false, "même fenêtre : pas de spam");

  now += SecurityPermsDefaults.WINDOW_MS + 1;
  for (let i = 1; i <= 4; i += 1) {
    const result = service.recordChannelPermissions({ guildId: "g1", channelId: `w2-c${i}` });
    assert.equal(result.triggered, false, "nouvelle fenêtre repart de zéro");
    assert.equal(result.distinct, i, "fenêtre réarmée, comptage repris à 1");
  }
  const fifth = service.recordChannelPermissions({ guildId: "g1", channelId: "w2-c5" });
  assert.equal(fifth.triggered, true, "une nouvelle fenêtre réellement distincte re-alerte");
});

test("P2B canal: isolation totale entre guildes", () => {
  let now = 0;
  const service = new SecurityPermsService({ clock: () => now });
  for (let i = 1; i <= 5; i += 1) service.recordChannelPermissions({ guildId: "gA", channelId: `a${i}` });
  const bStates = [];
  for (let i = 1; i <= 4; i += 1) bStates.push(service.recordChannelPermissions({ guildId: "gB", channelId: `b${i}` }));
  assert.equal(bStates.every((r) => r.triggered === false), true, "gB n'est pas contaminé par le seuil de gA");
  assert.equal(bStates[3].distinct, 4);
  const bFifth = service.recordChannelPermissions({ guildId: "gB", channelId: "b5" });
  assert.equal(bFifth.triggered, true, "gB déclenche sur SES propres 5 salons");
});

// ─────────────────────────────────────────────────────────────────────
// Compteur de rôles (rafale de permissions de rôle)
// ─────────────────────────────────────────────────────────────────────

test("P2B rôle: 2/3 → pas d'alerte ; 3/3 → une alerte", () => {
  let now = 0;
  const service = new SecurityPermsService({ clock: () => now });
  assert.equal(service.recordRolePermissions({ guildId: "g1", roleId: "r1" }).triggered, false);
  assert.equal(service.recordRolePermissions({ guildId: "g1", roleId: "r2" }).triggered, false);
  const third = service.recordRolePermissions({ guildId: "g1", roleId: "r3" });
  assert.equal(third.triggered, true);
  assert.equal(third.distinct, 3);
  assert.equal(third.threshold, 3);
});

test("P2B rôle: un même rôle répété ne compte pas comme plusieurs rôles distincts", () => {
  let now = 0;
  const service = new SecurityPermsService({ clock: () => now });
  let last = null;
  for (let i = 0; i < 5; i += 1) last = service.recordRolePermissions({ guildId: "g1", roleId: "rSame" });
  assert.equal(last.distinct, 1, "5 modifications du MÊME rôle = 1 rôle distinct");
  assert.equal(last.triggered, false, "pas d'alerte de rafale pour un seul rôle");
});

test("P2B rôle: fenêtre expirée + isolation par guild", () => {
  let now = 0;
  const service = new SecurityPermsService({ clock: () => now });
  for (let i = 1; i <= 3; i += 1) service.recordRolePermissions({ guildId: "gA", roleId: `r${i}` });
  assert.equal(service.recordRolePermissions({ guildId: "gA", roleId: "r4" }).triggered, false, "pas de spam en fenêtre");

  // gB démarre SA propre fenêtre : totalement isolé de gA.
  now += 1000;
  assert.equal(service.recordRolePermissions({ guildId: "gB", roleId: "x1" }).distinct, 1, "gB isolé de gA");
  assert.equal(service.recordRolePermissions({ guildId: "gB", roleId: "x2" }).triggered, false);

  // gA, fenêtre réellement expirée : réarmement complet.
  now = SecurityPermsDefaults.WINDOW_MS + 1;
  const rearmed = [];
  for (let i = 1; i <= 3; i += 1) rearmed.push(service.recordRolePermissions({ guildId: "gA", roleId: `n${i}` }));
  assert.equal(rearmed[0].distinct, 1, "compteur remis à zéro");
  assert.equal(rearmed[2].triggered, true, "3 nouveaux rôles distincts en nouvelle fenêtre → alerte");
});

test("P2B rôle: réarmement complet → nouvelle rafale de 3 peut re-alerter", () => {
  let now = 0;
  const service = new SecurityPermsService({ clock: () => now });
  for (let i = 1; i <= 3; i += 1) service.recordRolePermissions({ guildId: "g1", roleId: `a${i}` });
  now += SecurityPermsDefaults.WINDOW_MS + 1;
  const second = [];
  for (let i = 1; i <= 3; i += 1) second.push(service.recordRolePermissions({ guildId: "g1", roleId: `b${i}` }));
  assert.equal(second[1].triggered, false);
  assert.equal(second[2].triggered, true, "fenêtre suivante : 3 nouveaux rôles distincts → alerte");
});

// ─────────────────────────────────────────────────────────────────────
// Signal fort N1 — gains de permissions sensibles
// ─────────────────────────────────────────────────────────────────────

test("P2B N1: un GAIN de permission sensible est détecté", () => {
  const changes = [{ key: "permissions", before: ["SendMessages", "ViewChannel"], after: ["Administrator", "SendMessages", "ViewChannel"] }];
  assert.deepEqual(gainedSensitivePermissions(changes), ["Administrator"]);
});

test("P2B N1: une PERTE de permission sensible n'est pas un signal", () => {
  const changes = [{ key: "permissions", before: ["Administrator", "ManageGuild"], after: ["ManageGuild"] }];
  assert.deepEqual(gainedSensitivePermissions(changes), [], "une perte ne déclenche rien");
});

test("P2B N1: changement sans entrée permissions → rien (couleur/nom/hoist ignorés)", () => {
  assert.deepEqual(gainedSensitivePermissions([{ key: "color", before: "#ff0000", after: "#00ff00" }]), []);
  assert.deepEqual(gainedSensitivePermissions([{ key: "name", before: "A", after: "B" }]), []);
  assert.deepEqual(gainedSensitivePermissions([]), []);
  assert.deepEqual(gainedSensitivePermissions(null), []);
});

test("P2B N1: structure illisible → fail-closed, jamais deviné", () => {
  assert.deepEqual(gainedSensitivePermissions([{ key: "permissions", before: "Administrator", after: null }]), []);
  assert.deepEqual(gainedSensitivePermissions([{ key: "permissions", after: ["Administrator"] }]), []);
  assert.deepEqual(gainedSensitivePermissions([{ key: "permissions", before: ["ViewChannel"], after: ["ViewChannel"] }]), [], "aucun gain réel");
});

test("P2B N1: la liste sensible initiale est bien celle du cahier des charges", () => {
  assert.deepEqual([...SecurityPermsDefaults.SENSITIVE_PERMISSIONS].sort(), [
    "Administrator",
    "BanMembers",
    "KickMembers",
    "ManageChannels",
    "ManageGuild",
    "ManageRoles",
    "ManageWebhooks",
  ]);
  const changes = [{ key: "permissions", before: [], after: ["ViewChannel", "ManageWebhooks", "MentionEveryone"] }];
  assert.deepEqual(gainedSensitivePermissions(changes), ["ManageWebhooks"], "une permission hors liste ne compte pas");
});
