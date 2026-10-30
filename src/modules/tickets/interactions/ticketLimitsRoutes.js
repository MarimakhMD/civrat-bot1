"use strict";
const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const { ticketLimitsView } = require("./ticketLimitsView");
const { enforceConfigWrite } = require("../../../core/rateLimit/ActionRateLimitGuard");

async function openLimits(context) {
  let globalLimit = 1;
  try {
    const settings = context.freeSettingsRepository ? await context.freeSettingsRepository.get(context.guildId) : null;
    if (settings) globalLimit = settings.openLimit;
  } catch (_) {}
  const config = await context.service.read(context.guildId);
  await context.envelope.transport.update({ view: ticketLimitsView({ t: context.t, config, globalLimit }) });
  return { ok: true };
}

async function handleGlobalLimit(context) {
  if (!(await enforceConfigWrite(context))) return null;
  const raw = context.envelope.values?.[0];
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    await context.envelope.transport.reply({ view: { title: context.t("tickets.title"), content: context.t("tickets.TICKET_INVALID_LIMIT"), components: [] }, ephemeral: true });
    return null;
  }
  if (!context.freeSettingsRepository) {
    await context.envelope.transport.reply({ view: { title: context.t("tickets.title"), content: context.t("tickets.TICKETS_SETTINGS_UNAVAILABLE"), components: [] }, ephemeral: true });
    return null;
  }
  try {
    await context.freeSettingsRepository.setOpenLimit(context.guildId, value);
  } catch (_) {
    await context.envelope.transport.reply({ view: { title: context.t("tickets.title"), content: context.t("tickets.TICKETS_SETTINGS_UNAVAILABLE"), components: [] }, ephemeral: true });
    return null;
  }
  const config = await context.service.read(context.guildId);
  await context.envelope.transport.update({ view: ticketLimitsView({ t: context.t, config, globalLimit: value }) });
  return { ok: true, globalLimit: value };
}

module.exports = { openLimits, handleGlobalLimit };
