"use strict";

const { CaptchaConfigKey: Key, CaptchaProvisionDefaults: Defaults } = require("../configuration/captchaConstants");

/**
 * Repli de session : si la PERSISTANCE échoue (colonnes L2 absentes de la
 * base avant la migration manuelle), l'ID créé est conservé en mémoire pour
 * éviter de recréer le rôle/canal à CHAQUE join. Volatil — la migration
 * SQL L2 rend ce repli inutile.
 */
const provisionFallbackIds = new Map();

/**
 * P-CAPT L2 — auto-réparation des éléments CAPTCHA.
 *
 * Règles :
 *  • l'ID configuré est la SOURCE DE VÉRITÉ — un élément présent n'est jamais
 *    recréé ni remplacé (« ne recrée pas inutilement ») ;
 *  • seul l'élément MANQUANT est recréé, puis son ID persisté ;
 *  • aucune autre règle du serveur n'est touchée (pas d'autre salon, pas de
 *    permission globale) ; le canal ne reçoit que son propre overwrite ;
 *  • chaque échec Discord devient une erreur CLAIRE dans le résultat
 *    (code + élément + message), sans lever — l'appelant décide ;
 *  • déclencheurs : arrivée d'un membre, interactions/settings, startup
 *    (panneau) — jamais de tâche continue.
 */
class CaptchaProvisioningService {
  constructor({ configService, transport }) {
    this.configService = configService;
    this.transport = transport;
  }

  /** État d'un élément : intact = déjà présent ; created = recréé ; failed = erreur ; skipped = hors périmètre. */
  #entry(element, state, extra = {}) {
    return Object.freeze({ element, state, ...extra });
  }

  async ensure(guildId, { force = false } = {}) {
    const results = { created: [], intact: [], failed: [], skipped: [], config: null };
    let config;
    try {
      config = await this.configService.read(guildId);
    } catch (error) {
      results.failed.push(this.#entry("config", "failed", { code: "captcha.provision_config_read_failed", error: error?.message || String(error) }));
      return results;
    }
    results.config = config;

    // Captcha off ⇒ aucun provisionnement (aucune création inutile).
    if (!config?.[Key.ENABLED]) {
      if (force) results.failed.push(this.#entry("enabled", "failed", { code: "captcha.forceRequiresEnabled" }));
      return results;
    }

    const persist = async (key, value) => {
      try {
        config = await this.configService.update(guildId, { [key]: value });
        results.config = config;
        return true;
      } catch (error) {
        results.failed.push(this.#entry("config", "failed", { code: "captcha.provision_persist_failed", key, error: error?.message || String(error) }));
        return false;
      }
    };

    // ── 1. Rôle non vérifié (obligatoire) ──
    await this.#ensureRole(results, {
      key: Key.UNVERIFIED_ROLE_ID,
      element: "unverifiedRole",
      name: Defaults.UNVERIFIED_ROLE_NAME,
      optional: false,
      persist,
      guildId,
    });

    // ── 2. Rôle vérifié (uniquement s'il a été configuré puis supprimé) ──
    await this.#ensureRole(results, {
      key: Key.ROLE_ID,
      element: "verifiedRole",
      name: Defaults.VERIFIED_ROLE_NAME,
      optional: true,
      persist,
      guildId,
    });

    // ── 3. Canal CAPTCHA (uniquement s'il a été configuré puis supprimé) + son overwrite ──
    await this.#ensureChannel(results, { persist, guildId });

    return results;
  }

  async #ensureRole(results, { key, element, name, optional, persist, guildId }) {
    const currentId = results.config?.[key] || provisionFallbackIds.get(`${guildId}:${key}`) || null;
    if (!currentId) {
      if (optional) {
        // Rôle vérifié non configuré : l'admin choisit — rien à créer.
        results.skipped.push(this.#entry(element, "skipped", { code: "captcha.provision_not_configured" }));
        return;
      }
      // Rôle non vérifié OBLIGATOIRE : créé dès qu'il manque.
      try {
        const created = await this.transport.createRole(name);
        if (!created?.id) throw new Error("role id missing after create");
        provisionFallbackIds.set(`${guildId}:${key}`, created.id);
        if (await persist(key, created.id)) {
          results.created.push(this.#entry(element, "created", { id: created.id, previousId: null }));
        }
      } catch (error) {
        results.failed.push(this.#entry(element, "failed", { code: "captcha.provision_role_failed", error: error?.message || String(error) }));
      }
      return;
    }
    let role = null;
    try {
      role = await this.transport.getRole(currentId);
    } catch (error) {
      results.failed.push(this.#entry(element, "failed", { code: "captcha.provision_role_failed", error: error?.message || String(error) }));
      return;
    }
    if (role) {
      results.intact.push(this.#entry(element, "intact", { id: currentId }));
      return;
    }
    // Élément configuré puis supprimé → recréé UNIQUEMENT maintenant.
    try {
      const created = await this.transport.createRole(name);
      if (!created?.id) throw new Error("role id missing after create");
      provisionFallbackIds.set(`${guildId}:${key}`, created.id);
      if (await persist(key, created.id)) {
        results.created.push(this.#entry(element, "created", { id: created.id, previousId: currentId }));
      }
    } catch (error) {
      results.failed.push(this.#entry(element, "failed", { code: "captcha.provision_role_failed", error: error?.message || String(error) }));
    }
  }

  async #ensureChannel(results, { persist, guildId }) {
    const currentId = results.config?.[Key.CHANNEL_ID] || provisionFallbackIds.get(`${guildId}:${Key.CHANNEL_ID}`) || null;
    if (!currentId) {
      results.skipped.push(this.#entry("channel", "skipped", { code: "captcha.provision_not_configured" }));
      return;
    }
    let control;
    try {
      control = await this.transport.ensureChannelControl(currentId);
    } catch (error) {
      results.failed.push(this.#entry("channel", "failed", { code: "captcha.provision_channel_failed", error: error?.message || String(error) }));
      return;
    }
    if (control.ok) {
      results.intact.push(this.#entry("channel", "intact", { id: currentId, controlChanged: Boolean(control.changed) }));
      return;
    }
    if (control.reason !== "captcha.channelInvalid") {
      // Canal présent mais permissions refusées : erreur claire, aucune
      // modification d'un autre salon.
      results.failed.push(this.#entry("channel", "failed", { code: "captcha.provision_channel_permissions_failed", error: control.error || control.reason }));
      return;
    }
    // Canal configuré puis supprimé → recréé UNIQUEMENT (overwrite minimal).
    try {
      const created = await this.transport.createCaptchaChannel(Defaults.CHANNEL_NAME);
      if (!created?.id) throw new Error("channel id missing after create");
      provisionFallbackIds.set(`${guildId}:${Key.CHANNEL_ID}`, created.id);
      await this.transport.ensureChannelControl(created.id);
      if (await persist(Key.CHANNEL_ID, created.id)) {
        results.created.push(this.#entry("channel", "created", { id: created.id, previousId: currentId }));
      }
    } catch (error) {
      results.failed.push(this.#entry("channel", "failed", { code: "captcha.provision_channel_failed", error: error?.message || String(error) }));
    }
  }
}

module.exports = { CaptchaProvisioningService };
