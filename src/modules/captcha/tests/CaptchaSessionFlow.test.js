"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { handleCaptchaVerify } = require("../interactions/captchaVerifyRoute");
const { CaptchaSessionStore, CaptchaSessionState } = require("../services/CaptchaSessionStore");
const { CaptchaVerificationService } = require("../services/CaptchaVerificationService");
const { CaptchaComponentId: Id, CaptchaConfigKey: Key } = require("../configuration/captchaConstants");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { ActionRateLimitGuard, RATE_LIMITS } = require("../../../core/rateLimit/ActionRateLimitGuard");
const { registerCaptcha } = require("../register");

/** Contexte d'interaction minimal — member.guild absent : le log central est
 *  skippé (le mapping des logs est couvert par CaptchaVerificationLogs). */
function buildContext({ guildId = "g", userId = "u", roleIds = [] } = {}) {
  const replies = [];
  let defers = 0;
  const member = {
    id: userId,
    guild: null,
    roles: { cache: new Map(roleIds.map((id) => [id, {}])), add: async () => {} },
  };
  const context = {
    guildId,
    userId,
    t: (key) => key,
    envelope: {
      userId,
      customId: Id.VERIFY,
      values: [],
      discordMember: member,
      transport: {
        deferUpdate: async () => { defers += 1; },
        reply: async (payload) => { replies.push(payload); return payload; },
        update: async (payload) => { replies.push(payload); return payload; },
      },
    },
  };
  return { context, replies, defers: () => defers };
}

function harness({ config = {}, clock = Date.now, userId = "u" } = {}) {
  const { context, replies, defers } = buildContext({ userId });
  const records = [];
  const guard = { check: () => ({ allowed: true }), record: (args) => records.push(args) };
  const store = new CaptchaSessionStore({ clock });
  const configService = { read: async () => ({ ...config }) };
  return {
    context, replies, defers, records, store, configService, guard,
    runtime: () => ({ configService, sessionStore: store, rateLimitGuard: guard, clock }),
    store,
  };
}

/** Vrai service de vérification, transport en mémoire (records du P4). */
function realService(config, opts = {}) {
  const transport = {
    getRole: async (id) => (opts.roleMissing ? null : { id, managed: false, position: 1 }),
    canManageRole: () => !opts.unmanageable,
    assignRole: async () => { if (opts.failAssign) throw new Error("assign failure"); },
  };
  const svc = new CaptchaVerificationService({ configService: { read: async () => config }, transport });
  const calls = [];
  const spy = { calls, verify: async (input) => { calls.push(input); return svc.verify(input); } };
  return spy;
}

test("Free flow — success creates one session, credits one gate slot, replies verified", async () => {
  const config = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r" };
  const h = harness({ config });
  const svc = realService(config);

  const result = await handleCaptchaVerify(h.context, svc, h.runtime());

  assert.equal(result.verified, true);
  assert.equal(result.code, "CAPTCHA_VERIFIED");
  assert.equal(h.defers(), 1, "un deferUpdate avant toute réponse");
  assert.equal(h.replies.length, 1);
  assert.equal(h.replies[0].view.content, "captcha.CAPTCHA_VERIFIED");
  assert.equal(h.replies[0].ephemeral, true);
  assert.equal(h.records.length, 1, "une seule création de session = un crédit P6");
  assert.equal(h.records[0].group, "captcha");
  assert.equal(h.store.size, 0, "SUCCESS = terminal : la session est retirée");
});

test("Free flow — second click during validation is ignored, never credited", async () => {
  const config = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r" };
  const h = harness({ config });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = { verify: async () => { await gate; return { verified: true, code: "CAPTCHA_VERIFIED", guildId: "g", memberId: "u", details: { roleId: "r" } }; } };
  const mustNotCall = { verify: async () => { throw new Error("second click must not reach verification"); } };

  const first = handleCaptchaVerify(h.context, slow, h.runtime());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.store.size, 1, "la première session existe pendant la validation");

  const second = await handleCaptchaVerify(h.context, mustNotCall, h.runtime());
  assert.equal(second.code, "CAPTCHA_SESSION_IN_PROGRESS");
  assert.equal(h.records.length, 1, "aucun crédit pour un double clic");

  release();
  await first;
  assert.equal(h.records.length, 1, "toujours un seul crédit après la validation");
  assert.equal(h.store.size, 0);
  const contents = h.replies.map((r) => r.view.content);
  assert.deepEqual(contents, ["captcha.CAPTCHA_SESSION_IN_PROGRESS", "captcha.CAPTCHA_VERIFIED"]);
});

test("Free flow — disabled config refuses before any session or credit", async () => {
  const config = { [Key.ENABLED]: false, [Key.ROLE_ID]: "r" };
  const h = harness({ config });
  const svc = realService(config);

  const result = await handleCaptchaVerify(h.context, svc, h.runtime());

  assert.equal(result.code, "CAPTCHA_DISABLED");
  assert.equal(svc.calls.length, 0, "la désactivation ne doit pas atteindre la vérification");
  assert.equal(h.records.length, 0, "aucun crédit consommé");
  assert.equal(h.store.size, 0);
  assert.equal(h.replies[0].view.content, "captcha.CAPTCHA_DISABLED");
});

test("Free flow — attempts, cooldown, block and unlock via settings presets", async () => {
  let now = 1_000;
  const config = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r" };
  const h = harness({ config, clock: () => now });
  const failer = realService(config, { failAssign: true });

  // Clic 1 → échec d'attribution : FAILED, tentative 1, cooldown 10 s.
  const r1 = await handleCaptchaVerify(h.context, failer, h.runtime());
  assert.equal(r1.code, "CAPTCHA_ASSIGNMENT_FAILED");
  let session = h.store.get("g", "u");
  assert.equal(session.state, CaptchaSessionState.FAILED);
  assert.equal(session.attempts, 1);
  assert.equal(session.nextAttemptAt, now + 10_000);

  // Clic 2 pendant le cooldown → refus, sans appel au service ni crédit.
  const r2 = await handleCaptchaVerify(h.context, failer, h.runtime());
  assert.equal(r2.code, "CAPTCHA_COOLDOWN");
  assert.equal(failer.calls.length, 1);
  assert.equal(h.records.length, 1);

  // Après le cooldown, échec n°2 puis n°3 → blocage.
  now += 10_001;
  await handleCaptchaVerify(h.context, failer, h.runtime());
  now += 10_001;
  const r4 = await handleCaptchaVerify(h.context, failer, h.runtime());
  assert.equal(h.replies.at(-1).view.content, "captcha.CAPTCHA_TOO_MANY_ATTEMPTS");
  assert.equal(r4.code, "CAPTCHA_ASSIGNMENT_FAILED", "le résultat de vérification reste l'échec source");
  session = h.store.get("g", "u");
  assert.equal(session.state, CaptchaSessionState.BLOCKED);
  assert.equal(session.attempts, 3);
  assert.equal(session.blockedUntil, now + 30_000, "cooldown × tentatives");
  assert.equal(h.records.length, 1, "le blocage ne crée rien");

  // Clic pendant le blocage → refus, pas de crédit.
  now += 5_000;
  const r5 = await handleCaptchaVerify(h.context, failer, h.runtime());
  assert.equal(r5.code, "CAPTCHA_TOO_MANY_ATTEMPTS");
  assert.equal(h.records.length, 1);

  // Après le blocage → nouvelle session possible (jamais de blocage définitif),
  // puis succès.
  now += 30_000;
  const pass = realService(config);
  const r6 = await handleCaptchaVerify(h.context, pass, h.runtime());
  assert.equal(r6.code, "CAPTCHA_VERIFIED");
  assert.equal(h.records.length, 2, "nouvelle session = nouveau crédit");
  assert.equal(h.store.size, 0);
});

test("Free flow — expired session is unusable and a new session is possible", async () => {
  let now = 0;
  const config = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r" };
  const h = harness({ config, clock: () => now });
  const failer = realService(config, { failAssign: true });

  const r1 = await handleCaptchaVerify(h.context, failer, h.runtime());
  assert.equal(r1.code, "CAPTCHA_ASSIGNMENT_FAILED");

  // Au-delà de l'expiration (5 min par défaut) : la session expirée ne se
  // réutilise pas, la réponse signale l'expiration.
  now = 5 * 60 * 1000 + 1;
  const r2 = await handleCaptchaVerify(h.context, failer, h.runtime());
  assert.equal(r2.code, "CAPTCHA_SESSION_EXPIRED");
  assert.equal(h.store.size, 0, "session expirée supprimée");
  assert.equal(failer.calls.length, 1, "pas de validation sur session expirée");

  // Le clic suivant recrée proprement.
  const pass = realService(config);
  const r3 = await handleCaptchaVerify(h.context, pass, h.runtime());
  assert.equal(r3.code, "CAPTCHA_VERIFIED");
  assert.equal(h.store.size, 0);
});

test("Free flow — system errors roll the session back without penalty", async () => {
  const config = { [Key.ENABLED]: true, [Key.ROLE_ID]: null };
  const h = harness({ config });
  const svc = realService(config);

  const result = await handleCaptchaVerify(h.context, svc, h.runtime());

  assert.equal(result.code, "CAPTCHA_ROLE_NOT_CONFIGURED");
  assert.equal(h.store.size, 0, "aucune session résiduelle = aucune tentative imputée");
  assert.equal(h.records.length, 1, "création puis rollback : un crédit, jamais de pénalité membre");
  assert.equal(h.replies[0].view.content, "captcha.CAPTCHA_ROLE_NOT_CONFIGURED");
});

test("Free flow — rate limit P6 blocks the 6th creation in 30 s (real guard)", async () => {
  const config = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r" };
  const guard = new ActionRateLimitGuard();
  const store = new CaptchaSessionStore();
  const configService = { read: async () => ({ ...config }) };
  const { context, replies } = buildContext({ userId: "rl-user" });
  const runtime = { configService, sessionStore: store, rateLimitGuard: guard };

  for (let i = 0; i < 5; i += 1) {
    const svc = realService(config);
    const result = await handleCaptchaVerify(context, svc, runtime);
    assert.equal(result.verified, true, `création ${i + 1} autorisée`);
  }
  const denied = await handleCaptchaVerify(context, realService(config), runtime);
  assert.equal(denied.code, "ratelimit.retry");
  const gate = guard.check({ guildId: "g", userId: "rl-user", group: RATE_LIMITS.CAPTCHA.group, limit: RATE_LIMITS.CAPTCHA.limit, windowMs: RATE_LIMITS.CAPTCHA.windowMs });
  assert.equal(gate.allowed, false, "le 6e crédit est bien refusé");
  assert.equal(RATE_LIMITS.CAPTCHA.limit, 5);
  assert.equal(replies.length, 6);
});

test("Free flow — isolation by guild and member (two independent sessions)", async () => {
  const config = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r" };
  let now = 100;
  const clock = () => now;
  const store = new CaptchaSessionStore({ clock });
  const configService = { read: async () => ({ ...config }) };
  const records = [];
  const guard = { check: () => ({ allowed: true }), record: (args) => records.push(args) };
  const runtime = { configService, sessionStore: store, rateLimitGuard: guard, clock };
  const failer = realService(config, { failAssign: true });

  const a = buildContext({ guildId: "g1", userId: "m1" });
  const b = buildContext({ guildId: "g2", userId: "m1" });
  const c = buildContext({ guildId: "g1", userId: "m2" });

  await handleCaptchaVerify(a.context, failer, runtime);
  await handleCaptchaVerify(b.context, failer, runtime);
  await handleCaptchaVerify(c.context, failer, runtime);

  assert.equal(store.size, 3, "trois sessions indépendantes");
  assert.equal(store.get("g1", "m1").attempts, 1);
  assert.equal(store.get("g2", "m1").attempts, 1);
  assert.equal(store.get("g1", "m2").attempts, 1);
  assert.deepEqual(new Set(records.map((r) => `${r.guildId}:${r.userId}`)), new Set(["g1:m1", "g2:m1", "g1:m2"]));

  // Le blocage d'un couple ne touche pas les autres.
  now += 10_001;
  await handleCaptchaVerify(a.context, failer, runtime);
  now += 10_001;
  const blockedA = await handleCaptchaVerify(a.context, failer, runtime);
  assert.equal(blockedA.code, "CAPTCHA_ASSIGNMENT_FAILED", "le résultat reste l'échec source");
  assert.equal(a.replies.at(-1).view.content, "captcha.CAPTCHA_TOO_MANY_ATTEMPTS", "mais le membre est prévenu du blocage");
  const b2 = await handleCaptchaVerify(b.context, failer, runtime);
  assert.equal(b2.code, "CAPTCHA_ASSIGNMENT_FAILED", "g2:m1 avance sur son propre compteur");
  assert.equal(store.get("g1", "m1").state, CaptchaSessionState.BLOCKED);
  assert.equal(store.get("g2", "m1").state, CaptchaSessionState.FAILED, "le blocage de g1:m1 ne touche pas g2:m1");
  assert.equal(store.get("g2", "m1").attempts, 2);
});

test("Register routes — advanced view, duration and limits presets end to end", async () => {
  const registry = new InteractionRegistry();
  let config = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r", [Key.CHANNEL_ID]: "c" };
  const updates = [];
  const service = {
    read: async () => ({ ...config }),
    update: async (_g, patch) => { config = { ...config, ...patch }; updates.push(patch); return { ...config }; },
  };
  const guild = {
    roles: { cache: new Map([["r", { id: "r", managed: false, position: 1 }]]) },
    members: { me: { roles: { highest: { position: 10 } } } },
  };
  registerCaptcha({
    registry,
    service,
    verificationServiceFactory: () => new CaptchaVerificationService({
      configService: service,
      transport: {
        getRole: async (id) => guild.roles.cache.get(id) || null,
        canManageRole: (role) => Boolean(role && !role.managed && guild.members.me.roles.highest.position > role.position),
        assignRole: async (member) => { await member.roles.add({ id: "r" }); },
      },
    }),
    settingsHome: async () => {},
  });

  const t = (key, vars) => (vars ? `${key}(${Object.values(vars).join(",")})` : key);
  const buttonRoute = (customId) => registry.find({ kind: "button", customId });
  const selectRoute = (customId) => registry.find({ kind: "select-menu", customId });

  // La vue Avancé s'ouvre et expose les réglages courants.
  const views = [];
  const base = { guildId: "g", userId: "adv", t, envelope: { userId: "adv", transport: { update: async (p) => { views.push(p); }, reply: async () => {}, deferUpdate: async () => {} } } };
  await buttonRoute(Id.ADVANCED).execute(base);
  assert.equal(views.length, 1);
  assert.deepEqual(views[0].view.components.map((c) => c.customId), [Id.DURATION, Id.LIMITS, Id.SECTION]);

  // Durée valide → écriture, retour dans la vue Avancé.
  await selectRoute(Id.DURATION).execute({ ...base, envelope: { ...base.envelope, values: ["10"] } });
  assert.equal(config[Key.EXPIRY_MINUTES], 10);
  assert.ok(views.at(-1).view.content.includes("10"), "la vue reflète la nouvelle durée");

  // Durée hors whitelist → refus silencieux, aucune écriture.
  const before = updates.length;
  await selectRoute(Id.DURATION).execute({ ...base, envelope: { ...base.envelope, values: ["7"] } });
  assert.equal(updates.length, before, "preset non listé rejeté");
  assert.equal(config[Key.EXPIRY_MINUTES], 10);

  // Limits valide → écriture groupée.
  await selectRoute(Id.LIMITS).execute({ ...base, envelope: { ...base.envelope, values: ["2/60"] } });
  assert.equal(config[Key.ATTEMPTS], 2);
  assert.equal(config[Key.COOLDOWN_SECONDS], 60);

  // Limits hors whitelist → refus.
  const before2 = updates.length;
  await selectRoute(Id.LIMITS).execute({ ...base, envelope: { ...base.envelope, values: ["9/1"] } });
  assert.equal(updates.length, before2);

  // Vue Avancé dans les limites Discord (5×5) : 3 composants seulement.
  assert.ok(views.at(-1).view.components.length <= 5);

  // Clic VERIFY via le registre complet (wrapper member + service réel).
  const verifyRoute = buttonRoute(Id.VERIFY);
  assert.deepEqual(verifyRoute.permissions.allOf, []);
  const verifyContext = {
    guildId: "g",
    userId: "e2e-user",
    t,
    rateLimitGuard: { check: () => ({ allowed: true }), record: () => {} },
    envelope: {
      userId: "e2e-user",
      customId: Id.VERIFY,
      values: [],
      discordMember: { id: "e2e-user", guild: null, roles: { cache: new Map(), add: async () => {} } },
      transport: { deferUpdate: async () => {}, reply: async (p) => { views.push(p); }, update: async () => {} },
    },
  };
  const result = await verifyRoute.execute(verifyContext);
  assert.equal(result.verified, true, "le flux complet du registre vérifie le membre");
  assert.equal(views.at(-1).view.content, "captcha.CAPTCHA_VERIFIED");
});

test("Register routes — settings section renders within Discord limits", async () => {
  const registry = new InteractionRegistry();
  const service = { read: async () => ({ [Key.ENABLED]: true }), update: async (_g, p) => p };
  registerCaptcha({ registry, service, settingsHome: async () => {} });
  const views = [];
  await registry.find({ kind: "button", customId: Id.SECTION }).execute({
    guildId: "g", t: (k) => k,
    envelope: { transport: { update: async (p) => { views.push(p); } } },
  });
  const { view } = views[0];
  // Forme brute : composants plats, chunkés en 2 lignes de ≤ 5 par le
  // transport — le contrat Discord complet est couvert par le test
  // `settings-views-discord-limits`.
  assert.equal(view.components.length, 9, "9 composants (L1 : Avancé + L2 : rôle non vérifié, force-existing)");
  assert.ok(view.components.every((c) => c.customId), "composants valides");
  assert.ok(view.components.some((c) => c.customId === Id.ADVANCED), "le bouton Avancé est présent");
});
