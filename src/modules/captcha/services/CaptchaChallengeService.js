"use strict";

/**
 * P-CAPT L3 — challenges Premium (serveur uniquement).
 *
 * Règles non négociables :
 *  • génération ET vérification 100 % côté serveur : `answerIndex`/`answerOrder`
 *    ne quittent jamais ce module — le customId ne porte qu'un index cliqué ;
 *  • aléa cryptographique (`crypto.randomInt`, `crypto.randomBytes`) ;
 *  • trois types EXACTEMENT (plan validé) : CHOICE, ORDER, PICK ;
 *  • variation + anti-répétition immédiate par membre (historique borné) ;
 *  • validation SYNCHRONE : aucun await entre la lecture et la transition,
 *    donc deux réponses concurrentes ne peuvent pas créditer deux succès ;
 *  • aucune session parallèle : l'objet challenge vit dans la session L1.
 */

const crypto = require("node:crypto");
const {
  CaptchaChallengeType,
  CAPTCHA_CHALLENGE_OPTIONS,
  CAPTCHA_CHALLENGE_ORDER_STEPS,
  CAPTCHA_CHALLENGE_HISTORY,
  CAPTCHA_CHALLENGE_ID_BYTES,
  CAPTCHA_CHALLENGE_MAX_GENERATION_ATTEMPTS,
} = require("../configuration/captchaConstants");

const ChallengeStatus = Object.freeze({
  SUCCESS: "SUCCESS",
  PROGRESS: "PROGRESS",
  FAILURE: "FAILURE",
  INVALID: "INVALID",
});

/** Consignes du type PICK (clés i18n, jamais de réponse correcte). */
const CONDITION_KEYS = Object.freeze([
  "captcha.conditionGreatest",
  "captcha.conditionSmallest",
  "captcha.conditionEven",
  "captcha.conditionMultipleOfThree",
  "captcha.conditionPerfectSquare",
]);

class CaptchaChallengeService {
  /**
   * @param {{ randomInt?: (min: number, max: number) => number,
   *           randomBytes?: (size: number) => Buffer,
   *           clock?: () => number,
   *           historySize?: number,
   *           maxKeys?: number }} [options]
   */
  constructor({
    randomInt = crypto.randomInt,
    randomBytes = crypto.randomBytes,
    clock = Date.now,
    historySize = CAPTCHA_CHALLENGE_HISTORY,
    maxKeys = 20000,
  } = {}) {
    if (typeof randomInt !== "function") throw new TypeError("CaptchaChallengeService requires an injectable randomInt");
    if (typeof randomBytes !== "function") throw new TypeError("CaptchaChallengeService requires an injectable randomBytes");
    this.randomInt = randomInt;
    this.randomBytes = randomBytes;
    this.clock = clock;
    this.historySize = Number.isInteger(historySize) && historySize > 0 ? historySize : CAPTCHA_CHALLENGE_HISTORY;
    this.maxKeys = Number.isInteger(maxKeys) && maxKeys > 0 ? maxKeys : 20000;
    /** @type {Map<string, string[]>} anti-répétition immédiate par membre. */
    this.history = new Map();
  }

  /** Tirage entier dans [min, max) via l'aléa injecté. */
  _int(min, max) {
    return this.randomInt(min, max);
  }

  _pick(list) {
    return list[this._int(0, list.length)];
  }

  _shuffle(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this._int(0, i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  _newId() {
    return this.randomBytes(CAPTCHA_CHALLENGE_ID_BYTES).toString("hex");
  }

  _historyFor(guildId, memberId) {
    const key = `${guildId}:${memberId}`;
    if (!this.history.has(key)) {
      if (this.history.size >= this.maxKeys) {
        const oldest = this.history.keys().next().value;
        if (oldest !== undefined) this.history.delete(oldest);
      }
      this.history.set(key, []);
    }
    return this.history.get(key);
  }

  _remember(guildId, memberId, signature) {
    const history = this._historyFor(guildId, memberId);
    history.push(signature);
    while (history.length > this.historySize) history.shift();
    return history;
  }

  /* ───────────────────────── générateurs ───────────────────────── */

  /** CHOICE — « choix parmi plusieurs réponses » (calcul, options proches). */
  _buildChoice() {
    const operator = this._pick(["+", "−", "×"]);
    let a = this._int(11, 49);
    let b = this._int(3, 29);
    let result;
    if (operator === "+") result = a + b;
    else if (operator === "−") {
      if (b > a) [a, b] = [b, a];
      result = a - b;
    } else {
      a = this._int(3, 13);
      b = this._int(3, 10);
      result = a * b;
    }
    const values = new Set([result]);
    let guard = 0;
    while (values.size < CAPTCHA_CHALLENGE_OPTIONS && guard < 64) {
      guard += 1;
      const delta = this._int(1, 7) * (this._int(0, 2) === 0 ? -1 : 1);
      const candidate = result + delta;
      if (candidate > 0) values.add(candidate);
    }
    // Filet de sécurité (ne peut pas arriver avec les bornes ci-dessus).
    let filler = result + CAPTCHA_CHALLENGE_OPTIONS + 1;
    while (values.size < CAPTCHA_CHALLENGE_OPTIONS) values.add(filler++);
    const displayed = this._shuffle([...values]);
    return {
      promptKey: "captcha.challengePromptChoice",
      promptVars: Object.freeze({ expression: `${a} ${operator} ${b}` }),
      labels: displayed.map(String),
      answerIndex: displayed.indexOf(result),
      signature: `choice:${a}${operator}${b}=${result}`,
    };
  }

  /** ORDER — « sélection d'un ordre correct » (croissant, validé pas à pas). */
  _buildOrder() {
    const values = new Set();
    let guard = 0;
    while (values.size < CAPTCHA_CHALLENGE_ORDER_STEPS && guard < 128) {
      guard += 1;
      values.add(this._int(1, 99));
    }
    let filler = 100;
    while (values.size < CAPTCHA_CHALLENGE_ORDER_STEPS) values.add(filler++);
    const displayed = this._shuffle([...values]);
    const ascending = [...values].sort((left, right) => left - right);
    return {
      promptKey: "captcha.challengePromptOrder",
      promptVars: Object.freeze({}),
      labels: displayed.map(String),
      answerOrder: ascending.map((value) => displayed.indexOf(value)),
      stepCount: CAPTCHA_CHALLENGE_ORDER_STEPS,
      signature: `order:${displayed.join(",")}`,
    };
  }

  /** PICK — « sélection dynamique » : la consigne ET le jeu sont générés. */
  _buildPick() {
    const values = new Set();
    let guard = 0;
    while (values.size < CAPTCHA_CHALLENGE_OPTIONS && guard < 128) {
      guard += 1;
      values.add(this._int(1, 99));
    }
    let filler = 100;
    while (values.size < CAPTCHA_CHALLENGE_OPTIONS) values.add(filler++);
    const pool = [...values];

    const builders = [
      // le plus grand / le plus petit : unicité garantie par des valeurs distinctes
      () => {
        const displayed = this._shuffle(pool);
        const target = Math.max(...displayed);
        return { conditionKey: CONDITION_KEYS[0], displayed, answerIndex: displayed.indexOf(target) };
      },
      () => {
        const displayed = this._shuffle(pool);
        const target = Math.min(...displayed);
        return { conditionKey: CONDITION_KEYS[1], displayed, answerIndex: displayed.indexOf(target) };
      },
      // pair unique parmi des impairs
      () => {
        const odd = new Set();
        let oddGuard = 0;
        while (odd.size < CAPTCHA_CHALLENGE_OPTIONS - 1 && oddGuard < 128) {
          oddGuard += 1;
          const candidate = this._int(1, 50) * 2 + 1;
          odd.add(candidate);
        }
        const even = this._int(1, 50) * 2;
        const displayed = this._shuffle([...odd, even]);
        return { conditionKey: CONDITION_KEYS[2], displayed, answerIndex: displayed.indexOf(even) };
      },
      // multiple de 3 unique
      () => {
        const others = new Set();
        let otherGuard = 0;
        while (others.size < CAPTCHA_CHALLENGE_OPTIONS - 1 && otherGuard < 256) {
          otherGuard += 1;
          const candidate = this._int(1, 99);
          if (candidate % 3 !== 0) others.add(candidate);
        }
        let multiple = this._int(1, 33) * 3;
        while (others.has(multiple)) multiple += 3;
        const displayed = this._shuffle([...others, multiple]);
        return { conditionKey: CONDITION_KEYS[3], displayed, answerIndex: displayed.indexOf(multiple) };
      },
      // carré parfait unique
      () => {
        const others = new Set();
        const squares = new Set([1, 4, 9, 16, 25, 36, 49, 64, 81]);
        let otherGuard = 0;
        while (others.size < CAPTCHA_CHALLENGE_OPTIONS - 1 && otherGuard < 256) {
          otherGuard += 1;
          const candidate = this._int(2, 99);
          if (!squares.has(candidate)) others.add(candidate);
        }
        const square = this._pick([...squares]);
        const displayed = this._shuffle([...others, square]);
        return { conditionKey: CONDITION_KEYS[4], displayed, answerIndex: displayed.indexOf(square) };
      },
    ];

    const built = this._pick(builders)();
    return {
      promptKey: "captcha.challengePromptPick",
      promptVars: Object.freeze({ condition: built.conditionKey }),
      labels: built.displayed.map(String),
      answerIndex: built.answerIndex,
      signature: `pick:${built.conditionKey}:${built.displayed.join(",")}`,
    };
  }

  _build(type) {
    if (type === CaptchaChallengeType.ORDER) return this._buildOrder();
    if (type === CaptchaChallengeType.PICK) return this._buildPick();
    return this._buildChoice();
  }

  /**
   * Génère un challenge pour un membre : variation garantie, et jamais deux
   * fois le même contenu d'affilée quand l'aléa le permet (tentatives bornées).
   */
  generate({ type, guildId, memberId }) {
    const challengeType = Object.values(CaptchaChallengeType).includes(type)
      ? type
      : CaptchaChallengeType.CHOICE;
    const history = this._historyFor(guildId, memberId);
    let built = null;
    let fresh = false;
    for (let attempt = 0; attempt < CAPTCHA_CHALLENGE_MAX_GENERATION_ATTEMPTS; attempt += 1) {
      built = this._build(challengeType);
      if (!history.includes(built.signature)) {
        fresh = true;
        break;
      }
    }
    this._remember(guildId, memberId, built.signature);

    const challenge = Object.freeze({
      id: this._newId(),
      type: challengeType,
      promptKey: built.promptKey,
      promptVars: built.promptVars,
      options: Object.freeze(built.labels.map((label, index) => Object.freeze({ value: index, label }))),
      // Champs serveur : jamais transmis au client.
      answerIndex: built.answerIndex ?? null,
      answerOrder: built.answerOrder ? Object.freeze([...built.answerOrder]) : null,
      stepCount: built.stepCount || 1,
      progress: 0,
      issuedAt: this.clock(),
      signature: built.signature,
      fresh,
    });
    return challenge;
  }

  /**
   * Valide une réponse. SYNCHRONE (aucun await) : l'appelant peut enchaîner
   * lecture → validation → transition sans fenêtre de concurrence.
   * @returns {{status: string, challenge?: object}}
   */
  validate({ challenge, value }) {
    if (!challenge || !Number.isInteger(value) || value < 0 || value >= challenge.options.length) {
      return { status: ChallengeStatus.INVALID };
    }
    if (challenge.type === CaptchaChallengeType.ORDER) {
      const expected = challenge.answerOrder?.[challenge.progress];
      if (value !== expected) return { status: ChallengeStatus.FAILURE };
      const progress = challenge.progress + 1;
      if (progress >= challenge.stepCount) return { status: ChallengeStatus.SUCCESS };
      return { status: ChallengeStatus.PROGRESS, challenge: Object.freeze({ ...challenge, progress }) };
    }
    if (value === challenge.answerIndex) return { status: ChallengeStatus.SUCCESS };
    return { status: ChallengeStatus.FAILURE };
  }
}

module.exports = { CaptchaChallengeService, ChallengeStatus, CONDITION_KEYS };
