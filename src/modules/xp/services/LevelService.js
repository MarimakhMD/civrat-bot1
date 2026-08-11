"use strict";

class LevelService {
  levelForXp(xp) {
    const value = Number(xp) || 0;
    if (value <= 0) return 0;
    return Math.floor(value / 100);
  }

  xpForLevel(level) {
    const lvl = Number(level) || 0;
    if (lvl <= 0) return 0;
    return lvl * 100;
  }

  progress(xp) {
    const level = this.levelForXp(xp);
    const currentLevelXp = this.xpForLevel(level);
    const nextLevelXp = this.xpForLevel(level + 1);
    const progress = xp - currentLevelXp;
    const needed = nextLevelXp - currentLevelXp;
    return { level, xp, currentLevelXp, nextLevelXp, progress, needed, percent: needed ? Math.floor((progress / needed) * 100) : 0 };
  }
}

module.exports = { LevelService };
