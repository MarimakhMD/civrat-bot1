// ═══════════════════════════════════════════════════
// LOGGER - Structured logging utility
// ═══════════════════════════════════════════════════

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function timestamp() {
  return new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
}

const logger = {
  info: (msg, ...args) => {
    console.log(
      `${colors.gray}[${timestamp()}]${colors.reset} ${colors.blue}ℹ${colors.reset} ${msg}`,
      ...args
    );
  },

  success: (msg, ...args) => {
    console.log(
      `${colors.gray}[${timestamp()}]${colors.reset} ${colors.green}✅${colors.reset} ${msg}`,
      ...args
    );
  },

  warn: (msg, ...args) => {
    console.warn(
      `${colors.gray}[${timestamp()}]${colors.reset} ${colors.yellow}⚠️${colors.reset} ${msg}`,
      ...args
    );
  },

  error: (msg, ...args) => {
    console.error(
      `${colors.gray}[${timestamp()}]${colors.reset} ${colors.red}❌${colors.reset} ${msg}`,
      ...args
    );
  },

  event: (msg, ...args) => {
    console.log(
      `${colors.gray}[${timestamp()}]${colors.reset} ${colors.cyan}📡${colors.reset} ${msg}`,
      ...args
    );
  },
};

module.exports = logger;
