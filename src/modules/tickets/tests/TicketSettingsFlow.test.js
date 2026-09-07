"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { toggleTickets, selectTicket, previewTickets } = require("../interactions/configureTickets");
const { TicketComponentId: Id } = require("../configuration/ticketConstants");

const CAT = "111111111111111111";
const ROLE = "222222222222222222";

// ⚠️ CHANGEMENT D'ATTENTE (4G C4) — signalé explicitement.
// Ce test écrivait ticket_category_id: "c" et ticket_support_role_id: "r".
// Ces valeurs ne sont pas des snowflakes : elles sont désormais refusées avant
// écriture. Le test utilise donc de vrais identifiants Discord.
test("Ticket settings persist Free configuration", async () => {
  let config = { tickets_enabled: false };
  let updates = 0;
  const replies = [];
  const c = {
    guildId: "g", t: (k) => k,
    service: { read: async () => config, update: async (_g, p) => (config = { ...config, ...p }) },
    envelope: { transport: { update: async () => updates++, reply: async (r) => replies.push(r) } },
  };
  await toggleTickets(c);
  await selectTicket({ ...c, envelope: { customId: Id.CATEGORY, values: [CAT], transport: c.envelope.transport } });
  await selectTicket({ ...c, envelope: { customId: Id.SUPPORT_ROLE, values: [ROLE], transport: c.envelope.transport } });
  await previewTickets(c);
  assert.deepEqual(config, { tickets_enabled: true, ticket_category_id: CAT, ticket_support_role_id: ROLE });
  assert.equal(updates, 3);
  // previewTickets répond légitimement (aperçu) : ce qu'on vérifie ici, c'est
  // qu'aucune réponse ne porte le code d'identifiant invalide.
  assert.deepEqual(
    replies.filter((r) => r.view.content === "tickets.TICKET_INVALID_DISCORD_ID"),
    [],
    "aucune erreur sur des identifiants valides",
  );
});

// 4G C4 — un identifiant qui n'est pas un snowflake est refusé AVANT écriture.
test("Ticket settings refuse a non-snowflake identifier from a select menu", async () => {
  for (const [customId, key] of [[Id.CATEGORY, "ticket_category_id"], [Id.SUPPORT_ROLE, "ticket_support_role_id"], [Id.LOG_CHANNEL, "ticket_log_channel_id"]]) {
    let config = { tickets_enabled: true };
    const replies = [];
    const c = {
      guildId: "g", t: (k) => k,
      service: { read: async () => config, update: async (_g, p) => (config = { ...config, ...p }) },
      envelope: { transport: { update: async () => { throw new Error("ne doit pas être atteint"); }, reply: async (r) => replies.push(r) } },
    };
    for (const forged of ["'; DROP TABLE tickets;--", "cat-1", "1234", "9".repeat(23), "  ", "role:222222222222222222"]) {
      const trimmed = String(forged).trim();
      if (trimmed === "") continue; // la désélection volontaire est un cas à part, testé plus bas
      const result = await selectTicket({ ...c, envelope: { customId, values: [forged], transport: c.envelope.transport } });
      assert.equal(result, null, key + " : valeur forgée refusée (" + forged + ")");
      assert.equal(config[key], undefined, key + " : rien n'a été écrit pour " + JSON.stringify(forged));
    }
    assert.equal(replies.length, 5, key + " : un message d'erreur par valeur refusée");
    assert.equal(replies[0].view.content, "tickets.TICKET_INVALID_DISCORD_ID");
    assert.equal(replies[0].ephemeral, true);
  }
});

// 4G C4 — une valeur vide reste une désélection légitime (état « non configuré »).
test("Ticket settings still accept an explicit deselection", async () => {
  let config = { tickets_enabled: true, ticket_category_id: CAT };
  let updates = 0;
  const c = {
    guildId: "g", t: (k) => k,
    service: { read: async () => config, update: async (_g, p) => (config = { ...config, ...p }) },
    envelope: { transport: { update: async () => updates++, reply: async () => { throw new Error("aucune erreur attendue"); } } },
  };
  await selectTicket({ ...c, envelope: { customId: Id.CATEGORY, values: [], transport: c.envelope.transport } });
  assert.equal(config.ticket_category_id, null, "la catégorie est désélectionnée");
  assert.equal(updates, 1);
});

// Un customId inconnu ne fait rien.
test("Ticket settings ignore an unknown select custom id", async () => {
  const c = { guildId: "g", t: (k) => k, service: { update: async () => { throw new Error("ne doit pas être atteint"); } }, envelope: { transport: {} } };
  assert.equal(await selectTicket({ ...c, envelope: { customId: "civrat:v1:unknown", values: [CAT] } }), null);
});
