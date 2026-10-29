"use strict";

/**
 * P2-B — `overwriteDiff` : classe les surcharges de permissions réellement
 * modifiées entre deux états d'un salon (ajoutée / retirée / modifiée).
 *
 * C'est cette classification qui ordonne les types d'audit essayés par
 * `channelUpdate` (13 / 14 / 15) et alimente les cibles candidates de la
 * résolution d'acteur. Non-comparable → tableaux vides, rien n'est inventé.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { channelChanges, overwriteDiff } = require("../services/logDiffs");

function bitfield(names) {
  return { toArray: () => [...names] };
}

function makeChannel(overwrites) {
  return {
    id: "C1",
    name: "général",
    permissionOverwrites: { cache: overwrites instanceof Map ? overwrites : new Map() },
  };
}

const ow = (allow, deny) => ({ allow: bitfield(allow), deny: bitfield(deny) });

test("P2B overwriteDiff: ajout, retrait et modification sont classés séparément", () => {
  const before = makeChannel(new Map([
    ["KEEP", ow([], ["ViewChannel"])],
    ["MOD", ow([], ["SendMessages"])],
    ["GONE", ow(["SendMessages"], [])],
  ]));
  const after = makeChannel(new Map([
    ["KEEP", ow([], ["ViewChannel"])],
    ["MOD", ow(["SendMessages"], [])],
    ["NEW", ow(["EmbedLinks"], [])],
  ]));

  const diff = overwriteDiff(before, after);
  assert.deepEqual(diff.added, ["NEW"]);
  assert.deepEqual(diff.removed, ["GONE"]);
  assert.deepEqual(diff.modified, ["MOD"]);
  assert.ok(!diff.added.includes("KEEP") && !diff.modified.includes("KEEP"), "une surcharge inchangée n'est pas touchée");
});

test("P2B overwriteDiff: identique → aucun touched", () => {
  const channel = () => makeChannel(new Map([["R1", ow([], ["SendMessages"])]]));
  assert.deepEqual(overwriteDiff(channel(), channel()), { added: [], removed: [], modified: [] });
});

test("P2B overwriteDiff: modif allow OU deny compte comme modifiée", () => {
  const allowOnly = overwriteDiff(
    makeChannel(new Map([["R1", ow([], ["SendMessages"])]])),
    makeChannel(new Map([["R1", ow(["SendMessages"], [])]])),
  );
  assert.deepEqual(allowOnly.modified, ["R1"]);

  const denyOnly = overwriteDiff(
    makeChannel(new Map([["R1", ow(["ViewChannel"], ["SendMessages"])]])),
    makeChannel(new Map([["R1", ow(["ViewChannel"], ["MentionEveryone"])]])),
  );
  assert.deepEqual(denyOnly.modified, ["R1"]);
});

test("P2B overwriteDiff: cache illisible → tableaux vides (jamais deviné)", () => {
  const broken = { id: "C1", permissionOverwrites: { cache: { forEach: () => { throw new Error("boom"); } } } };
  assert.deepEqual(overwriteDiff(broken, makeChannel(new Map([["R1", ow([], [])]]))), { added: [], removed: [], modified: [] });
  assert.deepEqual(overwriteDiff(makeChannel(), { id: "C1" }), { added: [], removed: [], modified: [] });
  assert.deepEqual(overwriteDiff(null, makeChannel()), { added: [], removed: [], modified: [] });
});

test("P2B overwriteDiff: cohérence avec channelChanges — toute clé permissions produit des cibles touchées", () => {
  const before = makeChannel();
  const after = makeChannel(new Map([["R1", ow([], ["SendMessages"])]]));

  const changes = channelChanges(before, after);
  assert.ok(changes.some((c) => c.key === "permissions"), "prérequit : la clé permissions est bien produite");

  const diff = overwriteDiff(before, after);
  const touched = [...diff.added, ...diff.modified, ...diff.removed];
  assert.ok(touched.length > 0, "au moins une cible touchée pour la résolution d'acteur");
  assert.deepEqual(diff.added, ["R1"]);
});

test("P2B overwriteDiff: @everyone (id = guild) retiré → classé removed", () => {
  const before = makeChannel(new Map([["G1", ow([], ["SendMessages"])]]));
  const after = makeChannel();
  const diff = overwriteDiff(before, after);
  assert.deepEqual(diff.removed, ["G1"]);
});
