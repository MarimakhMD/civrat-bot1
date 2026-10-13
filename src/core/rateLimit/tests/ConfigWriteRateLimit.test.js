"use strict";

/**
 * P6 §14 — rate-limit des écritures de configuration : 30 / 60 s par
 * (guild, user), appliqué par `enforceConfigWrite`.
 *
 * Verrouille sur un VRAI handler (toggleLogs) : 30 écritures autorisées,
 * 31e refusée (aucun upsert, aucune lecture inutile), les LECTURES restent
 * toujours libres même à quota épuisé, isolations user et guild, expiration
 * 60 s, message FR/EN, fail-open sans acteur.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { toggleLogs, backToLogs } = require("../../../modules/logs/interactions/configureLogs");
const { enforceConfigWrite, ActionRateLimitGuard, RATE_LIMITS } = require("../ActionRateLimitGuard");
const fr = require("../../i18n/locales/fr.json");
const en = require("../../i18n/locales/en.json");

const FR_MESSAGE = fr.ratelimit.retry;
const EN_MESSAGE = en.ratelimit.retry;

function harness({ guildId = "g1", userId = "u1", locale = "fr" } = {}) {
  let now = 1_000_000;
  const guard = new ActionRateLimitGuard({ clock: () => now });

  const service = {
    reads: 0,
    updates: 0,
    async read() { this.reads += 1; return { logs_enabled: false }; },
    async update(guildId_, patch) { this.updates += 1; return { logs_enabled: patch.logs_enabled }; },
  };

  const replies = [];
  const viewUpdates = [];
  const t = (key) => (key === "ratelimit.retry" ? (locale === "fr" ? FR_MESSAGE : EN_MESSAGE) : key);

  function makeContext({ g = guildId, u = userId } = {}) {
    return {
      guildId: g,
      userId: u,
      t,
      rateLimitGuard: guard,
      service,
      envelope: {
        transport: {
          async reply(payload) { replies.push({ g, u, payload }); },
          async update(payload) { viewUpdates.push(payload); },
        },
      },
    };
  }

  return { guard, tick: (ms) => { now += ms; }, service, replies, viewUpdates, makeContext };
}

test("P6 config : 30 écritures autorisées, 31e refusée sans upsert", async () => {
  const h = harness();

  for (let i = 1; i <= 30; i += 1) {
    const saved = await toggleLogs(h.makeContext());
    assert.ok(saved, `écriture ${i}/30 autorisée`);
  }
  assert.equal(h.service.updates, 30, "30 upserts");
  assert.equal(h.replies.length, 0, "aucun refus");

  const thirtyFirst = h.makeContext();
  const refused = await toggleLogs(thirtyFirst);
  assert.equal(refused, null, "refus signalé à l'appelant (pas de rendu)");
  assert.equal(h.service.updates, 30, "AUCUN upsert au refus");
  assert.equal(h.service.reads, 30, "aucune même lecture au refus (garde avant le read)");
  assert.equal(h.replies.length, 1, "réponse éphémère de refus");
  assert.equal(h.replies[0].payload.ephemeral, true);
  assert.equal(h.replies[0].payload.view.content, FR_MESSAGE, "message FR non alarmiste");
});

test("P6 config : les lectures restent toujours libres à quota épuisé", async () => {
  const h = harness();
  for (let i = 0; i < 31; i += 1) await toggleLogs(h.makeContext());

  const readsBefore = h.service.reads;
  const repliesBefore = h.replies.length;
  // backToLogs = lecture de la vue principale : jamais de garde.
  await backToLogs(h.makeContext());
  assert.equal(h.service.reads, readsBefore + 1, "lecture exécutée");
  assert.equal(h.replies.length, repliesBefore, "aucun refus sur une lecture");
  assert.ok(h.viewUpdates.length > 0, "vue rafraîchie");
});

test("P6 config : isolation user et guild", async () => {
  const h = harness();
  for (let i = 0; i < 31; i += 1) await toggleLogs(h.makeContext());
  assert.equal(h.service.updates, 30);

  assert.ok(await toggleLogs(h.makeContext({ u: "u2" })), "user isolé");
  assert.ok(await toggleLogs(h.makeContext({ g: "g2" })), "guild isolée");
  assert.equal(h.service.updates, 32);
});

test("P6 config : expiration 60 s", async () => {
  const h = harness();
  for (let i = 0; i < 31; i += 1) await toggleLogs(h.makeContext());
  assert.equal(h.service.updates, 30);

  h.tick(RATE_LIMITS.CONFIG.windowMs + 1);
  assert.ok(await toggleLogs(h.makeContext()), "réarmé après 60 s");
  assert.equal(h.service.updates, 31);
});

test("P6 config : message EN en locale en", async () => {
  const h = harness({ locale: "en" });
  for (let i = 0; i < 31; i += 1) await toggleLogs(h.makeContext());
  assert.equal(h.replies[0].payload.view.content, EN_MESSAGE);
  assert.notEqual(EN_MESSAGE, FR_MESSAGE);
});

test("P6 config : fail-open sans acteur (aucune clé, aucune consommation)", async () => {
  let now = 1_000_000;
  const guard = new ActionRateLimitGuard({ clock: () => now });
  let replied = 0;
  const allowed = await enforceConfigWrite(
    { guildId: "g1", userId: null, t: () => FR_MESSAGE, envelope: { transport: { reply: async () => { replied += 1; } } }, rateLimitGuard: guard },
  );
  assert.equal(allowed, true, "sans userId : autorisé (fail-open)");
  assert.equal(guard.size, 0, "aucune clé créée");
  assert.equal(replied, 0);
});
