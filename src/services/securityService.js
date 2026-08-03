const { PermissionsBitField } = require("discord.js");
const { fetchAuditLog } = require("../utils/auditLogCache");
const { sendLog } = require("./logService");
const logger = require("../utils/logger");

const incidents = new Map();
const WINDOW_MS = 15_000;
const NUKE_THRESHOLD = 3;
const RAID_THRESHOLD = 5;

function isWhitelisted(guild, config, userId) {
  return !userId || userId === guild.client.user?.id || userId === guild.ownerId || config.security_whitelist?.includes(userId);
}
function addIncident(guildId, key) {
  const now = Date.now(); const id = `${guildId}:${key}`;
  const values = (incidents.get(id) || []).filter((time) => now - time < WINDOW_MS);
  values.push(now); incidents.set(id, values); return values.length;
}
async function quarantine(guild, config, userId, reason) {
  if (!config.security_quarantine_role || !userId || isWhitelisted(guild, config, userId)) return "Aucune sanction configurée";
  const member = await guild.members.fetch(userId).catch(() => null);
  const role = guild.roles.cache.get(config.security_quarantine_role);
  if (!member || !role || !member.manageable) return "Quarantaine impossible";
  try { await member.roles.add(role, reason); return `Rôle de quarantaine appliqué : ${role}`; }
  catch (error) { logger.warn(`Security quarantine failed: ${error.message}`); return "Quarantaine impossible"; }
}
async function logSecurity(guild, config, title, target, details, sanction) {
  await sendLog(guild, config, "log_moderation_channel_id", { title: `🛡 ${title}`, color: "danger", target, fields: [{ name: "Détails", value: details }, { name: "Réponse", value: sanction }] });
}

async function recordRaidJoin(member, config) {
  if (!config.security_enabled || !config.security_anti_raid || member.user.bot) return;
  const count = addIncident(member.guild.id, "joins");
  if (count < RAID_THRESHOLD) return;
  const sanction = await quarantine(member.guild, config, member.id, "CIVRAT anti-raid");
  await logSecurity(member.guild, config, "Raid détecté", `${member.user} (${member.id})`, `${count} arrivées en moins de 15 secondes.`, sanction);
  incidents.delete(`${member.guild.id}:joins`);
}

async function handleBotJoin(member, config) {
  if (!config.security_enabled || !config.security_anti_bot || !member.user.bot || isWhitelisted(member.guild, config, member.id)) return;
  let sanction = "Expulsion impossible";
  try {
    if (member.kickable) { await member.kick("CIVRAT anti-bot : bot non autorisé"); sanction = "Bot expulsé automatiquement"; }
    else sanction = await quarantine(member.guild, config, member.id, "CIVRAT anti-bot");
  } catch (error) { logger.warn(`Anti-bot action failed: ${error.message}`); }
  await logSecurity(member.guild, config, "Bot non autorisé détecté", `${member.user} (${member.id})`, "Un bot a rejoint le serveur sans être présent dans la whitelist Security.", sanction);
}

async function recordNukeAction(guild, config, auditType, actionLabel) {
  if (!config.security_enabled || !config.security_anti_nuke) return;
  const entry = await fetchAuditLog(guild, auditType);
  const executorId = entry?.executor?.id;
  if (!executorId || isWhitelisted(guild, config, executorId)) return;
  const count = addIncident(guild.id, `${auditType}:${executorId}`);
  if (count < NUKE_THRESHOLD) return;
  const sanction = await quarantine(guild, config, executorId, `CIVRAT anti-nuke : ${actionLabel}`);
  await logSecurity(guild, config, "Action anti-nuke", `${entry.executor} (${executorId})`, `${count} actions « ${actionLabel} » détectées en moins de 15 secondes.`, sanction);
  incidents.delete(`${guild.id}:${auditType}:${executorId}`);
}

module.exports = { recordRaidJoin, handleBotJoin, recordNukeAction, isWhitelisted };
