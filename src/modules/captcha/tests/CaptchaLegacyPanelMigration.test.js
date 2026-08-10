"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const fs=require("node:fs");
test("legacy captcha panel and verify fallback have no active consumers",()=>{const interaction=fs.readFileSync("src/events/interactionCreate.js","utf8");const command=fs.readFileSync("src/commands/captcha.js","utf8");const legacy=fs.readFileSync("src/services/captchaService.js","utf8");assert.doesNotMatch(interaction,/captchaService|captcha_verify/);assert.match(command,/CaptchaPanelDeliveryService/);assert.doesNotMatch(legacy,/sendPanel|async function verify/);});
