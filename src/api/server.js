const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { PermissionsBitField } = require("discord.js");
const { config } = require("../config");
const { supabase } = require("../config/database");
const logger = require("../utils/logger");

const SYNC_COOLDOWN_MS = 8_000;
const USER_SYNC_WINDOW_MS = 15 * 60 * 1_000;
const USER_SYNC_MAX = 20;
const guildSyncState = new Map();
const userSyncRequests = new Map();

const CONFIG_KEYS = new Set([
  'bot_prefix', 'bot_name', 'language',
  'welcome_enabled', 'welcome_channel_id', 'welcome_message', 'welcome_embed_enabled', 'welcome_embed_color', 'welcome_image_enabled', 'welcome_dm_enabled', 'welcome_dm_message',
  'goodbye_enabled', 'goodbye_channel_id', 'goodbye_message', 'goodbye_embed_enabled', 'goodbye_embed_color',
  'tickets_enabled', 'ticket_category_id', 'ticket_support_role_id', 'ticket_panel_title', 'ticket_panel_description', 'ticket_panel_color', 'ticket_log_channel_id',
  'logs_enabled', 'log_message_delete_channel_id', 'log_message_edit_channel_id', 'log_member_join_channel_id', 'log_member_leave_channel_id', 'log_role_update_channel_id', 'log_channel_update_channel_id', 'log_moderation_channel_id',
  'automod_enabled', 'automod_anti_spam', 'automod_anti_links', 'automod_anti_invites', 'automod_anti_ghost_ping', 'automod_anti_mention_spam', 'automod_anti_caps', 'automod_punishment', 'automod_mention_threshold', 'automod_caps_threshold', 'automod_emoji_threshold', 'automod_bad_words',
  'captcha_enabled', 'captcha_channel_id', 'captcha_role_id', 'captcha_type', 'captcha_success_message', 'captcha_failure_message',
  'xp_enabled', 'xp_per_message', 'xp_cooldown', 'xp_announce_channel_id', 'level_rewards', 'role_rewards',
  'giveaways_enabled', 'suggestions_enabled', 'suggestions_channel_id', 'suggestions_approval_channel_id', 'invitations_enabled', 'invitations_log_channel_id',
  'security_enabled', 'security_anti_nuke', 'security_anti_bot', 'security_anti_raid', 'security_whitelist', 'security_log_channel_id', 'security_quarantine_role',
  'temp_voice_enabled', 'temp_voice_category', 'temp_voice_creator_channel_id',
  'notify_security_alert', 'notify_weekly_summary', 'notify_product_updates',
]);

function discordIdFromUser(user) {
  const meta = user.user_metadata || {};
  const discordIdentity = user.identities?.find((identity) => identity.provider === 'discord')?.identity_data || {};
  return String(meta.provider_id || meta.sub || meta.id || discordIdentity.provider_id || discordIdentity.sub || discordIdentity.id || '');
}
function userRateLimited(userId) {
  const now = Date.now();
  const recent = (userSyncRequests.get(userId) || []).filter((time) => now - time < USER_SYNC_WINDOW_MS);
  if (recent.length >= USER_SYNC_MAX) { userSyncRequests.set(userId, recent); return true; }
  recent.push(now); userSyncRequests.set(userId, recent); return false;
}
const BOOLEAN_KEYS = new Set([...CONFIG_KEYS].filter((key) => key.endsWith('_enabled') || key.startsWith('automod_anti_') || key.startsWith('security_anti_') || key.startsWith('notify_')));
const NUMBER_LIMITS = { xp_per_message: [1, 10000], xp_cooldown: [0, 86400], automod_mention_threshold: [1, 100], automod_caps_threshold: [1, 100], automod_emoji_threshold: [1, 100] };
const ID_KEYS = new Set([...CONFIG_KEYS].filter((key) => key.endsWith('_id') || key.endsWith('_channel_id') || key.endsWith('_role_id') || key.endsWith('_category')));
const NULLABLE_TEXT_KEYS = new Set(['welcome_message', 'goodbye_message', 'welcome_dm_message']);

function isDiscordId(value) { return typeof value === 'string' && /^\d{15,22}$/.test(value); }
function validConfigValue(key, value) {
  if (BOOLEAN_KEYS.has(key)) return typeof value === 'boolean';
  if (key in NUMBER_LIMITS) return Number.isInteger(value) && value >= NUMBER_LIMITS[key][0] && value <= NUMBER_LIMITS[key][1];
  if (ID_KEYS.has(key)) return value === null || isDiscordId(value);
  if (key === 'language') return value === 'fr' || value === 'en';
  if (key === 'automod_punishment') return ['ignore', 'delete', 'warn', 'timeout', 'kick', 'ban'].includes(value);
  if (key === 'captcha_type') return ['button', 'image'].includes(value);
  if (key === 'automod_bad_words' || key === 'security_whitelist') return Array.isArray(value) && value.length <= 100 && value.every((item) => typeof item === 'string' && item.length <= 200);
  if (key === 'role_rewards') return Array.isArray(value) && value.length <= 100 && value.every((item) => Number.isInteger(item?.level) && item.level > 0 && isDiscordId(item?.role_id));
  if (key === 'level_rewards') return Array.isArray(value) && value.length <= 100 && value.every((item) => Number.isInteger(item?.level) && item.level > 0 && Number.isInteger(item?.xp_required) && item.xp_required >= 0);
  if (NULLABLE_TEXT_KEYS.has(key) && value === null) return true;
  return typeof value === 'string' && value.length <= 4000;
}
function sanitizeUpdates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key, item]) => !CONFIG_KEYS.has(key) || !validConfigValue(key, item))) return null;
  return Object.fromEntries(entries);
}

async function reloadGuildConfig(guildId, reason = 'sync') {
  const guildConfigService = require('../services/guildConfig');
  guildConfigService.invalidateCache(guildId);
  const configData = await guildConfigService.getGuildConfig(guildId);
  guildSyncState.set(guildId, { lastSyncAt: Date.now(), timer: null });
  logger.info(`Guild config reloaded for ${guildId} (${reason})`);
  return configData;
}
function scheduleGuildReload(guildId, waitMs) {
  const state = guildSyncState.get(guildId) || { lastSyncAt: 0, timer: null };
  if (state.timer) return;
  state.timer = setTimeout(() => reloadGuildConfig(guildId, 'coalesced sync').catch((error) => logger.error(`Deferred guild sync failed for ${guildId}:`, error.message)), waitMs);
  guildSyncState.set(guildId, state);
}

function createServer(discordClient) {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: [config.dashboardUrl, 'http://localhost:3000'], credentials: true, allowedHeaders: ['Authorization', 'Content-Type', 'X-Discord-Access-Token'] }));
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Too many requests' } }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), bot: discordClient?.user?.tag || 'not connected', guilds: discordClient?.guilds?.cache?.size || 0, ping: discordClient?.ws?.ping || -1 }));
  app.get('/', (req, res) => res.json({ name: 'CIVRAT Bot API', version: '2.0.0' }));

  async function authorizeGuild(req, res, enforceSyncRate = false) {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token || !supabase) { logger.warn('Guild API denied: missing authentication'); res.status(401).json({ error: 'Unauthorized' }); return null; }
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) { logger.warn('Guild API denied: invalid session'); res.status(401).json({ error: 'Unauthorized' }); return null; }
    const guildId = req.params.guildId;
    if (!/^\d{15,22}$/.test(guildId)) { res.status(400).json({ error: 'Invalid guild ID' }); return null; }
    const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) { logger.warn(`Guild API denied: unavailable guild ${guildId}`); res.status(404).json({ error: 'Guild not found' }); return null; }
    const discordId = discordIdFromUser(user);
    const member = discordId && (guild.members.cache.get(discordId) || await guild.members.fetch(discordId).catch(() => null));
    if (!member) { logger.warn(`Guild API denied: user ${user.id} is not a member of ${guildId}`); res.status(403).json({ error: 'Guild membership required' }); return null; }
    const canManage = member.permissions.has(PermissionsBitField.Flags.Administrator) || member.permissions.has(PermissionsBitField.Flags.ManageGuild);
    if (!canManage) { logger.warn(`Guild API denied: insufficient permissions for user ${user.id} on ${guildId}`); res.status(403).json({ error: 'Manage Guild permission required' }); return null; }
    if (enforceSyncRate && userRateLimited(user.id)) { logger.warn(`Guild API rate limited: user ${user.id}`); res.status(429).json({ error: 'Too many requests' }); return null; }
    return { guildId, user, guild, member };
  }

  app.get('/api/discord/guilds', async (req, res) => {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    const discordToken = req.get('x-discord-access-token');
    logger.info(`Discord guild discovery request: provider token received=${Boolean(discordToken)}`);
    if (!token || !discordToken || !supabase) { logger.warn('Discord guild discovery denied: missing authentication'); return res.status(401).json({ error: 'Unauthorized' }); }
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) { logger.warn('Discord guild discovery denied: invalid Supabase session'); return res.status(401).json({ error: 'Unauthorized' }); }
    try {
      const meResponse = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${discordToken}` } });
      if (!meResponse.ok) { logger.warn(`Discord guild discovery denied: provider token rejected (${meResponse.status})`); return res.status(401).json({ error: 'Discord authorization expired' }); }
      const discordUser = await meResponse.json();
      if (discordUser.id !== discordIdFromUser(user)) { logger.warn(`Discord guild discovery denied: identity mismatch for user ${user.id}`); return res.status(403).json({ error: 'Discord identity mismatch' }); }
      const guildResponse = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: `Bearer ${discordToken}` } });
      if (!guildResponse.ok) { logger.warn(`Discord guild discovery failed: guild API status ${guildResponse.status}`); return res.status(503).json({ error: 'Discord guilds unavailable' }); }
      const discordGuilds = await guildResponse.json();
      logger.info(`Discord guild discovery: guilds received=${discordGuilds.length}`);
      const manageableGuilds = discordGuilds.filter((item) => {
        const permissions = BigInt(item.permissions || '0');
        return item.owner || (permissions & 0x8n) === 0x8n || (permissions & 0x20n) === 0x20n;
      });
      logger.info(`Discord guild discovery: after admin filter=${manageableGuilds.length}`);
      const guilds = manageableGuilds.filter((item) => discordClient.guilds.cache.has(item.id)).map((item) => {
        const permissions = BigInt(item.permissions || '0');
        return { id: item.id, name: item.name, icon: item.icon, owner: item.owner, permissions: Number(permissions & 0xffffffffn), bot_present: true, member_count: 0 };
      });
      logger.info(`Discord guild discovery: after bot filter=${guilds.length}`);
      logger.info(`Discord guild discovery: final response guilds=${guilds.length}`);
      return res.json({ guilds });
    } catch (discordError) {
      logger.warn(`Discord guild discovery failed for user ${user.id}: ${discordError.message}`);
      return res.status(503).json({ error: 'Discord guilds unavailable' });
    }
  });

  app.get('/api/guilds/:guildId/metadata', async (req, res) => {
    const access = await authorizeGuild(req, res); if (!access) return;
    const channels = [...access.guild.channels.cache.values()].map((channel) => ({ id: channel.id, name: channel.name, type: channel.type, parent_id: channel.parentId || null }));
    const categories = channels.filter((channel) => channel.type === 4).map((channel) => ({ id: channel.id, name: channel.name }));
    const roles = [...access.guild.roles.cache.values()].filter((role) => role.id !== access.guild.id && !role.managed).sort((a, b) => b.position - a.position).map((role) => ({ id: role.id, name: role.name, color: role.color, position: role.position }));
    const emojis = [...access.guild.emojis.cache.values()].map((emoji) => ({ id: emoji.id, name: emoji.name, animated: emoji.animated }));
    return res.json({ guild: { id: access.guild.id, name: access.guild.name, icon: access.guild.icon }, channels, categories, roles, emojis, permissions: access.member.permissions.bitfield.toString() });
  });

  app.get('/api/guilds/:guildId/config', async (req, res) => {
    const access = await authorizeGuild(req, res); if (!access) return;
    try { return res.json({ config: await reloadGuildConfig(access.guildId, 'authorized read') }); }
    catch (error) { logger.error(`Guild config read failed for ${access.guildId}:`, error.message); return res.status(503).json({ error: 'Configuration unavailable' }); }
  });

  app.put('/api/guilds/:guildId/config', async (req, res) => {
    const access = await authorizeGuild(req, res, true); if (!access) return;
    const updates = sanitizeUpdates(req.body?.updates);
    if (!updates) return res.status(400).json({ error: 'Invalid configuration payload' });
    try {
      const guildConfigService = require('../services/guildConfig');
      const saved = await guildConfigService.updateGuildConfig(access.guildId, updates);
      if (!saved) return res.status(503).json({ error: 'Configuration save unavailable' });
      const state = guildSyncState.get(access.guildId) || { lastSyncAt: 0, timer: null };
      const elapsed = Date.now() - state.lastSyncAt;
      if (elapsed < SYNC_COOLDOWN_MS) scheduleGuildReload(access.guildId, SYNC_COOLDOWN_MS - elapsed);
      else await reloadGuildConfig(access.guildId, 'authorized update');
      return res.json({ config: saved });
    } catch (error) { logger.error(`Guild config update failed for ${access.guildId}:`, error.message); return res.status(503).json({ error: 'Configuration save unavailable' }); }
  });

  app.post('/api/guilds/:guildId/sync', async (req, res) => {
    const access = await authorizeGuild(req, res, true); if (!access) return;
    const state = guildSyncState.get(access.guildId) || { lastSyncAt: 0, timer: null };
    const elapsed = Date.now() - state.lastSyncAt;
    if (elapsed < SYNC_COOLDOWN_MS) { const retryAfter = SYNC_COOLDOWN_MS - elapsed; scheduleGuildReload(access.guildId, retryAfter); logger.info(`Guild sync coalesced for ${access.guildId}; reload in ${retryAfter}ms`); return res.status(202).json({ success: true, scheduled: true, retryAfter }); }
    try { await reloadGuildConfig(access.guildId); return res.json({ success: true, scheduled: false }); }
    catch (error) { logger.error(`Guild config sync failed for ${access.guildId}:`, error.message); return res.status(503).json({ error: 'Configuration reload unavailable' }); }
  });

  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.listen(config.apiPort, () => logger.success(`API server running on port ${config.apiPort}`));
  return app;
}
module.exports = { createServer };
