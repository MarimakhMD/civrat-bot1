"use strict";

// P-CAPT L3 — challenges Premium : génération serveur, unicité des réponses,
// variation, anti-répétition et non-exposition de la réponse correcte.
// Aléa INJECTÉ (LCG déterministe) : aucun test ne dépend du hasard réel.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  CaptchaChallengeType,
  CAPTCHA_CHALLENGE_OPTIONS,
  CAPTCHA_CHALLENGE_ORDER_STEPS,
  CAPTCHA_CHALLENGE_TYPE_LIST,
  CAPTCHA_CHALLENGE_MAX_GENERATION_ATTEMPTS,
  buildCaptchaChallengeCustomId,
  parseCaptchaChallengeCustomId,
  CaptchaComponentId: Id,
} = require("../configuration/captchaConstants");
const { CaptchaChallengeService, ChallengeStatus, CONDITION_KEYS } = require("../services/CaptchaChallengeService");
const { captchaChallengeView } = require("../interactions/captchaViews");
const { rows: toActionRows, MAX_ACTION_ROWS, MAX_BUTTONS_PER_ROW } = require("../../../adapters/discord/DiscordResponseTransport");

/** LCG déterministe — reproduit les mêmes challenges d'une exécution à l'autre. */
function seededRandomInt(seed = 1) {
  let state = seed >>> 0;
  return (min, max) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return min + (state % (max - min));
  };
}

function seededRandomBytes() {
  let counter = 0;
  return (size) => {
    counter += 1;
    const buffer = Buffer.alloc(size);
    buffer.writeUInt32BE(counter >>> 0, 0);
    return buffer;
  };
}

function service(options = {}) {
  return new CaptchaChallengeService({
    randomInt: seededRandomInt(7),
    randomBytes: seededRandomBytes(),
    ...options,
  });
}

const PREDICATES = Object.freeze({
  "captcha.conditionGreatest": (value, values) => value === Math.max(...values),
  "captcha.conditionSmallest": (value, values) => value === Math.min(...values),
  "captcha.conditionEven": (value) => value % 2 === 0,
  "captcha.conditionMultipleOfThree": (value) => value % 3 === 0,
  "captcha.conditionPerfectSquare": (value) => Number.isInteger(Math.sqrt(value)),
});

test("L3 — les trois types produisent un challenge exploitable (aucun autre type)", () => {
  const challenges = service();
  assert.deepEqual(CAPTCHA_CHALLENGE_TYPE_LIST, ["CHOICE", "ORDER", "PICK"]);
  const promptKeys = new Set();
  for (const type of CAPTCHA_CHALLENGE_TYPE_LIST) {
    const challenge = challenges.generate({ type, guildId: "g", memberId: `m-${type}` });
    promptKeys.add(challenge.promptKey);
    assert.match(challenge.id, /^[0-9a-f]{8}$/, "identifiant de routage court et opaque");
    assert.equal(challenge.type, type);
    assert.equal(challenge.options.length, CAPTCHA_CHALLENGE_OPTIONS);
    assert.equal(challenge.progress, 0);
    assert.ok(challenge.options.every((option, index) => option.value === index));
    assert.ok(challenge.options.every((option) => typeof option.label === "string" && option.label.length > 0));
    assert.ok(Object.isFrozen(challenge), "challenge immuable");
  }
  assert.equal(promptKeys.size, 3, "chaque type a son prompt");
  // Un type inconnu retombe sur CHOICE — jamais une quatrième variante.
  assert.equal(challenges.generate({ type: "FOURTH", guildId: "g", memberId: "x" }).type, CaptchaChallengeType.CHOICE);
});

test("L3 — CHOICE : la bonne réponse est unique et correspond à l'expression affichée", () => {
  const challenges = service();
  for (let index = 0; index < 25; index += 1) {
    const challenge = challenges.generate({ type: CaptchaChallengeType.CHOICE, guildId: "g", memberId: "choice" });
    const [left, operator, right] = challenge.promptVars.expression.split(" ");
    const a = Number(left);
    const b = Number(right);
    const expected = operator === "+" ? a + b : operator === "−" ? a - b : a * b;
    const labels = challenge.options.map((option) => Number(option.label));
    assert.equal(labels[challenge.answerIndex], expected, "l'index serveur désigne bien le résultat");
    assert.equal(labels.filter((value) => value === expected).length, 1, "réponse correcte unique");
    assert.equal(new Set(labels).size, labels.length, "aucun doublon d'option");
  }
});

test("L3 — ORDER : la séquence attendue est l'ordre croissant des options affichées", () => {
  const challenges = service();
  for (let index = 0; index < 25; index += 1) {
    const challenge = challenges.generate({ type: CaptchaChallengeType.ORDER, guildId: "g", memberId: "order" });
    assert.equal(challenge.answerOrder.length, CAPTCHA_CHALLENGE_ORDER_STEPS);
    assert.equal(challenge.stepCount, CAPTCHA_CHALLENGE_ORDER_STEPS);
    assert.equal(new Set(challenge.answerOrder).size, challenge.answerOrder.length, "permutation sans répétition");
    assert.ok(challenge.answerOrder.every((value) => value >= 0 && value < challenge.options.length));
    const ordered = challenge.answerOrder.map((value) => Number(challenge.options[value].label));
    const ascending = [...ordered].sort((left, right) => left - right);
    assert.deepEqual(ordered, ascending, "l'ordre attendu est bien croissant");
    assert.equal(challenge.answerIndex, null, "ORDER n'a pas d'index unique");
  }
});

test("L3 — PICK : la consigne désigne exactement une option (vérifié après génération)", () => {
  const challenges = service();
  const conditions = new Set();
  for (let index = 0; index < 40; index += 1) {
    const challenge = challenges.generate({ type: CaptchaChallengeType.PICK, guildId: "g", memberId: "pick" });
    const conditionKey = challenge.promptVars.condition;
    conditions.add(conditionKey);
    const predicate = PREDICATES[conditionKey];
    assert.ok(predicate, `consigne connue (${conditionKey})`);
    const values = challenge.options.map((option) => Number(option.label));
    const matches = challenge.options
      .map((option, position) => (predicate(Number(option.label), values) ? position : -1))
      .filter((position) => position >= 0);
    assert.equal(matches.length, 1, `${conditionKey}: une seule option satisfait la consigne`);
    assert.equal(matches[0], challenge.answerIndex, "l'index serveur est bien celui de l'unique réponse");
  }
  assert.ok(conditions.size >= 2, "les consignes varient d'un challenge à l'autre");
  assert.deepEqual([...CONDITION_KEYS].sort(), Object.keys(PREDICATES).sort(), "toutes les consignes sont couvertes");
});

test("L3 — aucune réponse correcte n'est exposée par la vue du challenge", () => {
  const challenges = service();
  const t = (key, vars) => (vars ? `${key}(${Object.values(vars).join(",")})` : key);
  for (const type of CAPTCHA_CHALLENGE_TYPE_LIST) {
    const challenge = challenges.generate({ type, guildId: "g", memberId: `view-${type}` });
    const view = captchaChallengeView({ t, challenge });
    const serialized = JSON.stringify(view);
    for (const secret of ["answerIndex", "answerOrder", "signature", "issuedAt", "fresh"]) {
      assert.ok(!serialized.includes(secret), `${type}: la vue n'expose jamais « ${secret} »`);
    }
    assert.equal(view.components.length, CAPTCHA_CHALLENGE_OPTIONS);
    for (const [position, component] of view.components.entries()) {
      const parsed = parseCaptchaChallengeCustomId(component.customId);
      assert.deepEqual(parsed, { type, challengeId: challenge.id, value: position },
        "le customId ne porte que le type, l'identifiant de session/challenge et l'index cliqué");
      assert.equal(component.label, challenge.options[position].label);
    }
    // Limites Discord : une seule ligne de 4 boutons.
    const actionRows = toActionRows(view.components);
    assert.equal(actionRows.length, 1);
    assert.ok(actionRows[0].components.length <= MAX_BUTTONS_PER_ROW);
    assert.ok(actionRows.length <= MAX_ACTION_ROWS);
  }
});

test("L3 — validation : succès, échec, invalide et progression ORDER", () => {
  const challenges = service();

  const choice = challenges.generate({ type: CaptchaChallengeType.CHOICE, guildId: "g", memberId: "v-choice" });
  assert.deepEqual(challenges.validate({ challenge: choice, value: choice.answerIndex }), { status: ChallengeStatus.SUCCESS });
  const wrong = choice.options.findIndex((_option, position) => position !== choice.answerIndex);
  assert.deepEqual(challenges.validate({ challenge: choice, value: wrong }), { status: ChallengeStatus.FAILURE });
  assert.deepEqual(challenges.validate({ challenge: choice, value: 99 }), { status: ChallengeStatus.INVALID });
  assert.deepEqual(challenges.validate({ challenge: choice, value: -1 }), { status: ChallengeStatus.INVALID });
  assert.deepEqual(challenges.validate({ challenge: choice, value: 1.5 }), { status: ChallengeStatus.INVALID });
  assert.deepEqual(challenges.validate({ challenge: null, value: 0 }), { status: ChallengeStatus.INVALID });

  const order = challenges.generate({ type: CaptchaChallengeType.ORDER, guildId: "g", memberId: "v-order" });
  let current = order;
  for (const [step, expected] of order.answerOrder.entries()) {
    const outcome = challenges.validate({ challenge: current, value: expected });
    if (step === order.answerOrder.length - 1) {
      assert.equal(outcome.status, ChallengeStatus.SUCCESS, "dernière étape = succès");
    } else {
      assert.equal(outcome.status, ChallengeStatus.PROGRESS);
      assert.equal(outcome.challenge.progress, step + 1);
      assert.equal(current.progress, step, "le challenge d'origine n'est jamais muté");
      current = outcome.challenge;
    }
  }
  // Une étape déjà validée rejouée sur l'objet d'origine = échec (pas de rejeu).
  assert.deepEqual(challenges.validate({ challenge: order, value: order.answerOrder.at(-1) }), { status: ChallengeStatus.FAILURE });
});

test("L3 — anti-répétition immédiate + variation, sans boucle infinie", () => {
  const challenges = service();
  const signatures = [];
  for (let index = 0; index < 20; index += 1) {
    const challenge = challenges.generate({ type: CaptchaChallengeType.PICK, guildId: "g", memberId: "repeat" });
    signatures.push(challenge.signature);
  }
  for (let index = 1; index < signatures.length; index += 1) {
    assert.notEqual(signatures[index], signatures[index - 1], "jamais deux fois le même challenge d'affilée");
  }
  assert.ok(new Set(signatures).size >= 15, "variation réelle sur 20 tirages");

  // Aléa dégénéré (constante) : la génération est BORNÉE et signale le repli.
  let calls = 0;
  const degenerate = new CaptchaChallengeService({
    randomInt: (min) => { calls += 1; return min; },
    randomBytes: seededRandomBytes(),
  });
  const first = degenerate.generate({ type: CaptchaChallengeType.CHOICE, guildId: "g", memberId: "stuck" });
  const callsAfterFirst = calls;
  const second = degenerate.generate({ type: CaptchaChallengeType.CHOICE, guildId: "g", memberId: "stuck" });
  assert.equal(first.fresh, true);
  assert.equal(second.fresh, false, "aucune variation possible ⇒ repli explicite, jamais une boucle");
  // La génération s'arrête au plafond de tentatives (constante publique) :
  // aucun tirage illimité, quelle que soit la qualité de l'aléa.
  assert.ok(
    calls - callsAfterFirst <= CAPTCHA_CHALLENGE_MAX_GENERATION_ATTEMPTS * 400,
    `tirages bornés par le plafond de tentatives (${calls - callsAfterFirst} tirages)`,
  );
});

test("L3 — historique borné et isolé par membre", () => {
  const challenges = service({ historySize: 3 });
  for (let index = 0; index < 10; index += 1) {
    challenges.generate({ type: CaptchaChallengeType.CHOICE, guildId: "g", memberId: "bounded" });
  }
  assert.equal(challenges.history.get("g:bounded").length, 3, "mémoire bornée par membre");

  const other = challenges.generate({ type: CaptchaChallengeType.CHOICE, guildId: "g", memberId: "other" });
  assert.equal(other.fresh, true, "l'historique d'un membre ne contient pas celui d'un autre serveur/membre");
  assert.equal(challenges.history.get("g:other").length, 1);
});

test("L3 — routage : seul le préfixe VERIFY porte une charge de challenge", () => {
  assert.equal(parseCaptchaChallengeCustomId(Id.VERIFY), null, "l'ID simple démarre une session (jamais une réponse)");
  assert.deepEqual(
    parseCaptchaChallengeCustomId(buildCaptchaChallengeCustomId({ type: "CHOICE", challengeId: "deadbeef", value: 2 })),
    { type: "CHOICE", challengeId: "deadbeef", value: 2 },
  );
  const malformed = [
    `${Id.VERIFY}:FOURTH:deadbeef:0`,
    `${Id.VERIFY}:CHOICE:DEADBEEF:0`,
    `${Id.VERIFY}:CHOICE:deadbeef`,
    `${Id.VERIFY}:CHOICE:deadbeef:0:extra`,
    `${Id.VERIFY}:CHOICE:deadbeef:x`,
    "civrat:v1:other:verify:CHOICE:deadbeef:0",
    "",
    null,
    undefined,
  ];
  for (const value of malformed) {
    assert.equal(parseCaptchaChallengeCustomId(value), null, `charge refusée : ${String(value)}`);
  }
});

test("L3 — aléa cryptographique par défaut (crypto.randomInt / crypto.randomBytes)", () => {
  const real = new CaptchaChallengeService();
  assert.equal(real.randomInt, crypto.randomInt, "crypto.randomInt est l'aléa par défaut");
  assert.equal(real.randomBytes, crypto.randomBytes);
  const one = real.generate({ type: CaptchaChallengeType.CHOICE, guildId: "g", memberId: "crypto" });
  const two = real.generate({ type: CaptchaChallengeType.CHOICE, guildId: "g", memberId: "crypto" });
  assert.notEqual(one.id, two.id, "identifiants distincts (32 bits d'aléa)");
  assert.match(one.id, /^[0-9a-f]{8}$/);
});
