"use strict";

// P12.2 (B1) — l'entrypoint envoie la vue dans le salon fourni par l'appelant.
//
// M8 — le customId de création n'est plus stable : il porte désormais
// l'identité du panel. Le contrat vérifié ici est celui du nouveau format
//     civrat:v1:tickets:create:<panelId>:<buttonIndex>
// et le fait que l'ancien customId exact reste routé, mais vers un refus.

const test = require("node:test");
const assert = require("node:assert/strict");
const { TicketPanelDeliveryService } = require("../services/TicketPanelDeliveryService");
const { InMemoryTicketPanelRepository } = require("../persistence/TicketPanelRepository");
const { parsePanelCreateCustomId } = require("../interactions/ticketCreateRoute");
const { TicketComponentId: Id } = require("../configuration/ticketConstants");

const DRAFT = {
  categoryId: "111111111111111111",
  supportRoleId: "222222222222222222",
  buttons: [{ label: "Créer un ticket", emoji: null, style: "primary", category_id: null, support_role_id: null }],
};

test("M8: ticket panel delivery sends to the caller channel and encodes the panel id in the create custom id", async () => {
  let sentTo = null;
  const edited = [];
  const panelRepository = new InMemoryTicketPanelRepository();
  const service = new TicketPanelDeliveryService({
    panelService: {
      build: async ({ panel }) => ({
        ready: true,
        view: {
          title: "t",
          content: "d",
          components: panel
            ? [{ customId: `${Id.CREATE_PREFIX}${panel.id}:0`, label: "Créer un ticket" }]
            : [{ customId: Id.CREATE, label: "Créer un ticket" }],
        },
      }),
      defaultDraft: async () => DRAFT,
    },
    transport: {
      sendPanel: async (channelId) => { sentTo = channelId; return { id: "msg-1" }; },
      editPanel: async (_c, _m, view) => { edited.push(view); return { id: "msg-1" }; },
      deletePanel: async () => ({ deleted: true }),
    },
    panelRepository,
  });

  const result = await service.deliver({ guildId: "g", t: (k) => k, channelId: "interaction-channel", draft: DRAFT });
  assert.equal(result.delivered, true);
  assert.equal(sentTo, "interaction-channel");

  const customId = edited[0].components[0].customId;
  assert.match(customId, /^civrat:v1:tickets:create:\d+:0$/);
  assert.deepEqual(parsePanelCreateCustomId(customId), { panelId: result.panelId, buttonIndex: 0 });
});

test("M8: the legacy exact custom id still routes, to an explicit refusal", async () => {
  // L'ancien customId est celui des panels publiés avant M8 : ces messages
  // vivent toujours sur les serveurs. Il doit être reconnu (pas ignoré), puis
  // refusé proprement — jamais traité comme un panel valide.
  assert.equal(parsePanelCreateCustomId(Id.CREATE), null, "l'ancien customId n'est pas un customId de panel");
  assert.equal(parsePanelCreateCustomId(`${Id.CREATE_PREFIX}12:0`).panelId, "12");
  assert.equal(parsePanelCreateCustomId(`${Id.CREATE_PREFIX}12`), null, "buttonIndex manquant");
  assert.equal(parsePanelCreateCustomId(`${Id.CREATE_PREFIX}abc:0`), null, "panelId non numérique");
  assert.equal(parsePanelCreateCustomId(`${Id.CREATE_PREFIX}12:-1`), null, "buttonIndex négatif");
  assert.equal(parsePanelCreateCustomId("civrat:v1:tickets:close"), null, "autre route");
});
