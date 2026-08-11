"use strict";

const { TempVoiceService } = require("../services/TempVoiceService");
const { DiscordTempVoiceTransport } = require("../../../adapters/discord/DiscordTempVoiceTransport");

function createTempVoiceRuntime({ configService, transportFactory, tempChannels } = {}) {
  if (!configService || typeof configService.read !== "function") {
    throw new TypeError("createTempVoiceRuntime requires configService");
  }
  const channels = tempChannels instanceof Set ? tempChannels : new Set();
  const makeTransport = typeof transportFactory === "function" ? transportFactory : (guild) => new DiscordTempVoiceTransport({ guild });

  return Object.freeze({
    handleVoiceStateUpdate: async (oldState, newState) => {
      const guild = (newState && newState.guild) || (oldState && oldState.guild);
      if (!guild) return { handled: false, code: "GUILD_MISSING" };
      const config = await configService.read(guild.id);
      if (!config || !config.tempvoice_enabled) return { handled: false, code: "TEMPVOICE_DISABLED" };
      const newChannelId = newState && newState.channelId ? newState.channelId : null;
      const oldChannelId = oldState && oldState.channelId ? oldState.channelId : null;
      const transport = makeTransport(guild);
      const service = new TempVoiceService({ transport, config, tempChannels: channels });

      // Join lobby → create temp
      if (newChannelId && service.isLobby(newChannelId)) {
        const member = newState.member;
        return service.handleJoin({ member, channelId: newChannelId });
      }
      // Leave temp → delete if empty
      if (oldChannelId && service.isTempChannel(oldChannelId)) {
        return service.handleLeave({ channelId: oldChannelId });
      }
      return { handled: false, code: "NOT_TEMPVOICE" };
    },
    _channels: channels,
  });
}

module.exports = { createTempVoiceRuntime };
