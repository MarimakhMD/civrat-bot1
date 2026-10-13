"use strict";

// PHASE 1 — déduplication commande → événement.
//
// CONTRAT AVANT (bug) : chacune de ces cinq commandes émettait son propre log
// métier (`action: "supprimer"`, `targetId: null`, sans salon, sans auteur, sans
// traduction), en DOUBLE avec le log produit par l'événement Discord qu'elle
// déclenche. Le log commande arrivait sous le titre générique « Log » sans aucun
// champ : un embed vide et purement technique.
//
// CONTRAT APRÈS : la commande n'émet plus rien ; l'événement Discord — qui
// connaît le salon, la cible, les valeurs avant/après et l'auteur — est le seul
// chemin de log. `logsRuntimeFactory` reste accepté pour ne pas casser le
// contrat d'injection.
//
// La contrepartie (« l'événement produit bien exactement un log ») est couverte
// par test/phase1/deduplication.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const { InteractionRegistry, InteractionRouter, InteractionKind } = require("../../../core/interactions");
const { PermissionService } = require("../../../core/permissions");
const { registerChannelModeration } = require("../channelRegister");

const COMMAND_NAMES = ["supprimer", "slowmode", "verrouiller", "deverrouiller", "pseudo"];

for (const state of ["enabled", "disabled", "error"]) {
  for (const name of COMMAND_NAMES) {
    test(`${name} n'émet plus de log depuis la commande (logs ${state})`, async () => {
      let logs = 0;
      let replies = 0;

      const registry = new InteractionRegistry();
      const channel = {
        bulkDelete: async () => ({ size: 1 }),
        setRateLimitPerUser: async () => {},
        permissionOverwrites: { edit: async () => {} },
      };
      const guild = {
        id: "g",
        channels: { cache: new Map([["c", channel]]) },
        members: { fetch: async () => ({ manageable: true, setNickname: async () => {} }) },
      };

      registerChannelModeration({
        registry,
        logsRuntimeFactory: () => ({
          disabled: state === "disabled",
          handleModerationEvent: async () => {
            logs += 1;
            if (state === "error") throw new Error("log failure");
          },
        }),
      });

      const router = new InteractionRouter({
        registry,
        contextFactory: {
          create: async (envelope) => ({
            guildId: "g",
            userId: "a",
            member: { has: () => true },
            permissions: new PermissionService(),
            t: (key) => key,
            envelope,
            respondError: async () => envelope.transport.replyError(),
          }),
        },
      });

      await router.handle({
        kind: InteractionKind.COMMAND,
        name,
        discordMember: { id: "a", guild, user: {} },
        discordChannel: channel,
        options: {
          getInteger: (option) => (option === "count" ? 1 : 0),
          getUser: () => ({ id: "u" }),
          getString: () => "x",
        },
        transport: {
          reply: async () => { replies += 1; },
          replyError: async () => { replies += 1; },
        },
      });

      assert.equal(replies, 1, "la commande répond toujours exactement une fois");
      assert.equal(logs, 0, "aucun log métier ne doit partir de la commande : l'événement Discord en est la seule source");
    });
  }
}

test("PHASE1: les cinq commandes de salon délèguent leur log à un événement Discord", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync("src/modules/moderation/channelRegister.js", "utf8");
  assert.doesNotMatch(source, /handleModerationEvent/, "plus aucun appel de log dans channelRegister");
  // Chaque commande déclenche un effet Discord observable par un événement :
  assert.match(source, /bulkDelete/, "supprimer → messageDeleteBulk");
  assert.match(source, /setSlowmode/, "slowmode → channelUpdate");
  assert.match(source, /lock\(/, "verrouiller → channelUpdate (permissions)");
  assert.match(source, /unlock\(/, "deverrouiller → channelUpdate (permissions)");
  assert.match(source, /NicknameService/, "pseudo → guildMemberUpdate (via NicknameService.setNickname)");
});
