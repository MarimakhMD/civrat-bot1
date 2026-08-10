"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
test("configuration contract exposes every delivery key",()=>{for(const key of ["WELCOME_ENABLED","WELCOME_CHANNEL","WELCOME_MESSAGE","WELCOME_EMBED","WELCOME_COLOR","WELCOME_DM","WELCOME_DM_MESSAGE","GOODBYE_ENABLED","GOODBYE_CHANNEL","GOODBYE_MESSAGE","GOODBYE_EMBED","GOODBYE_COLOR"])assert.equal(typeof Key[key],"string");});
