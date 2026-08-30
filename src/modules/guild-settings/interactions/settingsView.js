"use strict";

const { EntitlementDecision } = require("../../../core/entitlements");
const { SettingsComponentId } = require("./settingsComponents");
const {
  SETTINGS_CATALOG,
  findSettingsCategory,
  evaluateSettingsFeature,
} = require("../configuration/settingsCatalog");

function configOf(configState) {
  return configState?.config && typeof configState.config === "object" ? configState.config : {};
}

function categorySelect(t) {
  return {
    type: "select",
    customId: SettingsComponentId.CATEGORY,
    placeholder: t("guildSettings.chooseCategory"),
    options: SETTINGS_CATALOG.map((category) => ({
      label: t(category.labelKey),
      value: category.id,
      description: t(category.descriptionKey),
    })),
  };
}

function languageSelect(t, language) {
  return {
    type: "select",
    customId: SettingsComponentId.LANGUAGE,
    placeholder: t("guildSettings.languagePlaceholder"),
    options: [
      { label: t("guildSettings.languageFrench"), value: "fr", default: language === "fr" },
      { label: t("guildSettings.languageEnglish"), value: "en", default: language === "en" },
    ],
  };
}

function stateLabel(t, evaluated) {
  return evaluated.enabled
    ? t("guildSettings.stateEnabled")
    : t("guildSettings.stateDisabled");
}

function configurationLabel(t, evaluated) {
  if (!evaluated.enabled) return t("guildSettings.configurationNotRequired");
  return evaluated.configured
    ? t("guildSettings.configurationComplete")
    : t("guildSettings.configurationIncomplete");
}

function premiumLabel(t, feature, premiumDecisions) {
  if (!feature.premiumFeatures.length) return t("guildSettings.premiumNotApplicable");
  const decisions = feature.premiumFeatures.map((premiumFeature) => {
    const result = premiumDecisions?.[premiumFeature];
    return typeof result === "string" ? result : result?.code;
  });
  if (decisions.includes(EntitlementDecision.UNAVAILABLE) || decisions.some((decision) => !decision)) {
    return t("guildSettings.premiumUnavailable");
  }
  if (decisions.every((decision) => decision === EntitlementDecision.GRANTED)) {
    return t("guildSettings.premiumGranted");
  }
  return t("guildSettings.premiumRequired");
}

function persistenceNotice(t, configState) {
  if (!configState?.available) return `\n⚠️ ${t("guildSettings.configurationUnavailable")}`;
  if (!configState.found) return `\nℹ️ ${t("guildSettings.configurationDefaults")}`;
  return "";
}

function settingsHomeView({ t, language, configState }) {
  const config = configOf(configState);
  const lines = SETTINGS_CATALOG.map((category) => {
    const states = category.features.map((feature) => evaluateSettingsFeature(feature, config));
    const enabled = states.filter((entry) => entry.enabled).length;
    return `**${t(category.labelKey)}** — ${t("guildSettings.categorySummary", {
      enabled,
      total: category.features.length,
    })}`;
  });

  return {
    title: t("guildSettings.title"),
    content: `${t("guildSettings.homeDescription", { language: t(`guildSettings.languages.${language}`) })}${persistenceNotice(t, configState)}\n\n${lines.join("\n")}`,
    components: [categorySelect(t)],
  };
}

function settingsCategoryView({ t, language, categoryId, configState, premiumDecisions = {} }) {
  const category = findSettingsCategory(categoryId);
  if (!category) throw new Error("Unknown settings category");
  const config = configOf(configState);
  const details = category.features.map((feature) => {
    const evaluated = evaluateSettingsFeature(feature, config);
    return [
      `**${t(feature.labelKey)}**`,
      `• ${t("guildSettings.stateLabel")}: ${stateLabel(t, evaluated)}`,
      `• ${t("guildSettings.configurationLabel")}: ${configurationLabel(t, evaluated)}`,
      `• ${t("guildSettings.permissionLabel")}: ${t("guildSettings.permissionManageGuild")}`,
      `• ${t("guildSettings.premiumLabel")}: ${premiumLabel(t, feature, premiumDecisions)}`,
    ].join("\n");
  });

  const components = category.features.map((feature) => ({
    type: "button",
    customId: feature.customId,
    label: t(feature.labelKey),
    style: "secondary",
  }));
  if (category.includeLanguage) components.push(languageSelect(t, language));
  components.push({
    type: "button",
    customId: SettingsComponentId.HOME,
    label: t("guildSettings.backHome"),
    style: "secondary",
  });

  return {
    title: `${t("guildSettings.title")} — ${t(category.labelKey)}`,
    content: `${t(category.descriptionKey)}${persistenceNotice(t, configState)}\n\n${details.join("\n\n")}`,
    components,
  };
}

module.exports = {
  settingsHomeView,
  settingsCategoryView,
  categorySelect,
  languageSelect,
};
