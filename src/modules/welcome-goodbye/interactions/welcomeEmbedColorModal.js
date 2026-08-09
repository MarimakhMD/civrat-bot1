"use strict";

const { setWelcomeEmbedColor } = require("./configureWelcomeEmbed");
const { WelcomeGoodbyeComponentId: ComponentId } = require("../configuration/welcomeGoodbyeConstants");

const EmbedColorFieldId = "color";

function openWelcomeEmbedColorModal(context) {
  return context.envelope.transport.showModal({
    customId: ComponentId.WELCOME_EMBED_COLOR,
    title: context.t("welcomeGoodbye.embedColorTitle"),
    fields: [{
      id: EmbedColorFieldId,
      label: context.t("welcomeGoodbye.embedColorLabel"),
      value: context.config?.welcome_embed_color || "#00e85c",
      required: true,
    }],
  });
}

async function submitWelcomeEmbedColor(context) {
  return setWelcomeEmbedColor(context, context.envelope.fields?.[EmbedColorFieldId]);
}

module.exports = { openWelcomeEmbedColorModal, submitWelcomeEmbedColor, EmbedColorFieldId };
