"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { handleMessageDeleted } = require("../events/handleMessageDeleted");
const { handleMessageUpdated } = require("../events/handleMessageUpdated");
const { handleMessageBulkDeleted } = require("../events/handleMessageBulkDeleted");
const { handleMemberJoined } = require("../events/handleMemberJoined");
const { handleModerationEvent } = require("../events/handleModerationEvent");
const { handleRoleEvent } = require("../events/handleRoleEvent");
const { handleChannelEvent } = require("../events/handleChannelEvent");
const { handleInviteEvent } = require("../events/handleInviteEvent");

function makeDeps(config, channelKey = "c") {
  const delivered = [];
  return {
    config,
    mapper: { map: (entry) => entry },
    service: { resolveDestination: () => channelKey },
    delivery: {
      deliver: async (entry) => {
        delivered.push(entry);
        return { delivered: true, ...entry };
      },
    },
    delivered,
  };
}

// ───────────────────────────────────────────────────────────────
// P1a — messages supprimés / édités avec avant/après
// ───────────────────────────────────────────────────────────────

test("message supprimé : contenu en `before`, auteur en `who`, salon libellé", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps({
    logs_enabled: true,
    log_message_delete_channel_id: "c",
  });
  const message = {
    guild: { id: "G" },
    id: "MSG",
    channelId: "CH",
    channel: { id: "CH", name: "général" },
    content: "bonjour",
    author: { id: "A", tag: "Alice" },
  };
  await handleMessageDeleted({ message, config, mapper, service, delivery });
  assert.equal(delivered.length, 1);
  const d = delivered[0].details;
  assert.equal(d.who, "Alice (A)");
  assert.equal(d.channel, "#général (CH)");
  assert.equal(d.before, "bonjour");
  assert.equal(d.messageId, "MSG");
});

test("message édité : avant/après renseignés uniquement quand disponibles", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps({
    logs_enabled: true,
    log_message_edit_channel_id: "c",
  });
  const message = { guild: { id: "G" }, id: "MSG", channelId: "CH", content: "nouveau", author: { id: "A", tag: "Alice" } };
  const oldMessage = { content: "ancien" };
  await handleMessageUpdated({ message, oldMessage, config, mapper, service, delivery });
  const d = delivered[0].details;
  assert.equal(d.before, "ancien");
  assert.equal(d.after, "nouveau");
  assert.equal(d.who, "Alice (A)");

  // Partiel : oldMessage absent → `before` null (omis au rendu, jamais inventé).
  delivered.length = 0;
  await handleMessageUpdated({ message, config, mapper, service, delivery });
  assert.equal(delivered[0].details.before, null);
  assert.equal(delivered[0].details.after, "nouveau");
});

// ───────────────────────────────────────────────────────────────
// P1a — suppression groupée
// ───────────────────────────────────────────────────────────────

test("suppression groupée : résumé des auteurs + extraits, avec compteur", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps({
    logs_enabled: true,
    log_message_delete_channel_id: "c",
  });
  const messages = {
    size: 2,
    first: () => ({ guild: { id: "G" }, channel: { id: "CH", name: "général" } }),
    map: (fn) => [
      { author: { id: "A", tag: "Alice" }, content: "un message un peu long pour tester la troncature de l'extrait qui doit être coupé" },
      { author: null, content: "sans auteur" },
    ].map(fn),
  };
  await handleMessageBulkDeleted({ messages, config, mapper, service, delivery });
  const d = delivered[0].details;
  assert.equal(d.count, 2);
  assert.equal(d.channel, "#général (CH)");
  assert.match(d.before, /Alice \(A\) : un message un peu long/);
  assert.match(d.before, /inconnu : sans auteur/);
});

// ───────────────────────────────────────────────────────────────
// P1a — arrivée avec invitation
// ───────────────────────────────────────────────────────────────

test("arrivée : inviteur en `who`, code en `invite`, date d'arrivée ISO", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps({
    logs_enabled: true,
    log_member_join_channel_id: "c",
  });
  const client = { users: { cache: new Map([["I", { id: "I", tag: "Inviteur" }]]) } };
  const member = {
    id: "M",
    guild: { id: "G", client },
    user: { id: "M", tag: "Nouveau" },
    joinedAt: new Date("2026-09-11T10:00:00.000Z"),
  };
  await handleMemberJoined({ member, inviteResult: { code: "abc", inviter: "I" }, config, mapper, service, delivery });
  const d = delivered[0].details;
  assert.equal(d.who, "Inviteur (I)");
  assert.equal(d.invite, "abc");
  assert.equal(d.joinedAt, "2026-09-11T10:00:00.000Z");
  assert.equal(d.target, "Nouveau (M)");
});

test("arrivée sans inviteur fiable : `who` omis, jamais inventé", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps({
    logs_enabled: true,
    log_member_join_channel_id: "c",
  });
  const member = { id: "M", guild: { id: "G", client: { users: { cache: new Map() } } }, user: { id: "M", tag: "Nouveau" }, joinedAt: null };
  await handleMemberJoined({ member, inviteResult: null, config, mapper, service, delivery });
  assert.equal(delivered[0].details.who, undefined);
  assert.equal(delivered[0].details.invite, null);
});

// ───────────────────────────────────────────────────────────────
// P1b — modération : `who` seulement si renseigné
// ───────────────────────────────────────────────────────────────

test("modération : exécutant, raison et ids transmis quand disponibles", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps({
    logs_enabled: true,
    log_moderation_channel_id: "c",
  });
  await handleModerationEvent({
    guild: { id: "G" },
    config,
    action: "member_banned",
    targetId: "U1",
    target: "Alice (U1)",
    reason: "spam",
    moderator: "Modo (M1)",
    moderatorId: "M1",
    mapper,
    service,
    delivery,
  });
  const d = delivered[0].details;
  assert.equal(d.who, "Modo (M1)");
  assert.equal(d.targetId, "U1");
  assert.equal(d.target, "Alice (U1)");
  assert.equal(d.reason, "spam");
  assert.equal(d.moderatorId, "M1");
});

test("modération sans audit log : `who` omis (pas de « inconnu » dans details)", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps({
    logs_enabled: true,
    log_moderation_channel_id: "c",
  });
  await handleModerationEvent({ guild: { id: "G" }, config, action: "member_kicked", targetId: "U1", mapper, service, delivery });
  assert.equal(delivered[0].details.who, undefined);
});

// ───────────────────────────────────────────────────────────────
// P1b — rôles / salons / invitations
// ───────────────────────────────────────────────────────────────

test("rôle : auteur, cible et avant/après", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps({
    logs_enabled: true,
    log_role_update_channel_id: "c",
  });
  await handleRoleEvent({
    guild: { id: "G" },
    config,
    action: "role_updated",
    roleId: "R1",
    target: "@Modérateur (R1)",
    who: "Modo (M1)",
    before: "Modérateur",
    after: "Admin",
    mapper,
    service,
    delivery,
  });
  const d = delivered[0].details;
  assert.equal(d.who, "Modo (M1)");
  assert.equal(d.roleId, "R1");
  assert.equal(d.target, "@Modérateur (R1)");
  assert.equal(d.before, "Modérateur");
  assert.equal(d.after, "Admin");
});

test("salon : cible dérivée du salon si non fournie, auteur et avant/après", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps({
    logs_enabled: true,
    log_channel_update_channel_id: "c",
  });
  await handleChannelEvent({
    channel: { id: "C1", name: "général", guild: { id: "G" } },
    config,
    action: "channel_updated",
    who: "Modo (M1)",
    before: "général",
    after: "général-public",
    mapper,
    service,
    delivery,
  });
  const d = delivered[0].details;
  assert.equal(d.who, "Modo (M1)");
  assert.equal(d.target, "#général (C1)");
  assert.equal(d.channelId, "C1");
  assert.equal(d.before, "général");
  assert.equal(d.after, "général-public");
});

test("invitation : créateur, salon, expiration et usages", async () => {
  const { config, mapper, service, delivery, delivered } = makeDeps({
    logs_enabled: true,
    invitations_log_channel_id: "c",
  });
  await handleInviteEvent({
    guild: { id: "G" },
    config,
    action: "invite_created",
    inviteCode: "abc",
    inviter: "Alice (A1)",
    channel: "#général (C1)",
    expiresAt: "2026-09-12T10:00:00.000Z",
    uses: 3,
    maxUses: 10,
    mapper,
    service,
    delivery,
  });
  const d = delivered[0].details;
  assert.equal(d.who, "Alice (A1)");
  assert.equal(d.invite, "abc");
  assert.equal(d.channel, "#général (C1)");
  assert.equal(d.expiresAt, "2026-09-12T10:00:00.000Z");
  assert.equal(d.uses, 3);
  assert.equal(d.maxUses, 10);
});
