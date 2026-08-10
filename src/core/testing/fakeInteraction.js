"use strict";

/** Records replies without depending on a Discord transport. */
function createFakeErrorTransport() {
  const replies = [];
  return {
    replies,
    async replyError(payload) { replies.push(payload); },
  };
}

module.exports = { createFakeErrorTransport };
