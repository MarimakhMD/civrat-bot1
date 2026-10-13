"use strict";

/**
 * P-CAPT L4 — pont d'émission des journaux de cycle de vie CAPTCHA.
 *
 * TROIS événements, et rien d'autre, réutilisant l'infrastructure de journaux
 * existante (`handleCaptchaEvent` → catégorie `moderation` →
 * `log_moderation_channel_id`) :
 *   • `captcha_provision_failed` — un élément (rôle/canal/config) n'a pas pu
 *     être réparé automatiquement ;
 *   • `captcha_panel_published`  — panneau officiel publié ou régénéré ;
 *   • `captcha_force_existing`   — application de masse du rôle non vérifié.
 *
 * Garanties :
 *   • best-effort absolu : une panne de journalisation n'interrompt JAMAIS le
 *     flux CAPTCHA appelant (aucune exception propagée) ;
 *   • anti-spam : une même clé (guilde + élément + code, guilde + panneau,
 *     guilde + acteur) n'est journalisée qu'une fois par fenêtre courte, en
 *     mémoire — aucun état persistant, aucun salon, aucune colonne ;
 *   • la configuration n'est jamais écrite ni lue en écriture ici ;
 *   • le runtime de journaux peut être injecté (tests) ; par défaut il est
 *     résolu paresseusement comme les autres modules (`getLogsRuntime`).
 */

// Fenêtres d'anti-spam (ms). Volontairement courtes : elles absorbent les
// rafales (arrivées en série, double clic, réconciliation répétée) sans
// masquer durablement un incident.
const CAPTCHA_LOG_DEDUP_WINDOWS = Object.freeze({
  captcha_provision_failed: 60_000,
  captcha_panel_published: 10_000,
  captcha_force_existing: 60_000,
});

// clé de déduplication -> horodatage de la dernière émission.
const recentEmissions = new Map();

function pruneExpired(now) {
  const max = Math.max(...Object.values(CAPTCHA_LOG_DEDUP_WINDOWS));
  for (const [key, timestamp] of recentEmissions) {
    if (now - timestamp >= max) recentEmissions.delete(key);
  }
}

function isDuplicate(key, windowMs, now) {
  if (typeof key !== "string" || key.length === 0 || !(windowMs > 0)) return false;
  const previous = recentEmissions.get(key);
  if (previous !== undefined && now - previous < windowMs) return true;
  recentEmissions.set(key, now);
  return false;
}

/** Runtime de journaux : injecté (tests) ou résolu paresseusement. */
function resolveLogsRuntime(override) {
  if (override) return override;
  try {
    return require("../../logs/runtime/getLogsRuntime").getLogsRuntime();
  } catch {
    return null;
  }
}

/** Émission unique, dédupliquée et best-effort. */
async function emitCaptchaLog({
  guild,
  config = null,
  logsRuntime = null,
  action,
  memberId = null,
  roleId = null,
  details = null,
  dedupKey,
  windowMs = 0,
  now = Date.now(),
}) {
  if (!guild?.id) return { emitted: false, reason: "guild_unavailable" };
  pruneExpired(now);
  if (isDuplicate(dedupKey, windowMs, now)) return { emitted: false, reason: "duplicate" };

  const runtime = resolveLogsRuntime(logsRuntime);
  if (typeof runtime?.handleCaptchaEvent !== "function") {
    return { emitted: false, reason: "logs_unavailable" };
  }

  try {
    const result = await runtime.handleCaptchaEvent({ guild, config, action, memberId, roleId, details });
    // `null` = journaux coupés pour cette guilde (aucune lecture, aucun envoi) ;
    // un résultat non livré (salon non configuré, transport en échec) n'est pas
    // compté comme une émission réussie.
    if (result === null || result === undefined) return { emitted: false, reason: "logs_disabled" };
    if (typeof result === "object" && result.delivered === false) {
      return { emitted: false, reason: "not_delivered", delivery: result.reason || null };
    }
    return { emitted: true };
  } catch (error) {
    // Jamais fatal : le flux CAPTCHA continue, l'incident est retourné.
    return { emitted: false, reason: "log_failed", error: error?.message || String(error) };
  }
}

/** Rôle concerné par un échec de provisionnement (jamais inventé). */
function roleIdForFailure(element, config) {
  if (!config) return null;
  if (element === "unverifiedRole") return config.captcha_unverified_role_id || null;
  if (element === "verifiedRole") return config.captcha_role_id || null;
  return null;
}

/**
 * `captcha_provision_failed` — une entrée par échec réel de
 * `CaptchaProvisioningService.ensure()` (aucune entrée : aucun journal).
 */
async function logProvisionFailures({
  guild,
  config = null,
  results = null,
  logsRuntime = null,
  now = Date.now(),
}) {
  const failures = Array.isArray(results?.failed) ? results.failed : [];
  const outcomes = [];
  for (const failure of failures) {
    const element = failure?.element || "unknown";
    const code = failure?.code || "captcha.provision_failed";
    outcomes.push(await emitCaptchaLog({
      guild,
      config,
      logsRuntime,
      action: "captcha_provision_failed",
      roleId: roleIdForFailure(element, config),
      details: {
        target: element,
        reason: failure?.error ? `${code}: ${failure.error}` : code,
        channelId: element === "channel" && config?.captcha_channel_id ? `<#${config.captcha_channel_id}>` : null,
      },
      dedupKey: `${guild?.id}:captcha_provision_failed:${element}:${code}`,
      windowMs: CAPTCHA_LOG_DEDUP_WINDOWS.captcha_provision_failed,
      now,
    }));
  }
  return outcomes;
}

/**
 * `captcha_panel_published` — publication ou régénération du panneau officiel.
 * Un delivery qui n'a PAS abouti n'est jamais journalisé comme publication.
 */
async function logPanelPublished({
  guild,
  config = null,
  result = null,
  logsRuntime = null,
  now = Date.now(),
}) {
  if (!result?.delivered) return { emitted: false, reason: "not_delivered" };
  const channelId = result.channelId || null;
  const messageId = result.messageId || null;

  return emitCaptchaLog({
    guild,
    config,
    logsRuntime,
    action: "captcha_panel_published",
    roleId: result.details?.roleId || null,
    details: {
      rule: result.regenerated ? "CAPTCHA_PANEL_REGENERATED" : "CAPTCHA_PANEL_CREATED",
      channel: channelId ? `<#${channelId}>` : null,
      messageId,
      // Signal opérationnel : IDs non persistés (colonnes absentes/écriture
      // refusée) — le panneau existe mais ne survivra pas au redémarrage.
      reason: result.persisted === false ? "captcha.panel_not_persisted" : null,
    },
    dedupKey: `${guild?.id}:captcha_panel_published:${channelId}:${messageId}:${Boolean(result.regenerated)}`,
    windowMs: CAPTCHA_LOG_DEDUP_WINDOWS.captcha_panel_published,
    now,
  });
}

/**
 * `captcha_force_existing` — action de masse exécutée (jamais une simple
 * bascule de réglage) : le résumé est celui réellement appliqué.
 */
async function logForceExisting({
  guild,
  config = null,
  moderatorId = null,
  stats = null,
  logsRuntime = null,
  now = Date.now(),
}) {
  const applied = stats?.applied ?? 0;
  const processed = stats?.processed ?? 0;
  const failed = stats?.failed ?? 0;
  const summary = `Applied ${applied}/${processed} — failed ${failed}${stats?.truncated ? " — truncated" : ""}`;

  return emitCaptchaLog({
    guild,
    config,
    logsRuntime,
    action: "captcha_force_existing",
    details: {
      rule: "CAPTCHA_FORCE_EXISTING",
      moderatorId,
      reason: summary,
    },
    dedupKey: `${guild?.id}:captcha_force_existing:${moderatorId || "unknown"}`,
    windowMs: CAPTCHA_LOG_DEDUP_WINDOWS.captcha_force_existing,
    now,
  });
}

/** Réservé aux tests : vide la déduplication en mémoire. */
function resetCaptchaLifecycleLogDedup() {
  recentEmissions.clear();
}

module.exports = {
  CAPTCHA_LOG_DEDUP_WINDOWS,
  logProvisionFailures,
  logPanelPublished,
  logForceExisting,
  resetCaptchaLifecycleLogDedup,
};
