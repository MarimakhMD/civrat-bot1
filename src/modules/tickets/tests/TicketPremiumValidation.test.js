"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ValidationError } = require("../../../core/errors");
const {
  validateTicketPremiumUpdates,
  isValidTicketPremiumValue,
  isValidTicketNameFormat,
} = require("../configuration/ticketPremiumValidation");
const { TicketPremiumConfigKey: Key } = require("../configuration/ticketPremiumConstants");

const validUpdate = {
  [Key.PANEL_TITLE]: "Support Premium",
  [Key.PANEL_DESCRIPTION]: "Décrivez votre problème, l'équipe arrive.",
  [Key.PANEL_COLOR]: "#8061ef",
  [Key.PANEL_IMAGE_URL]: "https://cdn.example.com/panel.png",
  [Key.CREATE_BUTTON_LABEL]: "📩 Contacter le staff",
  [Key.NAME_FORMAT]: "ticket-{number}",
  [Key.WELCOME_MESSAGE]: "Bonjour {mention}, décris ton problème.",
  [Key.TRANSCRIPT_CHANNEL_ID]: "123456789012345678",
};

test("premium validation accepts a complete valid update", () => {
  assert.equal(validateTicketPremiumUpdates(validUpdate), true);
});

test("premium validation rejects unknown keys", () => {
  assert.throws(() => validateTicketPremiumUpdates({ ticket_panel_unknown: "x" }), ValidationError);
  assert.throws(() => validateTicketPremiumUpdates({ tickets_enabled: true }), ValidationError);
});

test("premium validation enforces hex colors", () => {
  assert.equal(validateTicketPremiumUpdates({ [Key.PANEL_COLOR]: "#ABCDEF" }), true);
  for (const bad of ["abcdef", "#abcd", "#abcdef00", "#gggggg", "blue", 0xffffff]) {
    assert.throws(() => validateTicketPremiumUpdates({ [Key.PANEL_COLOR]: bad }), ValidationError, `should reject ${bad}`);
  }
});

test("premium validation enforces max lengths", () => {
  assert.throws(() => validateTicketPremiumUpdates({ [Key.PANEL_TITLE]: "x".repeat(257) }), ValidationError);
  assert.throws(() => validateTicketPremiumUpdates({ [Key.PANEL_DESCRIPTION]: "x".repeat(2001) }), ValidationError);
  assert.throws(() => validateTicketPremiumUpdates({ [Key.CREATE_BUTTON_LABEL]: "x".repeat(81) }), ValidationError);
  assert.throws(() => validateTicketPremiumUpdates({ [Key.WELCOME_MESSAGE]: "x".repeat(2001) }), ValidationError);
});

test("premium validation rejects empty and non-string values", () => {
  for (const key of [Key.PANEL_TITLE, Key.PANEL_DESCRIPTION, Key.CREATE_BUTTON_LABEL, Key.WELCOME_MESSAGE]) {
    assert.throws(() => validateTicketPremiumUpdates({ [key]: "" }), ValidationError, `${key} should reject empty string`);
    assert.throws(() => validateTicketPremiumUpdates({ [key]: 42 }), ValidationError, `${key} should reject numbers`);
  }
});

test("premium validation accepts null on every key as a reset to Free defaults", () => {
  const reset = Object.fromEntries(Object.keys(validUpdate).map((key) => [key, null]));
  assert.equal(validateTicketPremiumUpdates(reset), true);
});

test("premium validation enforces https image urls", () => {
  assert.equal(validateTicketPremiumUpdates({ [Key.PANEL_IMAGE_URL]: "https://cdn.example.com/a.png?x=1" }), true);
  for (const bad of ["http://example.com/a.png", "not-an-url", "ftp://example.com/a.png", `https://example.com/${"a".repeat(1030)}`]) {
    assert.throws(() => validateTicketPremiumUpdates({ [Key.PANEL_IMAGE_URL]: bad }), ValidationError, `should reject ${bad.slice(0, 40)}`);
  }
});

test("ticket name format accepts valid patterns with a uniqueness placeholder", () => {
  assert.equal(isValidTicketNameFormat("ticket-{number}"), true);
  assert.equal(isValidTicketNameFormat("{username}-support"), true);
  assert.equal(isValidTicketNameFormat("staff-{userid}-box"), true);
  assert.equal(isValidTicketNameFormat("{number}"), true);
});

test("ticket name format rejects unsafe or colliding patterns", () => {
  assert.equal(isValidTicketNameFormat("Ticket-{number}"), false); // majuscule
  assert.equal(isValidTicketNameFormat("ticket {number}"), false); // espace
  assert.equal(isValidTicketNameFormat("support"), false); // aucun placeholder d'unicité
  assert.equal(isValidTicketNameFormat("ticket-{date}"), false); // placeholder inconnu
  assert.equal(isValidTicketNameFormat("ticket-{number"), false); // accolade déséquilibrée
  assert.equal(isValidTicketNameFormat(`${"a".repeat(86)}-{number}`), false); // > 90
  assert.equal(isValidTicketNameFormat(123), false);
});

test("premium validation enforces discord snowflakes for the transcript channel", () => {
  assert.equal(validateTicketPremiumUpdates({ [Key.TRANSCRIPT_CHANNEL_ID]: "12345678901234567" }), true);
  for (const bad of ["123", "not-a-channel", "123456789012345678901234", 123456789012345678]) {
    assert.throws(() => validateTicketPremiumUpdates({ [Key.TRANSCRIPT_CHANNEL_ID]: bad }), ValidationError, `should reject ${bad}`);
  }
});

test("isValidTicketPremiumValue is the non-throwing defensive variant", () => {
  assert.equal(isValidTicketPremiumValue(Key.PANEL_COLOR, "#00ff00"), true);
  assert.equal(isValidTicketPremiumValue(Key.PANEL_COLOR, "green"), false);
  assert.equal(isValidTicketPremiumValue(Key.PANEL_TITLE, null), true); // nullable = reset
  assert.equal(isValidTicketPremiumValue("unknown_key", "x"), false);
  assert.equal(isValidTicketPremiumValue(Key.NAME_FORMAT, "ticket-{number}"), true);
  assert.equal(isValidTicketPremiumValue(Key.NAME_FORMAT, "plain"), false);
});
