"use strict";

const net = require("node:net");
const tls = require("node:tls");

// P20 — client SMTP minimal, dépendance externe zéro (nodemailer volontairement
// évité : offline garanti, surface réduite). Compatible Brevo
// (587 STARTTLS / 465 TLS implicite, AUTH LOGIN).
//
// Garanties de secret :
//  - le mot de passe SMTP, les identifiants et le corps de l'e-mail (qui
//    transporte le code temporaire) ne sont JAMAIS loggés ni exposés dans
//    une erreur : toute défaillance devient Error("smtp_delivery_failed") ;
//  - les valeurs d'en-tête sont purgées de CR/LF (anti injection) ;
//  - les transports (connect/tlsConnect) sont injectables : les tests
//    utilisent des scripts simulés, aucune connexion réelle n'a lieu offline.

const CRLF = "\r\n";
const TIMEOUT_MS = 10000;

class SmtpMailer {
  constructor({ config, connect = net.connect, tlsConnect = tls.connect }) {
    this.config = config;
    this.connectImpl = connect;
    this.tlsConnectImpl = tlsConnect;
  }

  async send({ to, subject, text }) {
    if (!this.config) throw new Error("smtp_delivery_failed");
    const recipient = sanitizeHeaderValue(to);
    const safeSubject = sanitizeHeaderValue(subject);
    if (!recipient || !safeSubject) throw new Error("smtp_delivery_failed");
    let socket = null;
    try {
      socket = await this.openSocket();
      const session = new SmtpSession(socket);
      await session.expect(220); // greeting du serveur
      await session.command("EHLO civrat-bot", 250);
      if (!this.config.secure) {
        await session.command("STARTTLS", 220);
        socket = await this.upgradeTls(socket);
        session.replaceSocket(socket);
        await session.command("EHLO civrat-bot", 250);
      }
      await session.command("AUTH LOGIN", 334);
      await session.command(Buffer.from(this.config.user, "utf8").toString("base64"), 334);
      await session.command(Buffer.from(this.config.password, "utf8").toString("base64"), 235);
      await session.command(`MAIL FROM:<${sanitizeHeaderValue(this.config.from)}>`, 250);
      await session.command(`RCPT TO:<${recipient}>`, 250);
      await session.command("DATA", 354);
      const payload = [
        `From: ${sanitizeHeaderValue(this.config.from)}`,
        `To: ${recipient}`,
        `Subject: ${safeSubject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "",
        dotStuff(String(text)),
        ".",
        "",
      ].join(CRLF);
      await session.command(payload, 250);
      await session.command("QUIT", 221).catch(() => {});
      socket.end();
    } catch (_error) {
      try { socket?.destroy(); } catch {}
      throw new Error("smtp_delivery_failed");
    }
  }

  openSocket() {
    return new Promise((resolve, reject) => {
      const options = { host: this.config.host, port: this.config.port };
      const socket = this.config.secure
        ? this.tlsConnectImpl({ ...options, servername: this.config.host })
        : this.connectImpl(options);
      const fail = () => { try { socket.destroy(); } catch {} reject(new Error("smtp_delivery_failed")); };
      socket.setTimeout(TIMEOUT_MS, fail);
      socket.once("error", fail);
      socket.once(this.config.secure ? "secureConnect" : "connect", () => {
        socket.off("error", fail);
        resolve(socket);
      });
    });
  }

  upgradeTls(socket) {
    return new Promise((resolve, reject) => {
      const tlsSocket = this.tlsConnectImpl({ socket, servername: this.config.host });
      tlsSocket.once("secureConnect", () => resolve(tlsSocket));
      tlsSocket.once("error", () => reject(new Error("smtp_delivery_failed")));
    });
  }
}

// Session réponse-attendue : lit les réplies SMTP (mono ou multi-lignes) et
// exige le code attendu ; toute autre réponse est un échec générique.
class SmtpSession {
  constructor(socket) {
    this.queue = [];
    this.buffer = "";
    this.attach(socket);
  }

  attach(socket) {
    this.socket = socket;
    socket.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      this.pump();
    });
    socket.on("error", () => this.fail());
    socket.on("close", () => this.fail());
  }

  replaceSocket(socket) {
    this.buffer = "";
    this.attach(socket);
  }

  pump() {
    if (this.queue.length === 0) return;
    const code = parseSmtpReply(this.buffer);
    if (code === null) return;
    this.buffer = "";
    this.queue.shift()(code);
  }

  fail() {
    const error = new Error("smtp_delivery_failed");
    while (this.queue.length > 0) this.queue.shift()(error);
  }

  expect(expected) {
    return this.wait(expected);
  }

  async command(line, expected) {
    this.socket.write(line + CRLF);
    return this.wait(expected);
  }

  wait(expected) {
    return new Promise((resolve, reject) => {
      this.queue.push((result) => {
        if (result instanceof Error) return reject(result);
        if (result !== expected) return reject(new Error("smtp_delivery_failed"));
        return resolve(result);
      });
      this.pump(); // la réponse est peut-être déjà arrivée
    });
  }
}

// null si la réponse est incomplète (ou multi-ligne non terminée).
function parseSmtpReply(buffer) {
  const lines = buffer.split(CRLF).filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1];
  if (!/^\d{3} /.test(last)) return null; // "250-" = continuation => attendre
  return Number(last.slice(0, 3));
}

function sanitizeHeaderValue(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function dotStuff(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/\r/g, ""))
    .map((line) => (line.startsWith(".") ? "." + line : line))
    .join(CRLF);
}

module.exports = { SmtpMailer, parseSmtpReply, dotStuff };
