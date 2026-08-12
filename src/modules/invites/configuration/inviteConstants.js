"use strict";

const InviteConfigKey = Object.freeze({
  ENABLED: "invitations_enabled",
  LOG_CHANNEL_ID: "invitations_log_channel_id",
});

// Phase 11 : invitations_enabled vaut true par défaut. Le tracking legacy des
// invitations a toujours été inconditionnel (guildMemberAdd/Remove, jamais
// filtré par config) ; aligner le défaut sur ce comportement réel rend le
// toggle /settings véridique (opt-out explicite) sans changer le comportement
// des guildes qui n'ont jamais ouvert le panneau. Le canal de log reste null
// tant qu'il n'est pas choisi (il se configure dans /settings → Logs).
const INVITE_DEFAULTS = Object.freeze({
  invitations_enabled: true,
  invitations_log_channel_id: null,
});

// Phase 11 : identifiants des composants /settings Invites (manquants — sans
// eux, registerInvites plantait à l'enregistrement, ce qui explique pourquoi
// le module n'était jamais câblé).
const InviteComponentId = Object.freeze({
  SECTION: "civrat:v1:invites:section",
  TOGGLE: "civrat:v1:invites:toggle",
  BACK: "civrat:v1:invites:back",
});

module.exports = { InviteConfigKey, InviteComponentId, INVITE_DEFAULTS };
