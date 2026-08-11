"use strict";

const LOG_LEVELS = ["debug", "info", "success", "warn", "error"];

function format(level, message, meta) {
  const timestamp = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  const msg = typeof message === "string" ? message : String(message);
  return `[${timestamp}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}

const logger = {};

for (const level of LOG_LEVELS) {
  logger[level] = (message, meta) => {
    const line = format(level, message, meta);
    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  };
}

module.exports = logger;
module.exports.logger = logger;
