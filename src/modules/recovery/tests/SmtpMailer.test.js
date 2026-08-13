"use strict";

// P20 — client SMTP : tests 100 % offline sur socket SCRIPTE (jamais de
// connexion réelle, jamais de port ouvert). Les identifiants utilisés sont
// des placeholders fictifs.

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { SmtpMailer, parseSmtpReply, dotStuff } = require("../mail/SmtpMailer");

const FAKE_CONFIG = Object.freeze({
  host: "smtp.example.test",
  port: 587,
  user: "fake-user",
  password: "fake-password",
  secure: false,
  from: "fake-user",
});

// Socket simulé : chaque écriture client reçoit la réponse serveur suivante
// du script PARTAGÉ (l'upgrade TLS après STARTTLS wraps la même connexion :
// la file de réponses doit donc être commune aux deux sockets). Les émissions
// imitent de vrais I/O via setImmediate (jamais en nextTick synchrone avec
// connect : à ce stade la session n'écoute pas encore « data »).
class ScriptedSocket extends EventEmitter {
  constructor(script, { event = "connect", greeting = null } = {}) {
    super();
    this.script = script; // référence partagée, consommée par shift()
    this.writes = [];
    this.destroyed = false;
    this.handshake = event;
    setImmediate(() => this.emit(event));
    if (greeting !== null) setImmediate(() => this.push(greeting));
  }

  setTimeout(_ms, _cb) { /* hors ligne : pas de temporisation réelle */ }

  write(data) {
    this.writes.push(String(data));
    setImmediate(() => this.pushNext());
  }

  push(payload) {
    this.emit("data", Buffer.from(payload, "utf8"));
  }

  pushNext() {
    if (this.script.length > 0) this.push(this.script.shift());
  }

  end() { this.ended = true; }
  destroy() { this.destroyed = true; }
}

function mailer(replies, config = FAKE_CONFIG) {
  const sockets = [];
  const script = [...replies];
  // Le greeting appartient au PREMIER socket créé : en 587 c'est la connexion
  // claire (l'upgrade TLS après STARTTLS n'en reçoit PAS — la session reprend
  // par un EHLO) ; en 465 c'est directement la connexion TLS.
  let greeting = script.shift();
  const takeGreeting = () => { const g = greeting; greeting = null; return g; };
  const connect = () => { const s = new ScriptedSocket(script, { event: "connect", greeting: takeGreeting() }); sockets.push(s); return s; };
  const tlsConnect = () => { const s = new ScriptedSocket(script, { event: "secureConnect", greeting: takeGreeting() }); sockets.push(s); return s; };
  return { m: new SmtpMailer({ config, connect, tlsConnect }), sockets };
}

const STARTTLS_SCRIPT = [
  "220 smtp.example.test ESMTP\r\n",
  "250-smtp.example.test\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n", // EHLO (multi-lignes)
  "220 2.0.0 Ready to start TLS\r\n", // STARTTLS
  "250 smtp.example.test\r\n", // EHLO après upgrade
  "334 VXNlcm5hbWU6\r\n", // AUTH LOGIN
  "334 UGFzc3dvcmQ6\r\n", // user
  "235 2.7.0 Authentication successful\r\n", // password
  "250 2.1.0 Ok\r\n", // MAIL FROM
  "250 2.1.5 Ok\r\n", // RCPT TO
  "354 End data with <CR><LF>.<CR><LF>\r\n", // DATA
  "250 2.0.0 Ok: queued\r\n", // corps
  "221 2.0.0 Bye\r\n", // QUIT
];

test("happy path 587 STARTTLS + AUTH LOGIN delivers the message", async () => {
  const { m, sockets } = mailer(STARTTLS_SCRIPT);
  await m.send({ to: "owner@example.test", subject: "CIVRAT recovery code", text: "Your CIVRAT recovery code is: 123456" });
  const transcript = sockets.flatMap((s) => s.writes).join("");
  const order = ["EHLO civrat-bot", "STARTTLS", "EHLO civrat-bot", "AUTH LOGIN", "MAIL FROM:<fake-user>", "RCPT TO:<owner@example.test>", "DATA", "QUIT"];
  let cursor = -1;
  for (const step of order) {
    // Recherche APRÈS l'étape précédente : « EHLO civrat-bot » apparaît deux
    // fois (avant et après l'upgrade TLS) et doit être distingué.
    const at = transcript.indexOf(step, cursor + 1);
    assert.ok(at > cursor, `protocol step out of order or missing: ${step}`);
    cursor = at;
  }
  assert.ok(transcript.includes(Buffer.from("fake-user", "utf8").toString("base64")), "AUTH LOGIN user is base64-encoded");
  assert.ok(transcript.includes("Subject: CIVRAT recovery code"));
});

test("implicit TLS (465) connects securely without STARTTLS", async () => {
  const script = [
    "220 smtp.example.test ESMTP\r\n",
    "250 smtp.example.test\r\n", // EHLO
    "334 VXNlcm5hbWU6\r\n", "334 UGFzc3dvcmQ6\r\n", "235 2.7.0 Ok\r\n", // AUTH LOGIN
    "250 ok\r\n", "250 ok\r\n", "354 go\r\n", "250 queued\r\n", "221 bye\r\n",
  ];
  const config = Object.freeze({ ...FAKE_CONFIG, port: 465, secure: true });
  const { m, sockets } = mailer(script, config);
  await m.send({ to: "owner@example.test", subject: "CIVRAT recovery code", text: "x" });
  const transcript = sockets.flatMap((s) => s.writes).join("");
  assert.ok(!transcript.includes("STARTTLS"), "no STARTTLS on implicit TLS");
  assert.equal(sockets[0].handshake, "secureConnect");
});

test("a server refusal becomes a generic error that never leaks secrets", async () => {
  const script = ["220 smtp\r\n", "250 ok\r\n", "220 tls\r\n", "250 ok\r\n", "334 VXNlcm5hbWU6\r\n", "334 UGFzc3dvcmQ6\r\n", "535 5.7.8 Authentication failed\r\n"];
  const { m } = mailer(script);
  const error = await m.send({ to: "o@example.test", subject: "s", text: "t" }).then(() => null, (e) => e);
  assert.ok(error, "refusal must reject");
  assert.equal(error.message, "smtp_delivery_failed");
  assert.ok(!error.message.includes(FAKE_CONFIG.password), "the SMTP password is never exposed");
});

test("CR/LF in headers is neutralized (no header injection)", async () => {
  const { m, sockets } = mailer(STARTTLS_SCRIPT);
  await m.send({ to: "owner@example.test\r\nBCC: attacker@evil.test", subject: "Hi\r\nX-Inject: 1", text: "body" });
  const transcript = sockets.flatMap((s) => s.writes).join("");
  // Les valeurs sont aplaties sur une seule ligne : aucune en-tête injectée.
  assert.ok(!/[\r\n]BCC:/.test(transcript), "no injected BCC header line");
  assert.ok(!/[\r\n]X-Inject:/.test(transcript), "no injected header line");
  assert.ok(transcript.includes("RCPT TO:<owner@example.test BCC: attacker@evil.test>"), "value sanitized inline");
});

test("dotStuff doubles leading dots; parseSmtpReply waits for multiline ends", () => {
  assert.equal(dotStuff("a\n.b\r\nc"), `a\r\n..b\r\nc`);
  assert.equal(parseSmtpReply("250-one\r\n"), null);
  assert.equal(parseSmtpReply("250-one\r\n250-two\r\n"), null);
  assert.equal(parseSmtpReply("250-one\r\n250 done\r\n"), 250);
  assert.equal(parseSmtpReply(""), null);
});
