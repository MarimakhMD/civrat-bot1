"use strict";

const { setGoodbyeEmbedColor } = require("./configureGoodbyeEmbed");
const { WelcomeGoodbyeComponentId: ComponentId } = require("../configuration/welcomeGoodbyeConstants");

const EmbedColorFieldId = "color";

function openGoodbyeEmbedColorModal(context) {
  return context.envelope.transport.showModal({
    customId: ComponentId.GOODBYE_EMBED_COLOR,
    title: context.t("welcomeGoodbye.embedColorTitle"),
    fields: [{
      id: EmbedColorFieldId,
      label: context.t("welcomeGoodbye.embedColorLabel"),
      value: context.config?.welcome_embed_color || "#00e85c",
      required: true,
    }],
  });
}

async function submitGoodbyeEmbedColor(context) {
  return setGoodbyeEmbedColor(context, context.envelope.fields?.[EmbedColorFieldId]);
}

module.exports = { openGoodbyeEmbedColorModal, submitGoodbyeEmbedColor, EmbedColorFieldId };
