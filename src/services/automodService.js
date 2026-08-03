const { PermissionsBitField } = require("discord.js");
const { sendLog } = require("./logService");
const logger = require("../utils/logger");

const activity = new Map();
const WINDOW_MS = 8_000;
const SPAM_LIMIT = 5;
const TIMEOUT_MS = 10 * 60 * 1000;

function isExempt(message) {
  // Canonical config has no role/channel allow-lists yet. Administrators and
  // members with moderation capability are safe defaults until those fields exist.
  return message.member?.permissions.has(PermissionsBitField.Flags.Administrator)
    || message.member?.permissions.has(PermissionsBitField.Flags.ManageMessages);
}

function normalize(value) { return value.normalize("NFKD").toLowerCase(); }
function escaped(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function countEmojis(content) {
  const unicode = [...content].filter((char) => /\p{Extended_Pictographic}/u.test(char)).length;
  const custom = (content.match(/<a?:\w+:\d+>/g) || []).length;
  return unicode + custom;
}
function getEntry(message) {
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const entry = activity.get(key) || [];
  const active = entry.filter((item) => now - item.at < WINDOW_MS);
  active.push({ at: now, content: normalize(message.content) });
  activity.set(key, active);
  return active;
}

async function handleMessage(message, config) {
  if (!config.automod_enabled || message.author.bot || !message.guild || isExempt(message)) return false;
  const content = message.content || "";
  const rules = [];
  if (config.automod_anti_spam) {
    const history = getEntry(message);
    const repetitions = history.filter((item) => item.content && item.content === normalize(content)).length;
    if (history.length >= SPAM_LIMIT || repetitions >= 3) rules.push("Anti-spam");
  }
  if (config.automod_anti_links && /(?:https?:\/\/|www\.)\S+/i.test(content)) rules.push("Anti-liens");
  if (config.automod_anti_invites && /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)[\w-]+/i.test(content)) rules.push("Anti-invitations");
  if (config.automod_anti_mention_spam && (message.mentions.users.size + message.mentions.roles.size) > config.automod_mention_threshold) rules.push("Spam de mentions");
  if (config.automod_emoji_threshold > 0 && countEmojis(content) > config.automod_emoji_threshold) rules.push("Spam d’emojis");
  if (config.automod_anti_caps && upperCaseRatio(content) >= config.automod_caps_threshold) rules.push("Spam de majuscules");
  if (config.automod_bad_words?.some((word) => word && new RegExp(`(^|\\s|\\p{P})${escaped(normalize(word))}(?=\\s|\\p{P}|$)`, "iu").test(normalize(content)))) rules.push("Mot interdit");
  if (!rules.length) return false;
  await applyAction(message, config, rules, content);
  return true;
}

function upperCaseRatio(content) {
  const letters = [...content].filter((char) => /\p{L}/u.test(char));
  if (letters.length < 8) return 0;
  return Math.round((letters.filter((char) => char === char.toUpperCase()).length / letters.length) * 100);
}

async function applyAction(message, config, rules, originalContent) {
  const action = ["ignore", "delete", "warn", "timeout", "kick", "ban"].includes(config.automod_punishment) ? config.automod_punishment : "warn";
  if (action === "ignore") return;
  try { await message.delete(); } catch (error) { logger.warn(`AutoMod could not delete ${message.id}: ${error.message}`); }
  let sanction = "Message supprimé";
  if (action === "warn") {
    sanction = "Message supprimé et avertissement";
    await message.channel.send({ content: `${message.author}, votre message a été modéré (${rules.join(", ")}).` }).then((warning) => setTimeout(() => warning.delete().catch(() => {}), 10_000)).catch(() => {});
  }
  if (action === "timeout") {
    const member = message.member;
    if (member?.moderatable) {
      await member.timeout(TIMEOUT_MS, `AutoMod: ${rules.join(", ")}`).catch((error) => logger.warn(`AutoMod timeout failed: ${error.message}`));
      sanction = "Message supprimé et timeout de 10 minutes";
    } else sanction = "Message supprimé (timeout impossible)";
  }
  if (action === "kick") {
    if (message.member?.kickable) { await message.member.kick(`AutoMod: ${rules.join(", ")}`); sanction = "Message supprimé et expulsion"; } else sanction = "Message supprimé (expulsion impossible)";
  }
  if (action === "ban") {
    if (message.member?.bannable) { await message.member.ban({ reason: `AutoMod: ${rules.join(", ")}` }); sanction = "Message supprimé et bannissement"; } else sanction = "Message supprimé (bannissement impossible)";
  }
  await sendLog(message.guild, config, "log_moderation_channel_id", { title: "🤖 AutoMod déclenché", color: "warning", target: `${message.author} (${message.author.id})`, fields: [{ name: "Règle", value: rules.join(", "), inline: true }, { name: "Sanction", value: sanction, inline: true }, { name: "Contenu", value: `\`\`\`\n${(originalContent || "—").slice(0, 900)}\n\`\`\`` }] });
}

module.exports = { handleMessage, isExempt, countEmojis };
