"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { normalizeWelcomeDmError } = require("../services/WelcomeDmError");
const { ValidationError } = require("../../../core/errors");
async function testWelcomeDm(context) { const config=await context.settings.get(context.guildId); if(!config[Key.WELCOME_DM]) throw new ValidationError({field:"welcomeDm",reason:"welcome_dm_disabled"}); const content=config[Key.WELCOME_DM_MESSAGE]||config[Key.WELCOME_MESSAGE]; try { await context.envelope.transport.sendTestWelcomeDm({content}); } catch (error) { throw normalizeWelcomeDmError(error, { guildId: context.guildId }); } context.adminLogService?.record({ action: "welcome_dm_test_sent", guildId: context.guildId, actorId: context.userId });
  await context.envelope.transport.reply({view:{content:context.t("welcomeGoodbye.testDmSent"),components:[]},ephemeral:true}); }
module.exports={testWelcomeDm};
