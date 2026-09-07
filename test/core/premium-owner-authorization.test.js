"use strict";

// ───────────────────────────────────────────────────────────────
// G2-D — PremiumMutationPolicy.configureOwnerAuthorization.
//
// Le point de composition doit rester strict :
//   1. une valeur non-fonction est refusée (TypeError) ;
//   2. une fonction valide est acceptée et renvoyée pour chaînage ;
//   3. un second appel (reconfiguration) est refusé : la source de vérité de
//      l'autorisation Owner ne peut pas être remplacée après composition.
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");

const { PremiumMutationPolicy } = require("../../src/core/entitlements");

test("G2-D: configureOwnerAuthorization refuse une valeur non-fonction", () => {
  const policy = new PremiumMutationPolicy();
  for (const bad of [null, undefined, 42, "yes", {}, [], true]) {
    assert.throws(
      () => policy.configureOwnerAuthorization(bad),
      TypeError,
      `la valeur ${JSON.stringify(bad)} doit être refusée`,
    );
  }
});

test("G2-D: configureOwnerAuthorization accepte une fonction et renvoie la politique (chaînage)", () => {
  const policy = new PremiumMutationPolicy();
  const ownerAuthorization = async () => true;
  const returned = policy.configureOwnerAuthorization(ownerAuthorization);
  assert.equal(returned, policy, "retourne la même instance pour le chaînage");
});

test("G2-D: un second appel configureOwnerAuthorization est refusé", () => {
  const policy = new PremiumMutationPolicy();
  policy.configureOwnerAuthorization(async () => true);
  assert.throws(
    () => policy.configureOwnerAuthorization(async () => true),
    /already configured/,
  );
});

test("G2-D: reconfigurer avec la MÊME fonction est idempotent (aucun remplacement, pas d'erreur)", () => {
  const policy = new PremiumMutationPolicy();
  const ownerAuthorization = async () => true;
  policy.configureOwnerAuthorization(ownerAuthorization);
  // La même fonction est acceptée sans erreur : aucune source de vérité
  // différente n'est introduite.
  assert.doesNotThrow(() => policy.configureOwnerAuthorization(ownerAuthorization));
  // En revanche, toute fonction DIFFÉRENTE reste refusée.
  assert.throws(
    () => policy.configureOwnerAuthorization(async () => false),
    /already configured/,
  );
});
