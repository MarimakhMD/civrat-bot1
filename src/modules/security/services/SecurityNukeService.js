"use strict";

const { SecurityNukeDefaults } = require("../configuration/securityConstants");

const ActionType = Object.freeze({
  CHANNEL_CREATE: "channelCreate",
  CHANNEL_DELETE: "channelDelete",
  ROLE_CREATE: "roleCreate",
  ROLE_DELETE: "roleDelete",
});

/**
 * Transport-neutral nuke detection.
 * Tracks per-guild + per-action counts in a sliding window.
 * Thresholds per spec: 10/12 channels, 30/32 roles. Store/clock injectable.
 */
class SecurityNukeService {
  constructor({ store, clock, windowMs, thresholds } = {}) {
    this.store = store instanceof Map ? store : new Map();
    this.clock = typeof clock === "function" ? clock : () => Date.now();
    this.windowMs = Number.isFinite(windowMs) ? windowMs : SecurityNukeDefaults.WINDOW_MS;
    this.thresholds = { ...SecurityNukeDefaults.THRESHOLDS, ...(thresholds || {}) };
  }

  clear(guildId) {
    if (!guildId) {
      this.store.clear();
      return;
    }
    for (const key of [...this.store.keys()]) {
      if (key === guildId || key.startsWith(`${guildId}:`)) this.store.delete(key);
    }
  }

  _key(guildId, action) {
    return `${guildId}:${action}`;
  }

  /**
   * Records an action and returns whether the guild is under nuke for that action.
   * @param {{guildId:string, action:string}} input — action is one of ActionType values
   * @returns {{isNuke:boolean, count:number, threshold:number, windowMs:number, action:string}}
   */
  record({ guildId, action }) {
    if (!guildId || !action || !this.thresholds[action]) {
      return { isNuke: false, count: 0, threshold: this.thresholds[action] || 0, windowMs: this.windowMs, action };
    }
    const threshold = this.thresholds[action];
    const now = this.clock();
    const key = this._key(guildId, action);
    const history = (this.store.get(key) || []).filter((t) => now - t < this.windowMs);
    history.push(now);
    this.store.set(key, history);
    return {
      isNuke: history.length >= threshold,
      count: history.length,
      threshold,
      windowMs: this.windowMs,
      action,
    };
  }

  check({ guildId, action }) {
    if (!guildId || !action || !this.thresholds[action]) {
      return { isNuke: false, count: 0, threshold: this.thresholds[action] || 0, windowMs: this.windowMs, action };
    }
    const threshold = this.thresholds[action];
    const now = this.clock();
    const key = this._key(guildId, action);
    const history = (this.store.get(key) || []).filter((t) => now - t < this.windowMs);
    return {
      isNuke: history.length >= threshold,
      count: history.length,
      threshold,
      windowMs: this.windowMs,
      action,
    };
  }
}

module.exports = { SecurityNukeService, ActionType };
