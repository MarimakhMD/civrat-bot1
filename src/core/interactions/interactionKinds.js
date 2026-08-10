"use strict";

/** Transport-neutral interaction kinds. Transport adapters map platform events here. */
const InteractionKind = Object.freeze({
  COMMAND: "command",
  AUTOCOMPLETE: "autocomplete",
  BUTTON: "button",
  SELECT_MENU: "select-menu",
  MODAL: "modal",
});

function isInteractionKind(value) {
  return Object.values(InteractionKind).includes(value);
}

module.exports = { InteractionKind, isInteractionKind };
