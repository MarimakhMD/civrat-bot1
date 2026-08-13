"use strict";

// P20 — double facteur de récupération propriétaire : couverture offline
// complète. Aucune connexion Discord/Supabase/Brevo : env injecté, mailer
// simulé, horloge contrôlée. Aucun secret réel n'apparaît dans ce fichier
// (le « master » et l'« e-mail » sont des valeurs fictives de test).

const test = require("node:test");
const assert = require("node:assert/strict");
const { RecoveryService } = require("../services/RecoveryService");
const { RecoveryCodeStore } = require("../services/RecoveryCodeStore");
const { RecoveryPolicy } = require("../configuration/recoveryConstants");

const FAKE_MASTER = "fake-master-for-tests";
const FAKE_EMAIL = "owner@example.test";

function fixture({ policy = RecoveryPolicy } = {}) {
  const clock = { now: 1_000_000 };
  const sent = [];
  const logs = [];
  const mailer = {
    send: async ({ to, subject, text }) => { sent.push({ to, subject, text }); },
  };
  const service = new RecoveryService({
    store: new RecoveryCodeStore(),
    env: { masterCode: () => FAKE_MASTER, recoveryEmail: () => FAKE_EMAIL },
    mailer,
    logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    now: () => clock.now,
    policy,
  });
  const advance = (ms) => { clock.now += ms; };
  const sentCode = () => {
    const match = sent[sent.length - 1].text.match(/\b(\d{6})\b/);
    assert.ok(match, "the recovery e-mail must contain the 6-digit code");
    return match[1];
  };
  return { service, sent, logs, advance, sentCode, clock };
}

const INPUT = { guildId: "g1", userId: "u1" };

// 1. Master Code incorrect => refus, aucun e-mail.
test("wrong master code is refused and sends nothing", async () => {
  const f = fixture();
  const result = await f.service.requestRecovery({ ...INPUT, masterCode: "wrong" });
  assert.equal(result.sent, false);
  assert.equal(result.code, "RECOVERY_MASTER_INVALID");
  assert.equal(f.sent.length, 0);
});

// 2. Master Code correct => code temporaire généré et envoyé à l'adresse de récupération.
test("correct master code generates and emails a temporary code", async () => {
  const f = fixture();
  const result = await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  assert.equal(result.sent, true);
  assert.equal(result.code, "RECOVERY_CODE_SENT");
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, FAKE_EMAIL);
  // Le résultat ne contient JAMAIS le code.
  assert.ok(!JSON.stringify(result).match(/\d{6}/));
});

// 3. SMTP simulé : le mailer est injecté, aucune connexion réelle possible.
test("email delivery is fully injectable (offline-only tests)", async () => {
  const f = fixture();
  await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  assert.equal(typeof f.service.mailer.send, "function");
  assert.match(f.sent[0].subject, /CIVRAT/);
});

// 4. Code correct => récupération autorisée (+ élévation active, couture).
test("correct temporary code allows the recovery", async () => {
  const f = fixture();
  await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  const result = f.service.verifyRecovery({ ...INPUT, code: f.sentCode() });
  assert.equal(result.recovered, true);
  assert.equal(result.code, "RECOVERY_VERIFIED");
  assert.equal(f.service.hasActiveElevation("u1"), true);
  assert.equal(f.service.hasActiveElevation("u2"), false);
});

// 5. Code incorrect => refus (tentative comptée).
test("wrong temporary code is refused", async () => {
  const f = fixture();
  await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  const real = f.sentCode();
  const wrong = real === "000000" ? "111111" : "000000";
  const result = f.service.verifyRecovery({ ...INPUT, code: wrong });
  assert.equal(result.recovered, false);
  assert.equal(result.code, "RECOVERY_CODE_INVALID");
});

// 6. Code expiré => refusé et invalidé.
test("an expired code is refused", async () => {
  const f = fixture();
  await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  const code = f.sentCode();
  f.advance(RecoveryPolicy.CODE_TTL_MS + 1);
  assert.equal(f.service.verifyRecovery({ ...INPUT, code }).code, "RECOVERY_CODE_EXPIRED");
  // Même après expiration, plus rien à revérifier.
  assert.equal(f.service.verifyRecovery({ ...INPUT, code }).code, "RECOVERY_NO_PENDING");
});

// 7. Code déjà utilisé => refusé (usage unique).
test("a used code cannot be reused", async () => {
  const f = fixture();
  await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  const code = f.sentCode();
  assert.equal(f.service.verifyRecovery({ ...INPUT, code }).recovered, true);
  assert.equal(f.service.verifyRecovery({ ...INPUT, code }).code, "RECOVERY_NO_PENDING");
});

// 8. Nouvelle demande => ancien code invalidé, seul le nouveau fonctionne.
test("a new successful request invalidates the previous code", async () => {
  const f = fixture();
  await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  const first = f.sentCode();
  f.advance(RecoveryPolicy.REQUEST_COOLDOWN_MS + 1);
  await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  const second = f.sentCode();
  // L'ancien code ne permet plus la récupération (remplacé par le nouveau).
  const oldResult = f.service.verifyRecovery({ ...INPUT, code: first });
  assert.equal(oldResult.recovered, false);
  const newResult = f.service.verifyRecovery({ ...INPUT, code: second });
  assert.equal(newResult.recovered, true);
});

// 9. Limite de tentatives : au-delà, le code est détruit.
test("verification attempts are limited then the code is destroyed", async () => {
  const f = fixture();
  await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  const real = f.sentCode();
  const wrong = real === "000000" ? "111111" : "000000";
  for (let i = 0; i < RecoveryPolicy.MAX_VERIFY_ATTEMPTS - 1; i += 1) {
    assert.equal(f.service.verifyRecovery({ ...INPUT, code: wrong }).code, "RECOVERY_CODE_INVALID");
  }
  assert.equal(f.service.verifyRecovery({ ...INPUT, code: wrong }).code, "RECOVERY_TOO_MANY_ATTEMPTS");
  assert.equal(f.service.verifyRecovery({ ...INPUT, code: real }).code, "RECOVERY_NO_PENDING");
});

// 10. Limite de demandes d'e-mail : cooldown anti-spam, l'ancien code survit.
test("email requests are rate-limited without invalidating the active code", async () => {
  const f = fixture();
  await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  const first = f.sentCode();
  const limited = await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  assert.equal(limited.code, "RECOVERY_REQUEST_LIMITED");
  assert.equal(f.sent.length, 1, "no second e-mail during cooldown");
  assert.equal(f.service.verifyRecovery({ ...INPUT, code: first }).recovered, true);
});

// 11. Jamais de code temporaire ni de Master Code dans les logs.
test("neither the temporary code nor the master code ever reaches the logs", async () => {
  const f = fixture();
  await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  const code = f.sentCode();
  f.service.verifyRecovery({ ...INPUT, code });
  await f.service.requestRecovery({ ...INPUT, masterCode: "wrong" });
  const allLogs = JSON.stringify(f.logs);
  assert.ok(!allLogs.includes(code), "temporary code must never be logged");
  assert.ok(!allLogs.includes(FAKE_MASTER), "master code must never be logged");
  assert.ok(!allLogs.includes(FAKE_EMAIL), "recovery email must never be logged");
  assert.ok(allLogs.includes("recovery_code_sent"), "generic events are logged");
});

// 12. Les variables Recovery du .env.example suivi restent des placeholders vides.
test(".env.example recovery variables stay empty placeholders", () => {
  const fs = require("node:fs");
  const env = fs.readFileSync(".env.example", "utf8");
  for (const name of ["RECOVERY_MASTER_CODE", "RECOVERY_EMAIL", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD"]) {
    assert.match(env, new RegExp(`^${name}=\\s*$`, "m"), `${name} must stay empty`);
  }
});

// 13. Redémarrage du processus : nouveau store => ancien code refusé (documenté).
test("a process restart invalidates every pending code (documented behavior)", async () => {
  const f = fixture();
  await f.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  const code = f.sentCode();
  // « Redémarrage » : nouveau store + nouveau service, mêmes env/mailer.
  const restarted = fixture();
  assert.equal(restarted.service.verifyRecovery({ ...INPUT, code }).code, "RECOVERY_NO_PENDING");
  // L'utilisateur peut simplement refaire une demande après redémarrage.
  const again = await restarted.service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  assert.equal(again.sent, true);
});

// 14/15. Configuration absente => indisponible, jamais d'e-mail ; échec SMTP => aucun code valide.
test("missing configuration fails closed (unavailable, nothing sent)", async () => {
  const f = fixture();
  const noEnv = new RecoveryService({ store: new RecoveryCodeStore(), env: { masterCode: () => null, recoveryEmail: () => null }, mailer: f.service.mailer });
  assert.equal((await noEnv.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER })).code, "RECOVERY_UNAVAILABLE");
  const noMailer = new RecoveryService({ store: new RecoveryCodeStore(), env: { masterCode: () => FAKE_MASTER, recoveryEmail: () => FAKE_EMAIL }, mailer: null });
  assert.equal((await noMailer.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER })).code, "RECOVERY_UNAVAILABLE");
});

test("an SMTP delivery failure leaves no valid code behind", async () => {
  const clock = { now: 5 };
  const service = new RecoveryService({
    store: new RecoveryCodeStore(),
    env: { masterCode: () => FAKE_MASTER, recoveryEmail: () => FAKE_EMAIL },
    mailer: { send: async () => { throw new Error("smtp_delivery_failed"); } },
    now: () => clock.now,
  });
  const result = await service.requestRecovery({ ...INPUT, masterCode: FAKE_MASTER });
  assert.equal(result.code, "RECOVERY_DELIVERY_FAILED");
  assert.equal(service.store.readCode("g1", "u1"), null);
});
