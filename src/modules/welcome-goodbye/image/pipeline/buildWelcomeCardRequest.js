"use strict";
const { WelcomeImageRequest } = require("../contracts/WelcomeImageRequest");

// Builds the dynamic card request shared by the join delivery and the admin
// preview. The text stays placeholder-resolved by the existing
// WelcomeTemplateRenderer before reaching this builder (subtitleText).
function buildWelcomeCardRequest({ member, subtitleText, template, locale = "fr" }) {
  return new WelcomeImageRequest({
    guildId: member.guildId,
    userId: member.userId,
    locale,
    avatarUrl: member.avatarUrl || null,
    displayName: member.displayName || member.username || null,
    textElements: [
      { id: "title", content: member.displayName || member.username || "" },
      { id: "subtitle", content: subtitleText || "" },
    ],
    dimensions: { width: template.design.width, height: template.design.height },
  });
}

module.exports = { buildWelcomeCardRequest };
