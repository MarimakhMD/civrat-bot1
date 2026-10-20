"use strict";

// Maintenance is a dedicated process: never start the bot after it.
async function launch(args = process.argv.slice(2), dependencies = {}) {
  const [mode = "start", ...options] = args;
  if (mode === "start") {
    if (options.length) throw new Error("start accepts no maintenance arguments");
    return (dependencies.start || require("./index").main)();
  }
  if (!["list", "clear", "deploy"].includes(mode)) throw new Error("Unknown launch mode");
  require("./src/deployment/maintenanceCli").parseMaintenanceArgs([mode, ...options]);
  const result = await (dependencies.maintenance || require("./deploy").main)([mode, ...options]);
  if (!result.ok) process.exitCode = 1;
  return result;
}
async function run(args = process.argv.slice(2), dependencies = {}) {
  try { return await launch(args, dependencies); }
  catch (error) {
    require("./src/utils/logger").error(error.code === "MAINTENANCE_ARGUMENTS" ? "Maintenance configuration rejected — no operation performed. Configure explicit targets; use start for the bot." : "Fatal startup failure.", { error });
    process.exitCode = 1;
    return { ok: false };
  }
}
if (require.main === module) run();
module.exports = { launch, run };
