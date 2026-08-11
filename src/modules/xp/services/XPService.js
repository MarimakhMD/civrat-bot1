"use strict";

const { XP_GAIN } = require("../configuration/xpConstants");
const { LevelService } = require("./LevelService");

class XPService {
  constructor({ repository, levelService, cooldowns, clock, random } = {}) {
    if (!repository || typeof repository.findOne !== "function" || typeof repository.upsert !== "function") {
      throw new TypeError("XPService requires a repository with findOne/upsert");
    }
    this.repository = repository;
    this.levelService = levelService instanceof LevelService ? levelService : new LevelService();
    this.cooldowns = cooldowns instanceof Map ? cooldowns : new Map();
    this.clock = typeof clock === "function" ? clock : () => Date.now();
    this.random = typeof random === "function" ? random : () => Math.floor(Math.random() * (XP_GAIN.MAX - XP_GAIN.MIN + 1)) + XP_GAIN.MIN;
  }

  _cooldownKey(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  isOnCooldown(guildId, userId) {
    const key = this._cooldownKey(guildId, userId);
    if (!this.cooldowns.has(key)) return false;
    const last = this.cooldowns.get(key);
    return this.clock() - last < XP_GAIN.COOLDOWN_MS;
  }

  async handleMessage({ guildId, userId, isBot, config }) {
    if (!guildId || !userId || isBot) return { handled: false, code: "XP_IGNORED" };
    if (!config || !config.xp_enabled) return { handled: false, code: "XP_DISABLED" };
    if (this.isOnCooldown(guildId, userId)) return { handled: false, code: "XP_COOLDOWN" };

    const existing = await this.repository.findOne(guildId, userId);
    const currentXp = existing ? existing.xp : 0;
    const currentLevel = this.levelService.levelForXp(currentXp);
    const baseGain = this.random();
    const xpGain = Math.floor(baseGain * (config.xp_rate || 1));
    const newXp = currentXp + xpGain;
    const newLevel = this.levelService.levelForXp(newXp);
    const leveledUp = newLevel > currentLevel;

    await this.repository.upsert(guildId, userId, newXp, newLevel);
    this.cooldowns.set(this._cooldownKey(guildId, userId), this.clock());

    return {
      handled: true,
      code: leveledUp ? "XP_LEVELED_UP" : "XP_GAINED",
      xpGain,
      xp: newXp,
      level: newLevel,
      previousLevel: currentLevel,
      leveledUp,
    };
  }

  clearCooldown(guildId, userId) {
    this.cooldowns.delete(this._cooldownKey(guildId, userId));
  }

  clearAllCooldowns() {
    this.cooldowns.clear();
  }
}

module.exports = { XPService };
