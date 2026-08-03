// ═══════════════════════════════════════════════════
// EVENT HANDLER - Loads and registers all events
// ═══════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

function loadEvents(client) {
  const eventsPath = path.join(__dirname, "..", "events");
  const eventFiles = fs
    .readdirSync(eventsPath)
    .filter((file) => file.endsWith(".js"));

  for (const file of eventFiles) {
    try {
      const event = require(path.join(eventsPath, file));
      if (!event.name || !event.execute) {
        logger.warn(`Invalid event file: ${file}`);
        continue;
      }

      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
      } else {
        client.on(event.name, (...args) => event.execute(...args));
      }
    } catch (err) {
      logger.error(`Failed to load event ${file}:`, err.message);
    }
  }

  logger.success(`${eventFiles.length} events loaded`);
}

module.exports = { loadEvents };
