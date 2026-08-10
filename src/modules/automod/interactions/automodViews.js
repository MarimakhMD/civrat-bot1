"use strict";

const { AutoModComponentId: Id } = require("../configuration/automodConstants");

const RULES = [
  { rule: "antiSpam", key: "automod_anti_spam" },
  { rule: "antiLinks", key: "automod_anti_links" },
  { rule: "antiInvites", key: "automod_anti_invites" },
  { rule: "antiMentionSpam", key: "automod_anti_mention_spam" },
  { rule: "antiEmojiSpam", key: "automod_anti_emoji_spam" },
  { rule: "antiCaps", key: "automod_anti_caps" },
];

function ruleToggle(t, config, rule, key) {
  const on = Boolean(config[key]);
  return {
    type: "button",
    customId: `${Id.TOGGLE_PREFIX}:${rule}`,
    label: `${on ? "✅ " : "⬜ "}${t(`automod.rule.${rule}`)}`,
    style: on ? "success" : "secondary",
  };
}

function autoModView({ t, config }) {
  const enabled = Boolean(config.automod_enabled);
  const deleteOn = Boolean(config.automod_delete_message);
  return {
    title: t("automod.title"),
    content: t(enabled ? "automod.enabled" : "automod.disabled"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(enabled ? "automod.disable" : "automod.enable"), style: enabled ? "success" : "secondary" },
      { type: "button", customId: Id.DELETE_MESSAGE, label: `${deleteOn ? "✅ " : "⬜ "}${t("automod.deleteMessage")}`, style: deleteOn ? "success" : "secondary" },
      ...RULES.map(({ rule, key }) => ruleToggle(t, config, rule, key)),
      { type: "button", customId: Id.BAD_WORDS_OPEN, label: t("automod.configureBadWords"), style: "primary" },
      { type: "button", customId: Id.THRESHOLDS_OPEN, label: t("automod.configureThresholds"), style: "primary" },
      {
        type: "select",
        customId: Id.ENFORCE_SELECT,
        placeholder: t("automod.enforcement"),
        options: [
          { label: t("automod.enforcementNone"), value: "none" },
          { label: t("automod.enforcementWarn"), value: "warn" },
          { label: t("automod.enforcementTimeout"), value: "timeout" },
        ],
      },
      { type: "button", customId: Id.BACK, label: t("automod.back"), style: "secondary" },
    ],
  };
}

module.exports = { autoModView, RULES };
