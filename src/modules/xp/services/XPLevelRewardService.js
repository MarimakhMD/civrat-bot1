"use strict";

const { XP_REWARD_LIMITS } = require("../configuration/xpConstants");
// A3 (décision 16) — réutilisation par COMPOSITION de la matrice d'éligibilité
// et du pipeline d'attribution du module autorole. Aucun de ces deux fichiers
// n'est modifié : ils n'ont aucune dépendance à discord.js et sont déjà
// couverts par leurs propres tests (AutoRoleEligibilityMatrix,
// AutoRoleMemberJoinFlow). Les recopier dans le module XP dupliquerait huit
// codes d'échec et deux points de contrôle de hiérarchie.
const { AutoRoleEligibilityService } = require("../../autorole/services/AutoRoleEligibilityService");
const { AutoRoleAssignmentService } = require("../../autorole/services/AutoRoleAssignmentService");
const { DiscordAutoRoleTransport } = require("../../autorole/services/DiscordAutoRoleTransport");

/**
 * A3 — récompenses de niveau.
 *
 * FORMAT CANONIQUE (colonne guild_configs.role_rewards, jsonb, DEFAULT '[]')
 * --------------------------------------------------------------------------
 *   [
 *     { "level": 1, "role_ids": ["123456789012345678"] },
 *     { "level": 5, "role_ids": ["223456789012345678", "323456789012345678"] }
 *   ]
 *
 * Une entrée = un niveau. Plusieurs rôles au même niveau passent par
 * `role_ids`, ce qui rend le niveau unique par construction : un doublon de
 * niveau est donc une configuration invalide, pas un cas à départager.
 *
 * `level_rewards` n'est volontairement PAS gérée ici : l'historique du dépôt
 * (commits 027f8c4 / d56ab7b, architecture supprimée) montre qu'elle désignait
 * la courbe de niveaux ({level, xp_required}) et non des rôles. Voir le
 * commentaire de XP_KEYS dans src/services/guildConfigKeys.js.
 *
 * SÉMAPHANTIQUE
 * -------------
 * • Cumulatif : aucun rôle n'est jamais retiré (décision 8).
 * • Saut multi-niveaux : toutes les récompenses dont le niveau est dans
 *   ]previousLevel, level] sont attribuées (décision 9).
 * • Idempotent : un même rôle n'est attribué qu'une fois par level-up, et le
 *   contrôle MEMBER_ALREADY_HAS_ROLE empêche toute réattribution.
 * • Aucune exception ne sort de grant() : un échec Discord est journalisé et
 *   n'annule jamais le gain d'XP déjà acquis (décision 11).
 *
 * VALIDATION : TOUT OU RIEN
 * -------------------------
 * Une valeur structurellement invalide (mauvais type, doublon de niveau, id
 * non Discord, borne dépassée) invalide l'ENSEMBLE de la configuration :
 * aucune récompense n'est attribuée. Appliquer silencieusement un sous-ensemble
 * d'une configuration cassée produirait des attributions que personne n'a
 * demandées. C'est aussi la sémantique de l'ancien validateur historique, qui
 * exigeait `value.every(...)`.
 */

/** Identifiant Discord : snowflake de 15 à 22 chiffres (reprise de l'historique). */
const DISCORD_ID_PATTERN = /^\d{15,22}$/;

/** Clés de prototype refusées dans une entrée de configuration. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** true si la valeur est un objet simple, pas un tableau ni null. */
function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== "[object Object]") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Valide `role_rewards` et le normalise.
 *
 * Ne lève JAMAIS : toute valeur d'entrée est acceptée, y compris null,
 * undefined, une chaîne, un nombre ou un objet. Une valeur invalide renvoie
 * { valid: false, reason, rewards: [] }.
 *
 * @returns {{valid:boolean, reason:string|null, rewards:Array<{level:number, roleIds:string[]}>}}
 */
function validateRoleRewards(value) {
  const reject = (reason) => ({ valid: false, reason, rewards: [] });

  // Décision 17/18 : null, undefined et [] sont des valeurs vides VALIDES.
  // Les distinguer permet de ne pas journaliser une absence de configuration.
  if (value === null || value === undefined) return { valid: true, reason: "EMPTY", rewards: [] };
  if (!Array.isArray(value)) return reject("NOT_AN_ARRAY");
  if (value.length === 0) return { valid: true, reason: "EMPTY", rewards: [] };
  if (value.length > XP_REWARD_LIMITS.MAX_ENTRIES) return reject("TOO_MANY_ENTRIES");

  const rewards = [];
  const seenLevels = new Set();

  for (const entry of value) {
    if (!isPlainObject(entry)) return reject("INVALID_ENTRY");
    if (UNSAFE_KEYS.has(String(entry.level))) return reject("INVALID_ENTRY");

    // Décision 7 : niveau strictement positif et entier.
    const level = entry.level;
    if (typeof level !== "number" || !Number.isInteger(level) || level <= 0) {
      return reject("INVALID_LEVEL");
    }

    // Décision 6 : un seul niveau par entrée, donc aucun doublon toléré.
    if (seenLevels.has(level)) return reject("DUPLICATE_LEVEL");
    seenLevels.add(level);

    if (!Array.isArray(entry.role_ids)) return reject("INVALID_ROLE_IDS");
    if (entry.role_ids.length === 0) return reject("EMPTY_ROLE_IDS");
    // Décision 5 : au plus 10 rôles par niveau.
    if (entry.role_ids.length > XP_REWARD_LIMITS.MAX_ROLES_PER_ENTRY) return reject("TOO_MANY_ROLES");

    const roleIds = [];
    for (const roleId of entry.role_ids) {
      // Décision 7 : identifiant Discord strictement validé.
      if (typeof roleId !== "string" || !DISCORD_ID_PATTERN.test(roleId)) {
        return reject("INVALID_ROLE_ID");
      }
      roleIds.push(roleId);
    }

    rewards.push(Object.freeze({ level, roleIds: Object.freeze(roleIds) }));
  }

  // Ordre déterministe : l'attribution suit l'ordre croissant des niveaux,
  // indépendamment de l'ordre de stockage en base.
  rewards.sort((a, b) => a.level - b.level);
  return { valid: true, reason: null, rewards };
}

/** Alias de lecture défensive : renvoie [] pour toute valeur inutilisable. */
function parseRoleRewards(value) {
  return validateRoleRewards(value).rewards;
}

/**
 * Décision 9 — résout les rôles à attribuer pour un saut de niveaux.
 *
 * Retient toute récompense dont le niveau est dans ]previousLevel, level] :
 * un membre passant de 0 à 10 reçoit les récompenses des niveaux 1, 5 et 10.
 * Un même rôle présent à deux niveaux franchis n'est retenu qu'une fois.
 *
 * @returns {string[]} identifiants de rôles, sans doublon, par niveau croissant
 */
function resolveRewardRoleIds({ roleRewards, previousLevel, level }) {
  if (!Array.isArray(roleRewards) || roleRewards.length === 0) return [];

  const from = Number.isFinite(previousLevel) ? Math.trunc(previousLevel) : 0;
  const to = Number.isFinite(level) ? Math.trunc(level) : 0;
  // Aucun niveau franchi (ou recul impossible en pratique) : rien à attribuer.
  if (to <= from) return [];

  const roleIds = [];
  const seen = new Set();
  for (const reward of roleRewards) {
    if (!reward || typeof reward.level !== "number") continue;
    if (reward.level <= from || reward.level > to) continue;
    for (const roleId of Array.isArray(reward.roleIds) ? reward.roleIds : []) {
      if (seen.has(roleId)) continue;
      seen.add(roleId);
      roleIds.push(roleId);
    }
  }
  return roleIds;
}

class XPLevelRewardService {
  /**
   * @param {object} [options]
   * @param {object} [options.eligibilityService] matrice d'éligibilité (défaut : autorole)
   * @param {object} [options.assignmentService]  pipeline d'attribution (défaut : autorole)
   * @param {object} [options.logger]             journal optionnel
   */
  constructor({ eligibilityService, assignmentService, logger = null } = {}) {
    this.eligibilityService = eligibilityService && typeof eligibilityService.validate === "function"
      ? eligibilityService
      : new AutoRoleEligibilityService();
    this.assignmentService = assignmentService && typeof assignmentService.assign === "function"
      ? assignmentService
      : new AutoRoleAssignmentService({ transport: new DiscordAutoRoleTransport() });
    this.logger = logger;
  }

  /**
   * Attribue les récompenses de rôle pour un level-up.
   *
   * NE LÈVE JAMAIS. Un échec — configuration invalide, rôle supprimé, bot sans
   * permission, erreur d'API Discord — est consigné dans le résultat et
   * journalisé, sans jamais remonter : le gain d'XP est déjà acquis et ne doit
   * pas être annulé (décision 11).
   *
   * @returns {Promise<{granted:string[], skipped:Array, failed:Array, reason:string|null}>}
   */
  async grant({ guild, member, previousLevel, level, config } = {}) {
    const result = { granted: [], skipped: [], failed: [], reason: null };

    if (!guild || !member || !member.id) {
      result.reason = "INVALID_INPUT";
      return result;
    }

    // Les bots ne gagnent jamais d'XP (XPService sort sur isBot) ; ce garde-fou
    // rend l'invariant explicite plutôt que de le supposer.
    if (member.user && member.user.bot) {
      result.reason = "BOT_MEMBER";
      return result;
    }

    let parsed;
    try {
      parsed = validateRoleRewards(config ? config.role_rewards : undefined);
    } catch {
      // validateRoleRewards est conçue pour ne pas lever ; ce filet garantit
      // malgré tout la décision 18.
      result.reason = "PARSE_FAILED";
      return result;
    }

    if (!parsed.valid) {
      result.reason = parsed.reason;
      this._warn("XP role_rewards configuration is invalid; no reward granted", {
        guildId: guild.id,
        reason: parsed.reason,
      });
      return result;
    }

    // Décision 17 : [] (ou null) = aucune récompense, sans journalisation.
    if (parsed.rewards.length === 0) return result;

    const roleIds = resolveRewardRoleIds({
      roleRewards: parsed.rewards,
      previousLevel,
      level,
    });
    if (roleIds.length === 0) return result;

    const bot = this._botCapability(guild);
    const memberInput = this._memberInput(member);

    for (const roleId of roleIds) {
      try {
        const role = (guild.roles && typeof guild.roles.cache?.get === "function")
          ? guild.roles.cache.get(roleId) || null
          : null;

        // Décision 10 — la matrice autorole statue sur : rôle absent, rôle
        // géré, bot sans ManageRoles, rôle trop haut, membre non gérable,
        // rôle déjà présent.
        const eligibility = this.eligibilityService.validate({
          member: memberInput,
          role: role ? { id: role.id, managed: Boolean(role.managed), position: Number(role.position) } : null,
          bot,
          // XP n'a qu'une seule source de rôles : l'entrée de récompense. Les
          // deux champs pointent donc vers le même identifiant, et `enabled`
          // est vrai puisque le level-up n'advient que si xp_enabled l'est.
          config: { enabled: true, memberRoleId: roleId, botRoleId: roleId },
        });

        // Décision 11 — assign() capture déjà toute erreur Discord et la
        // convertit en DISCORD_ASSIGNMENT_FAILED sans lever.
        const outcome = await this.assignmentService.assign({
          eligibility,
          assignmentContext: { guildId: guild.id, memberId: member.id, roleId, member, role },
        });

        if (outcome && outcome.assigned) {
          result.granted.push(roleId);
          continue;
        }

        const code = (outcome && outcome.details && outcome.details.eligibilityCode)
          || (outcome && outcome.code)
          || "UNASSIGNED";

        if (outcome && outcome.severity === "ERROR") {
          result.failed.push({ roleId, code });
          this._warn("XP role reward assignment failed", {
            guildId: guild.id,
            memberId: member.id,
            roleId,
            code,
          });
        } else {
          result.skipped.push({ roleId, code });
        }
      } catch (error) {
        // Un rôle ne doit jamais empêcher l'attribution des suivants.
        result.failed.push({ roleId, code: "UNEXPECTED_ERROR" });
        this._warn("XP role reward raised unexpectedly", {
          guildId: guild.id,
          memberId: member.id,
          roleId,
          message: error && error.message,
        });
      }
    }

    return result;
  }

  /**
   * Capacité du bot, lue de façon défensive : `guild.members.me` est nul quand
   * la guilde n'est pas entièrement disponible, auquel cas canManageRoles vaut
   * false et la matrice renvoie MANAGE_ROLES_MISSING plutôt que de lever.
   */
  _botCapability(guild) {
    const me = (guild.members && guild.members.me) || null;
    const position = me && me.roles && me.roles.highest ? Number(me.roles.highest.position) : NaN;
    return {
      canManageRoles: Boolean(me && me.permissions && typeof me.permissions.has === "function"
        && me.permissions.has("ManageRoles")),
      highestRolePosition: Number.isFinite(position) ? position : 0,
    };
  }

  _memberInput(member) {
    const cache = member.roles && member.roles.cache;
    const roleIds = (cache && typeof cache.keys === "function") ? [...cache.keys()] : [];
    return {
      id: member.id,
      isBot: Boolean(member.user && member.user.bot),
      manageable: Boolean(member.manageable),
      roleIds,
    };
  }

  _warn(message, details) {
    try {
      this.logger?.warn?.(message, details);
    } catch {
      /* la journalisation ne doit jamais casser une attribution */
    }
  }
}

module.exports = {
  XPLevelRewardService,
  validateRoleRewards,
  parseRoleRewards,
  resolveRewardRoleIds,
  DISCORD_ID_PATTERN,
};
