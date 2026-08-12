"use strict";

const TicketConfigKey = Object.freeze({
  ENABLED: "tickets_enabled",
  CATEGORY_ID: "ticket_category_id",
  SUPPORT_ROLE_ID: "ticket_support_role_id",
});
const TicketComponentId = Object.freeze({
  PANEL: "civrat:v1:tickets:panel",
  TOGGLE: "civrat:v1:tickets:toggle",
  CATEGORY: "civrat:v1:tickets:category",
  SUPPORT_ROLE: "civrat:v1:tickets:support-role",
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
});

module.exports = { TicketConfigKey, TicketComponentId };
