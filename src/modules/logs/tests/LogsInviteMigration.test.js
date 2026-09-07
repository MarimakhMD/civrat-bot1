"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { handleInviteEvent } = require("../events/handleInviteEvent");

// Livre un événement et renvoie { calls, result } pour assertion.
function deliverOnce(config, action = "invite_created") {
  let calls = 0;
  return handleInviteEvent({
    guild: { id: "g" },
    config,
    action,
    inviteCode: "x",
    mapper: { map: (entry) => entry },
    service: { resolveDestination: () => "c" },
    delivery: { deliver: async (entry) => { calls += 1; return { delivered: true, ...entry }; } },
  }).then((result) => ({ calls, result }));
}

test("invite events deliver once when enabled", async () => {
  for (const action of ["invite_created", "invite_deleted", "invite_used"]) {
    const { calls, result } = await deliverOnce(
      { logs_enabled: true, invitations_enabled: true, invitations_log_channel_id: "c" },
      action,
    );
    assert.equal(calls, 1);
    assert.equal(result.guildId, "g");
  }
});

// Phase 1 (C15) — cas discriminant n°1 : une guilde qui n'a jamais ouvert
// /settings n'a pas la clé `invitations_enabled`. Le tracking des invitations
// (guildMemberAdd.js) la traite comme ACTIVÉE par défaut ; le log doit suivre
// la même sémantique. Avec l'ancienne garde `!config.invitations_enabled`,
// ce cas retournait null : le tracking tournait, le log était jeté.
test("invite events deliver when invitations_enabled is absent (default-on, aligned with tracking)", async () => {
  const { calls, result } = await deliverOnce({ logs_enabled: true, invitations_log_channel_id: "c" });
  assert.equal(calls, 1, "an unconfigured guild must still get its invite log");
  assert.equal(result.channelKey, "invitations_log_channel_id");
});

// Phase 1 (C15) — cas discriminant n°2 : l'opt-out EXPLICITE doit continuer
// de couper le log. C'est la seule valeur qui désactive, conformément à
// INVITE_DEFAULTS.invitations_enabled === true.
test("invite events are suppressed on explicit opt-out (invitations_enabled === false)", async () => {
  const { calls, result } = await deliverOnce({
    logs_enabled: true,
    invitations_enabled: false,
    invitations_log_channel_id: "c",
  });
  assert.equal(calls, 0, "explicit opt-out must not deliver");
  assert.equal(result, null);
});

// Garde complémentaire : `logs_enabled` reste le maître — des invitations
// activées ne produisent aucun log si les journaux sont coupés.
test("invite events are suppressed when logs are disabled", async () => {
  const { calls, result } = await deliverOnce({
    logs_enabled: false,
    invitations_enabled: true,
    invitations_log_channel_id: "c",
  });
  assert.equal(calls, 0);
  assert.equal(result, null);
});
