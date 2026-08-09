"use strict";
const { settingsView } = require("./welcomeGoodbyeViews");
const { goodbyeUpdatedMessage } = require("./welcomeAdminMessages");
async function updateGoodbyeSettings(context, updates, messageKey = null) { const config=await context.settings.update(context.guildId,updates); const view=settingsView({t:context.t,config}); view.content=`${messageKey?context.t(messageKey):goodbyeUpdatedMessage(context.t,config)}\n${view.content}`; await context.envelope.transport.update({view}); return config; }
module.exports={updateGoodbyeSettings};
