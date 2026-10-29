"use strict";

/**
 * P5 — `SecurityUpdateService` : compteur dédié des rafales de modifications
 * NON permission (alert-only). Verrouille :
 *  • 9/10 salons → rien, 10/10 → déclenchement, 11e même salon → pas de
 *    comptage supplémentaire (distincts + flag alerted) ;
 *  • fenêtre expirée → réarmement ;
 *  • isolation stricte par guild ;
 *  • 5/6 rôles → rien, 6/6 → déclenchement ;
 *  • un même rôle répété ≠ plusieurs rôles ;
 *  • défauts exacts : 10 salons / 6 rôles / 15 000 ms.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { SecurityUpdateService } = require("../services/SecurityUpdateService");
const { SecurityUpdateDefaults, SecurityNukeDefaults, SecurityRaidDefaults, SecurityPermsDefaults } = require("../configuration/securityConstants");

function service(clock, thresholds) {
  return new SecurityUpdateService({ clock, ...(thresholds ? { thresholds } : {}) });
}

test("P5 défauts : 10 salons / 6 rôles / 15 000 ms, et les seuils existants sont intacts", () => {
  assert.equal(SecurityUpdateDefaults.CHANNEL_DISTINCT_THRESHOLD, 10);
  assert.equal(SecurityUpdateDefaults.ROLE_DISTINCT_THRESHOLD, 6);
  assert.equal(SecurityUpdateDefaults.WINDOW_MS, 15000);
  // Non-régression des seuils des autres services (jamais touchés par P5).
  assert.deepEqual({ ...SecurityNukeDefaults.THRESHOLDS }, { channelCreate: 10, channelDelete: 12, roleCreate: 30, roleDelete: 32 });
  assert.equal(SecurityNukeDefaults.WINDOW_MS, 15000);
  assert.equal(SecurityRaidDefaults.THRESHOLD, 5);
  assert.equal(SecurityRaidDefaults.WINDOW_MS, 15000);
  assert.equal(SecurityPermsDefaults.CHANNEL_DISTINCT_THRESHOLD, 5);
  assert.equal(SecurityPermsDefaults.ROLE_DISTINCT_THRESHOLD, 3);
});

test("P5 service canaux : 9/10 → pas de déclenchement ; 10/10 → déclenchement", () => {
  let now = 0;
  const svc = service(() => now);
  for (let i = 1; i <= 9; i += 1) {
    now += 100;
    const r = svc.recordChannelContent({ guildId: "g1", channelId: `c${i}` });
    assert.equal(r.triggered, false, `${i}/10 : pas de déclenchement`);
    assert.equal(r.distinct, i);
  }
  now += 100;
  const tenth = svc.recordChannelContent({ guildId: "g1", channelId: "c10" });
  assert.equal(tenth.triggered, true, "10/10");
  assert.equal(tenth.distinct, 10);
  assert.equal(tenth.threshold, 10);
  assert.equal(tenth.windowMs, 15000);
});

test("P5 service canaux : 11e event sur un salon DÉJÀ compté → pas de re-déclenchement", () => {
  let now = 0;
  const svc = service(() => now);
  for (let i = 1; i <= 10; i += 1) {
    now += 50;
    svc.recordChannelContent({ guildId: "g1", channelId: `c${i}` });
  }
  now += 50;
  const repeat = svc.recordChannelContent({ guildId: "g1", channelId: "c3" });
  assert.equal(repeat.triggered, false, "alerted + aucun nouveau distinct");
  assert.equal(repeat.distinct, 10, "toujours 10 distincts");
});

test("P5 service canaux : même salon répété 12 fois → jamais de déclenchement", () => {
  let now = 0;
  const svc = service(() => now);
  for (let i = 0; i < 12; i += 1) {
    now += 100;
    const r = svc.recordChannelContent({ guildId: "g1", channelId: "cSame" });
    assert.equal(r.triggered, false, `event ${i + 1} : 1 seul salon distinct`);
    assert.equal(r.distinct, 1);
  }
});

test("P5 service canaux : fenêtre expirée → réarmement complet", () => {
  let now = 0;
  const svc = service(() => now);
  for (let i = 1; i <= 10; i += 1) {
    now += 50;
    svc.recordChannelContent({ guildId: "g1", channelId: `c${i}` });
  }
  now += 50;
  assert.equal(svc.recordChannelContent({ guildId: "g1", channelId: "cX" }).triggered, false);

  now += SecurityUpdateDefaults.WINDOW_MS + 1000;
  for (let i = 1; i <= 9; i += 1) {
    const r = svc.recordChannelContent({ guildId: "g1", channelId: `n${i}` });
    assert.equal(r.triggered, false, `nouvelle fenêtre : ${i}/10`);
    assert.equal(r.distinct, i, "compteur remis à zéro");
  }
  assert.equal(svc.recordChannelContent({ guildId: "g1", channelId: "n10" }).triggered, true);
});

test("P5 service : isolation stricte par guild", () => {
  let now = 0;
  const svc = service(() => now);
  for (let i = 1; i <= 6; i += 1) {
    now += 50;
    svc.recordChannelContent({ guildId: "gA", channelId: `a${i}` });
  }
  now += 50;
  const b = svc.recordChannelContent({ guildId: "gB", channelId: "b1" });
  assert.equal(b.distinct, 1, "gB démarre à 1, non pollué par gA");
  assert.equal(b.triggered, false);
  const a = svc.recordChannelContent({ guildId: "gA", channelId: "a7" });
  assert.equal(a.distinct, 7, "gA poursuit son propre compteur");
});

test("P5 service rôles : 5/6 → rien ; 6/6 → déclenchement ; même rôle répété ≠ plusieurs", () => {
  let now = 0;
  const svc = service(() => now);
  for (let i = 1; i <= 5; i += 1) {
    now += 100;
    const r = svc.recordRoleContent({ guildId: "g1", roleId: `r${i}` });
    assert.equal(r.triggered, false, `${i}/6 : pas de déclenchement`);
  }
  // Le même rôle répété ne fait pas monter le compteur.
  now += 100;
  const repeat = svc.recordRoleContent({ guildId: "g1", roleId: "r1" });
  assert.equal(repeat.distinct, 5, "toujours 5 distincts après répétition");
  assert.equal(repeat.triggered, false);

  now += 100;
  const sixth = svc.recordRoleContent({ guildId: "g1", roleId: "r6" });
  assert.equal(sixth.triggered, true, "6/6");
  assert.equal(sixth.threshold, 6);

  now += 100;
  assert.equal(svc.recordRoleContent({ guildId: "g1", roleId: "rX" }).triggered, false, "1 alerte/fenêtre");
});

test("P5 service : paramètres invalides → fail-safe (jamais de déclenchement)", () => {
  let now = 0;
  const svc = service(() => now);
  assert.equal(svc.recordChannelContent({}).triggered, false);
  assert.equal(svc.recordChannelContent({ guildId: "g1" }).triggered, false);
  assert.equal(svc.recordRoleContent({ guildId: "g1", roleId: null }).triggered, false);
  const noThresholds = service(() => now, { channelUpdate: 0, roleUpdate: 0 });
  assert.equal(noThresholds.recordChannelContent({ guildId: "g1", channelId: "c" }).triggered, false);
});

test("P5 service : clear(guildId) isole la purge", () => {
  let now = 0;
  const svc = service(() => now);
  for (let i = 1; i <= 10; i += 1) svc.recordChannelContent({ guildId: "gA", channelId: `a${i}` });
  for (let i = 1; i <= 3; i += 1) svc.recordChannelContent({ guildId: "gB", channelId: `b${i}` });
  svc.clear("gA");
  assert.equal(svc.recordChannelContent({ guildId: "gA", channelId: "aZ" }).distinct, 1, "gA purgé");
  assert.equal(svc.recordChannelContent({ guildId: "gB", channelId: "bZ" }).distinct, 4, "gB intact");
});
