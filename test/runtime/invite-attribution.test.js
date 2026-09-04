"use strict";

// Phase 1 (C3) — Attribution réelle des invitations.
//
// Ce test exerce le VRAI chemin de production :
//   src/events/guildMemberAdd.js → handleInviteTracking()
//     → src/services/inviteService.js (singleton, InMemoryInviteStatsRepository)
//       → InviteService.findUsedInvite() / attributeInvite()
//         (B2 : une seule écriture — le lien invité → inviteur porte aussi le
//          compteur, qui est dérivé par COUNT(*) et non stocké)
//
// Avant le correctif, `handleInviteTracking` lisait `result.inviter.id` alors
// que `findUsedInvite()` retourne `inviter` comme IDENTIFIANT (chaîne). La
// valeur passée à addInvite/setInvitedBy était donc `undefined` : le compteur
// partait sur la clé "<guildId>:undefined" et le lien invité→inviteur restait
// vide. /invites affichait 0 pour tout le monde. Aucun test ne couvrait ce
// chemin ; celui-ci est rouge avant le correctif et vert après.

const test = require("node:test");
const assert = require("node:assert/strict");

const inviteService = require("../../src/services/inviteService");
const statsRepository = inviteService.statsRepository;
const guildMemberAdd = require("../../src/events/guildMemberAdd");

const GUILD_ID = "guild-1";
const INVITER_ID = "user-inviter";

/**
 * Membre Discord minimal. `invites` est l'état des invitations du serveur AU
 * MOMENT du join (une Map, comme discord.js Collection).
 */
function makeMember({ guildId = GUILD_ID, memberId = "user-new", bot = false, invites = new Map() } = {}) {
  return {
    id: memberId,
    user: { id: memberId, bot, tag: `${memberId}#0001` },
    guild: {
      id: guildId,
      invites: { fetch: async () => invites },
    },
  };
}

/** État des invitations tel que mémorisé avant le join (cache du service). */
function primeCache(guildId, invites) {
  inviteService.cacheGuildInvites(guildId, invites);
}

function resetState() {
  inviteService.clear();
  statsRepository.clear();
}

test.beforeEach(resetState);

test("guildMemberAdd expose le contrat attendu par loadEvents + la couture de test", () => {
  assert.equal(guildMemberAdd.name, "guildMemberAdd");
  assert.equal(guildMemberAdd.once, false);
  assert.equal(typeof guildMemberAdd.execute, "function");
  assert.equal(typeof guildMemberAdd.handleInviteTracking, "function");
});

test("une invitation consommée incrémente le VRAI inviteur et lie le membre", async () => {
  // Avant le join : l'invitation ABC a été utilisée 1 fois.
  primeCache(GUILD_ID, new Map([["ABC", { code: "ABC", uses: 1, inviter: { id: INVITER_ID } }]]));

  // Au join : la même invitation est à 2 utilisations.
  const member = makeMember({
    invites: new Map([["ABC", { code: "ABC", uses: 2, inviter: { id: INVITER_ID } }]]),
  });

  const result = await guildMemberAdd.handleInviteTracking(member, {});

  assert.deepEqual(result, { code: "ABC", inviter: INVITER_ID, uses: 2 });

  // Le compteur de l'inviteur réel doit être à 1.
  const inviterStats = await inviteService.getInviteStats(INVITER_ID, GUILD_ID);
  assert.equal(inviterStats.current, 1, "l'inviteur réel doit être crédité");

  // Le membre doit être lié à son inviteur (utilisé par le décrément au départ).
  const memberStats = await inviteService.getInviteStats(member.id, GUILD_ID);
  assert.equal(memberStats.invitedBy, INVITER_ID, "le lien invité → inviteur doit être posé");
});

test("aucune clé 'undefined' n'est écrite dans le dépôt de statistiques", async () => {
  primeCache(GUILD_ID, new Map([["ABC", { code: "ABC", uses: 0, inviter: { id: INVITER_ID } }]]));
  await guildMemberAdd.handleInviteTracking(makeMember({
    invites: new Map([["ABC", { code: "ABC", uses: 1, inviter: { id: INVITER_ID } }]]),
  }), {});

  // C'est la trace exacte de l'ancien bug : `_key(guildId, undefined)`.
  assert.equal(statsRepository.invites.has(`${GUILD_ID}:undefined`), false,
    "aucun compteur ne doit être crédité à l'utilisateur 'undefined'");
  assert.deepEqual([...statsRepository.invites.keys()], [`${GUILD_ID}:${INVITER_ID}`]);
});

test("plusieurs joins via la même invitation s'accumulent sur l'inviteur", async () => {
  primeCache(GUILD_ID, new Map([["ABC", { code: "ABC", uses: 5, inviter: { id: INVITER_ID } }]]));

  for (const [index, uses] of [[0, 6], [1, 7], [2, 8]]) {
    await guildMemberAdd.handleInviteTracking(makeMember({
      memberId: `user-new-${index}`,
      invites: new Map([["ABC", { code: "ABC", uses, inviter: { id: INVITER_ID } }]]),
    }), {});
    // Le cache suit Discord : l'invitation consommée devient la référence.
    primeCache(GUILD_ID, new Map([["ABC", { code: "ABC", uses, inviter: { id: INVITER_ID } }]]));
  }

  const stats = await inviteService.getInviteStats(INVITER_ID, GUILD_ID);
  assert.equal(stats.current, 3);
  const leaderboard = await statsRepository.getLeaderboard(GUILD_ID, 10);
  assert.deepEqual(leaderboard, [{ userId: INVITER_ID, current: 3 }]);
});

test("un bot n'est jamais attribué et n'écrit aucune statistique", async () => {
  primeCache(GUILD_ID, new Map([["ABC", { code: "ABC", uses: 1, inviter: { id: INVITER_ID } }]]));

  const result = await guildMemberAdd.handleInviteTracking(makeMember({
    bot: true,
    invites: new Map([["ABC", { code: "ABC", uses: 2, inviter: { id: INVITER_ID } }]]),
  }), {});

  assert.equal(result, null);
  assert.equal(statsRepository.invites.size, 0);
  assert.equal(statsRepository.invitedBy.size, 0);
});

test("le premier join après un redémarrage n'invente pas d'attribution", async () => {
  // Cache vide : impossible de savoir quelle invitation a été consommée.
  assert.equal(inviteService.hasCachedGuild(GUILD_ID), false);

  const result = await guildMemberAdd.handleInviteTracking(makeMember({
    invites: new Map([["ABC", { code: "ABC", uses: 42, inviter: { id: INVITER_ID } }]]),
  }), {});

  assert.equal(result, null, "aucune attribution ne doit être fabriquée");
  assert.equal(inviteService.hasCachedGuild(GUILD_ID), true, "le cache doit être amorcé pour les joins suivants");
  assert.equal(statsRepository.invites.size, 0, "rien ne doit être écrit");
});

test("un join sans invitation consommée n'écrit rien", async () => {
  primeCache(GUILD_ID, new Map([["ABC", { code: "ABC", uses: 3, inviter: { id: INVITER_ID } }]]));

  const result = await guildMemberAdd.handleInviteTracking(makeMember({
    invites: new Map([["ABC", { code: "ABC", uses: 3, inviter: { id: INVITER_ID } }]]),
  }), {});

  assert.equal(result, null);
  assert.equal(statsRepository.invites.size, 0);
});

test("une invitation sans inviteur connu n'écrit pas de compteur fantôme", async () => {
  primeCache(GUILD_ID, new Map([["NOOWNER", { code: "NOOWNER", uses: 0, inviter: null }]]));

  const result = await guildMemberAdd.handleInviteTracking(makeMember({
    invites: new Map([["NOOWNER", { code: "NOOWNER", uses: 1, inviter: null }]]),
  }), {});

  assert.deepEqual(result, { code: "NOOWNER", inviter: null, uses: 1 });
  assert.equal(statsRepository.invites.size, 0, "pas d'inviteur = pas de compteur");
  assert.equal(statsRepository.invitedBy.size, 0);
});

test("un échec de récupération des invitations ne casse pas le join", async () => {
  primeCache(GUILD_ID, new Map([["ABC", { code: "ABC", uses: 1, inviter: { id: INVITER_ID } }]]));

  const member = makeMember();
  member.guild.invites.fetch = async () => { throw new Error("Missing Access"); };

  const result = await guildMemberAdd.handleInviteTracking(member, {});

  assert.equal(result, null, "l'échec doit être absorbé, pas propagé à l'événement");
  assert.equal(statsRepository.invites.size, 0);
});

test("les compteurs restent séparés par guilde", async () => {
  const invitesOf = (uses) => new Map([["ABC", { code: "ABC", uses, inviter: { id: INVITER_ID } }]]);

  primeCache("guild-1", invitesOf(0));
  primeCache("guild-2", invitesOf(0));

  await guildMemberAdd.handleInviteTracking(makeMember({
    guildId: "guild-1", memberId: "u1", invites: invitesOf(1),
  }), {});
  await guildMemberAdd.handleInviteTracking(makeMember({
    guildId: "guild-2", memberId: "u2", invites: invitesOf(1),
  }), {});
  await guildMemberAdd.handleInviteTracking(makeMember({
    guildId: "guild-1", memberId: "u3", invites: invitesOf(2),
  }), {});

  assert.equal((await inviteService.getInviteStats(INVITER_ID, "guild-1")).current, 2);
  assert.equal((await inviteService.getInviteStats(INVITER_ID, "guild-2")).current, 1);
});

test("une attribution posée reste décrémentable au départ du membre", async () => {
  primeCache(GUILD_ID, new Map([["ABC", { code: "ABC", uses: 1, inviter: { id: INVITER_ID } }]]));
  await guildMemberAdd.handleInviteTracking(makeMember({
    invites: new Map([["ABC", { code: "ABC", uses: 2, inviter: { id: INVITER_ID } }]]),
  }), {});

  // Conséquence directe du correctif : le lien pointe un inviteur réel, donc la
  // révocation effectuée par guildMemberRemove retombe sur le bon compteur.
  const link = await statsRepository.findOne(GUILD_ID, "user-new");
  assert.equal(link.invitedBy, INVITER_ID);

  // B2 — la révocation se fait par MEMBRE INVITÉ, plus par inviteur : c'est
  // exactement ce qu'exécute guildMemberRemove. Le compteur, dérivé des liens
  // actifs, descend tout seul.
  await inviteService.revokeInvite(GUILD_ID, "user-new");
  assert.equal((await inviteService.getInviteStats(INVITER_ID, GUILD_ID)).current, 0);
});
