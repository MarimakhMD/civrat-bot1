"use strict";

const TicketConfigKey = Object.freeze({
  ENABLED: "tickets_enabled",
  CATEGORY_ID: "ticket_category_id",
  SUPPORT_ROLE_ID: "ticket_support_role_id",
  // P13 (B3) : destination Free des transcripts (et des logs tickets côté
  // legacy, qui lit déjà cette même clé). Le fallback closeTicket la lisait
  // déjà ; sans clé ni UI elle restait toujours nulle (zombie).
  LOG_CHANNEL_ID: "ticket_log_channel_id",
});
const TicketComponentId = Object.freeze({
  PANEL: "civrat:v1:tickets:panel",
  TOGGLE: "civrat:v1:tickets:toggle",
  CATEGORY: "civrat:v1:tickets:category",
  SUPPORT_ROLE: "civrat:v1:tickets:support-role",
  // P13 (B3) : sélecteur du salon Free de logs/transcripts.
  LOG_CHANNEL: "civrat:v1:tickets:log-channel",
  PREVIEW: "civrat:v1:tickets:preview",
  BACK: "civrat:v1:tickets:back",
  CREATE: "civrat:v1:tickets:create",
  CLOSE: "civrat:v1:tickets:close",
  REOPEN: "civrat:v1:tickets:reopen",
  DELETE: "civrat:v1:tickets:delete",
  RENAME: "civrat:v1:tickets:rename",
  RENAME_SUBMIT: "civrat:v1:tickets:rename:submit",
  ADD_MEMBER: "civrat:v1:tickets:add-member",
  ADD_MEMBER_SUBMIT: "civrat:v1:tickets:add-member:submit",
  REMOVE_MEMBER: "civrat:v1:tickets:remove-member",
  REMOVE_MEMBER_SUBMIT: "civrat:v1:tickets:remove-member:submit",
  CLAIM: "civrat:v1:tickets:claim",
  // ─────────────────────────────────────────────────────────────────────────
  // M8 — panels persistants (public.ticket_panels).
  //
  // CREATE reste enregistré en matcher EXACT : c'est le customId des panels
  // envoyés AVANT M8, qui vivent toujours sur les serveurs. Sa route ne crée
  // plus rien et renvoie TICKET_PANEL_LEGACY, qui demande de recréer le panel.
  //
  // CREATE_PREFIX porte le nouveau format :
  //     civrat:v1:tickets:create:<panelId>:<buttonIndex>
  // Le InteractionRegistry accepte un matcher `prefix` à côté d'un matcher
  // `exact` sur le même préfixe (overlaps() renvoie false dans les deux sens) :
  // les deux routes coexistent et sont résolues distinctement.
  //
  // ⚠️ Extraction par slice(CREATE_PREFIX.length), JAMAIS par split(":")[1] :
  //    le préfixe contient déjà quatre « : », donc split(":")[1] vaudrait "v1".
  // ─────────────────────────────────────────────────────────────────────────
  CREATE_PREFIX: "civrat:v1:tickets:create:",
  PANELS_SECTION: "civrat:v1:tickets:panels",
  PANELS_CREATE: "civrat:v1:tickets:panels:create",
  PANELS_DETAIL_PREFIX: "civrat:v1:tickets:panels:detail:",
  PANELS_EDIT_PREFIX: "civrat:v1:tickets:panels:edit:",
  PANELS_EDIT_SUBMIT_PREFIX: "civrat:v1:tickets:panels:edit:submit:",
  PANELS_DELETE_PREFIX: "civrat:v1:tickets:panels:delete:",
  // Phase 10.2 — sous-vue /settings « Personnalisation Premium » du panneau.
  PREMIUM_SECTION: "civrat:v1:tickets:premium",
  PREMIUM_EDIT: "civrat:v1:tickets:premium:edit",
  PREMIUM_EDIT_SUBMIT: "civrat:v1:tickets:premium:edit:submit",
  PREMIUM_PREVIEW: "civrat:v1:tickets:premium:preview",
  PREMIUM_RESET: "civrat:v1:tickets:premium:reset",
  // Phase 10.3 — contenu du ticket : message d'accueil + salon transcript.
  PREMIUM_EDIT_WELCOME: "civrat:v1:tickets:premium:edit-welcome",
  PREMIUM_EDIT_WELCOME_SUBMIT: "civrat:v1:tickets:premium:edit-welcome:submit",
  PREMIUM_PREVIEW_WELCOME: "civrat:v1:tickets:premium:preview-welcome",
  PREMIUM_TRANSCRIPT: "civrat:v1:tickets:premium:transcript",
  // Phase 10.4 — format de nommage Premium des salons.
  PREMIUM_EDIT_FORMAT: "civrat:v1:tickets:premium:edit-format",
  PREMIUM_EDIT_FORMAT_SUBMIT: "civrat:v1:tickets:premium:edit-format:submit",
});

// ─────────────────────────────────────────────────────────────────────────
// M8 — plafonds validés.
//
// MAX_PANELS_PER_GUILD = 10 : la sous-vue de gestion liste les panels en
// boutons. Discord n'autorise que 5 lignes × 5 boutons, donc 10 panels + Back
// + Créer tiennent sur une seule page sans pagination.
//
// MAX_BUTTONS_PER_PANEL = 5 : une ligne d'action. Davantage de types passe par
// davantage de panels, pas par un panel plus dense. C'est aussi la garantie que
// rows() (qui LÈVE au-delà de 5 lignes) ne peut pas être dépassé par un panel.
// ─────────────────────────────────────────────────────────────────────────
const MAX_PANELS_PER_GUILD = 10;
const MAX_BUTTONS_PER_PANEL = 5;

/** Identifiants Discord : 15 à 22 chiffres. Même règle que les role_rewards (A3). */
const DISCORD_ID_PATTERN = /^\d{15,22}$/;

/** Styles de bouton acceptés. `link` est EXCLU : il n'a pas de customId. */
const PANEL_BUTTON_STYLES = Object.freeze(["primary", "secondary", "success", "danger"]);

module.exports = {
  TicketConfigKey,
  TicketComponentId,
  MAX_PANELS_PER_GUILD,
  MAX_BUTTONS_PER_PANEL,
  DISCORD_ID_PATTERN,
  PANEL_BUTTON_STYLES,
};
