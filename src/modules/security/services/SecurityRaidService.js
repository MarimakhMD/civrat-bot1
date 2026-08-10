"use strict";

const { SecurityRaidDefaults } = require("../configuration/securityConstants");

/**
 * Transport-neutral raid detection.
 * 5 joins / 15 seconds per guild. Store and clock are injectable for deterministic tests.
 */
class SecurityRaidService {
  constructor({ store, clock, windowMs, threshold } = {}) {
    this.store = store instanceof Map ? store : new Map();
    this.clock = typeof clock === "function" ? clock : () => Date.now();
    this.windowMs = Number.isFinite(windowMs) ? windowMs : SecurityRaidDefaults.WINDOW_MS;
    this.threshold = Number.isFinite(threshold) ? threshold : SecurityRaidDefaults.THRESHOLD;
  }

  clear(guildId) {
    if (guildId) this.store.delete(guildId);
    else this.store.clear();
  }

  /**
   * Records a join and returns whether the guild is currently under raid.
   * @param {string} guildId
   * @returns {{isRaid:boolean, count:number, threshold:number, windowMs:number}}
   */
  record(guildId) {
    if (!guildId) return { isRaid: false, count: 0, threshold: this.threshold, windowMs: this.windowMs };
    const now = this.clock();
    const history = (this.store.get(guildId) || []).filter((t) => now - t < this.windowMs);
    history.push(now);
    this.store.set(guildId, history);
    return {
      isRaid: history.length >= this.threshold,
      count: history.length,
      threshold: this.threshold,
      windowMs: this.windowMs,
    };
  }

  /**
   * Checks without recording (peek).
   */
  check(guildId) {
    if (!guildId) return { isRaid: false, count: 0, threshold: this.threshold, windowMs: this.windowMs };
    const now = this.clock();
    const history = (this.store.get(guildId) || []).filter((t) => now - t < this.windowMs);
    return {
      isRaid: history.length >= this.threshold,
      count: history.length,
      threshold: this.threshold,
      windowMs: this.windowMs,
    };
  }
}

module.exports = { SecurityRaidService };
