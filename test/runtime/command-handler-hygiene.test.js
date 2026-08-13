"use strict";

// P17 — hygiène du chargeur de commandes après nettoyage ciblé :
//  • le chargement reste strictement identique (2 fichiers legacy actifs +
//    20 commandes modulaires = 22, aucune duplique) ;
//  • la garde anti-doublon warn/mute/unmute protège toujours le chargement
//    modulaire (« Duplicate module command » non déclenchée) ;
//  • les exports morts prouvés (registerCommands, getCommands) sont retirés ;
//    l'enregistrement REST vit uniquement dans deploy.js.
// Hors ligne : commandes chargées sans aucun appel réseau.

const test = require("node:test");
const assert = require("node:assert/strict");
const commandHandler = require("../../src/handlers/commandHandler");

// P20 : +recovery + ownerpanel => 2 fichiers legacy actifs +
// 22 commandes modulaires = 24.
const EXPECTED_COMMANDS = [
  "analytics", "analytics_invites", "analytics_xp", "automod", "bannir",
  "captcha", "debannir", "deverrouiller", "expulser", "giveaway", "invites",
  "mute", "ownerpanel", "pseudo", "recovery", "settings", "slowmode", "suggest",
  "supprimer", "ticketpanel", "unmute", "uploadsticker", "verrouiller", "warn",
];

test("loadCommands loads exactly the V1 command set, each name once", () => {
  const loaded = commandHandler.loadCommands();
  const names = [...loaded.keys()].sort();
  assert.deepEqual(names, EXPECTED_COMMANDS);
  assert.equal(loaded.size, names.length, "no duplicate registration");
});

test("migrated moderation commands resolve to their modular implementation", () => {
  const loaded = commandHandler.loadCommands();
  for (const name of ["warn", "mute", "unmute"]) {
    const command = loaded.get(name);
    assert.ok(command?.data && command.execute, `/${name} must be loaded`);
    // Charge utile modulaire : la description vient des dictionnaires
    // (registerModeration), pas du fichier legacy exclu.
    const json = command.data.toJSON();
    assert.ok(json.description.length > 0);
  }
});

test("dead exports are removed; REST deployment lives only in deploy.js", () => {
  assert.equal(commandHandler.registerCommands, undefined);
  assert.equal(commandHandler.getCommands, undefined);
  assert.equal(typeof commandHandler.loadCommands, "function");
  assert.equal(typeof commandHandler.handleCommand, "function");
  const source = require("node:fs").readFileSync("src/handlers/commandHandler.js", "utf8");
  assert.ok(!source.includes("require(\"discord.js\")"), "no leftover REST/Routes import in the handler");
});
