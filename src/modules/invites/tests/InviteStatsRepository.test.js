"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InMemoryInviteStatsRepository } = require("../persistence/InviteStatsRepository");

test("InMemory add/remove/setInvitedBy/getStats", async () => {
  const repo = new InMemoryInviteStatsRepository();
  // B2 — le membre invité est nommé à chaque attribution (PK guild_id+invited_id).
  await repo.addInvite("u1", "g1", "m1");
  let stats = await repo.getInviteStats("u1", "g1");
  assert.equal(stats.current, 1);
  await repo.addInvite("u1", "g1", "m2");
  stats = await repo.getInviteStats("u1", "g1");
  assert.equal(stats.current, 2);
  await repo.removeInvite("u1", "g1", "m2");
  stats = await repo.getInviteStats("u1", "g1");
  assert.equal(stats.current, 1);
  await repo.setInvitedBy("m1", "g1", "u1");
  const invited = await repo.getInviteStats("m1", "g1");
  assert.equal(invited.invitedBy, "u1", "invitedBy doit refléter le lien actif");
  const found = await repo.findOne("g1", "m1");
  assert.equal(found.invitedBy, "u1", "findOne doit exposer le lien");
  repo.clear();
  stats = await repo.getInviteStats("u1", "g1");
  assert.equal(stats.current, 0);
});
