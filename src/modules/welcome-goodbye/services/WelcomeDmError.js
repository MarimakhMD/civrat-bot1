"use strict";
const { CivratError } = require("../../../core/errors");
function normalizeWelcomeDmError(error, context = {}) { return new CivratError({ code:"WELCOME_DM_UNAVAILABLE", translationKey:"welcomeGoodbye.dmUnavailable", metadata:{...context,reason:"dm_unavailable"}, cause:error, isUserSafe:true }); }
module.exports={normalizeWelcomeDmError};
