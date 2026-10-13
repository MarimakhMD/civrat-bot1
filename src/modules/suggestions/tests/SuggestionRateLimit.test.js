"use strict";

/**
 * P6 §11 — rate-limit `/suggest` : 3 créations / 10 min par (guild, user).
 *
 * Verrouille : 1er/2e/3e autorisés, 4e refusé (AUCUN insert, AUCUN send,
 * AUCUN defer), isolations user et guild, expiration 10 minutes, message
 * éphémère FR/EN non alarmiste.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { registerSuggestions } = require("../register");
const { ActionRateLimitGuard, RATE_LIMITS } = require("../../../core/rateLimit/ActionRateLimitGuard");
const fr = require("../../../core/i18n/locales/fr.json");
const en = require("../../../core/i18n/locales/en.json");

const FR_MESSAGE = fr.ratelimit.retry;
const EN_MESSAGE = en.ratelimit.retry;

function makeHarness() {
  let now = 1_000_000;
  const guard = new ActionRateLimitGuard({ clock: () => now });

  const inserts = [];
  const sends = [];
  const replies = [];
  let seq = 0;

  const supabase = {
    from: (table) => ({
      insert: (record) => {
        inserts.push({ table, record });
        return { select: () => ({ single: async () => ({ data: { id: `s${++seq}`, ...record }, error: null }) }) };
      },
    }),
  };

  const registry = {
    registerButton() {},
    registerSelectMenu() {},
    registerModal() {},
    registerCommand(route) { this.command = route; },
  };

  registerSuggestions({
    registry,
    configService: { read: async () => ({ suggestions_enabled: true, suggestions_channel_id: "CH1" }) },
    supabase,
  });

  const channel = { isTextBased: () => true, send: async (payload) => { sends.push(payload); return { id: `m${sends.length}` }; } };

  function makeContext({ guildId = "g1", userId = "u1", locale = "fr" } = {}) {
    const transport = {
      deferCalls: 0,
      replies: [],
      async deferReply() { this.deferCalls += 1; },
      async reply(payload) { this.replies.push(payload); replies.push({ guildId, userId, payload }); },
    };
    const t = (key) => (key === "ratelimit.retry" ? (locale === "fr" ? FR_MESSAGE : EN_MESSAGE) : key);
    return {
      guildId,
      userId,
      t,
      rateLimitGuard: guard,
      envelope: {
        transport,
        options: { getString: () => "Voici une suggestion suffisamment longue" },
        discordMember: { id: userId, guild: { channels: { cache: new Map([["CH1", channel]]) } } },
      },
    };
  }

  return {
    guard,
    tick: (ms) => { now += ms; },
    run: (ctx) => registry.command.execute(ctx),
    makeContext,
    inserts,
    sends,
    replies,
  };
}

test("P6 suggest : 3 autorisés puis 4e refusé sans INSERT ni send", async () => {
  const h = makeHarness();

  for (let i = 1; i <= 3; i += 1) {
    const ctx = h.makeContext();
    const result = await h.run(ctx);
    assert.equal(result.ok, true, `création ${i} autorisée`);
    const refusals = ctx.envelope.transport.replies.filter((r) => r.view?.content === FR_MESSAGE);
    assert.equal(refusals.length, 0, "aucune réponse de refus");
    assert.equal(ctx.envelope.transport.deferCalls, 1, `déferré ${i}`);
  }
  assert.equal(h.inserts.length, 3, "3 INSERTs");
  assert.equal(h.sends.length, 3, "3 envois Discord");

  const fourth = h.makeContext();
  const result = await h.run(fourth);
  assert.equal(result.ok, false);
  assert.equal(result.code, "RATE_LIMITED");
  assert.equal(h.inserts.length, 3, "AUCUN insert au refus");
  assert.equal(h.sends.length, 3, "AUCUN send au refus");
  assert.equal(fourth.envelope.transport.deferCalls, 0, "le garde précède le defer");
  assert.equal(fourth.envelope.transport.replies.length, 1, "réponse éphémère de refus");
  const refusal = fourth.envelope.transport.replies[0];
  assert.equal(refusal.ephemeral, true);
  assert.equal(refusal.view.content, FR_MESSAGE, "message FR non alarmiste");
  assert.deepEqual(refusal.view.components, []);
});

test("P6 suggest : isolation entre utilisateurs et entre guildes", async () => {
  const h = makeHarness();
  for (let i = 0; i < 3; i += 1) await h.run(h.makeContext({ guildId: "g1", userId: "u1" }));
  assert.equal(h.inserts.length, 3);

  // Autour user, même guild → libre.
  const otherUser = h.makeContext({ guildId: "g1", userId: "u2" });
  assert.equal((await h.run(otherUser)).ok, true, "user isolé");
  // Autour guild, même user → libre.
  const otherGuild = h.makeContext({ guildId: "g2", userId: "u1" });
  assert.equal((await h.run(otherGuild)).ok, true, "guild isolée");
  assert.equal(h.inserts.length, 5);
});

test("P6 suggest : expiration de la fenêtre 10 minutes", async () => {
  const h = makeHarness();
  for (let i = 0; i < 3; i += 1) await h.run(h.makeContext());
  assert.equal((await h.run(h.makeContext())).code, "RATE_LIMITED");

  h.tick(RATE_LIMITS.SUGGEST.windowMs + 1);
  const after = h.makeContext();
  assert.equal((await h.run(after)).ok, true, "réarmé après 10 minutes");
  assert.equal(h.inserts.length, 4);
});

test("P6 suggest : message de refus EN quand la locale est en", async () => {
  const h = makeHarness();
  for (let i = 0; i < 3; i += 1) await h.run(h.makeContext({ locale: "en" }));
  const refused = h.makeContext({ locale: "en" });
  await h.run(refused);
  assert.equal(refused.envelope.transport.replies[0].view.content, EN_MESSAGE);
  assert.notEqual(EN_MESSAGE, FR_MESSAGE, "FR et EN distincts");
});
