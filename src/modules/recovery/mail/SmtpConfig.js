"use strict";

// P20 — configuration SMTP (compatible Brevo : smtp-relay.brevo.com, port
// 587 STARTTLS ou 465 TLS implicite). Toutes les valeurs viennent des
// variables d'environnement du hosting ; ce module ne contient aucune valeur
// et ne logge jamais ce qu'il lit.

const DEFAULT_PORT = 587;
const IMPLICIT_TLS_PORT = 465;

function readSmtpConfig(env = process.env) {
  const host = env.SMTP_HOST || null;
  const user = env.SMTP_USER || null;
  const password = env.SMTP_PASSWORD || null;
  const portRaw = env.SMTP_PORT;
  const port = portRaw ? Number(portRaw) : DEFAULT_PORT;
  if (!host || !user || !password || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return null; // configuration incomplète => mailer indisponible (fail-closed)
  }
  return Object.freeze({
    host,
    port,
    user,
    password,
    secure: port === IMPLICIT_TLS_PORT, // 465 = TLS implicite ; 587 = STARTTLS
    from: user, // Brevo : expéditeur = login SMTP
  });
}

module.exports = { readSmtpConfig, DEFAULT_PORT, IMPLICIT_TLS_PORT };
