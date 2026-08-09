"use strict";
const { CaptchaConfigKey: Key } = require("../configuration/captchaConstants");

class CaptchaReminderService {
  constructor({ configService, transport }) {
    this.configService = configService;
    this.transport = transport;
  }

  async remind({ guildId, member, t }) {
    if (!member) return { sent: false, code: "MEMBER_UNAVAILABLE", details: {} };

    const config = await this.configService.read(guildId);
    if (!config[Key.ENABLED]) return { sent: false, code: "CAPTCHA_DISABLED", details: {} };
    if (member.roleIds?.includes(config[Key.ROLE_ID])) return { sent: false, code: "ALREADY_VERIFIED", details: {} };

    try {
      await this.transport.sendReminder(member.discordMember, {
        content: t("captcha.reminder", { channel: `<#${config[Key.CHANNEL_ID]}>` }),
      });
      return { sent: true, code: "REMINDER_SENT", details: {} };
    } catch {
      return { sent: false, code: "DM_UNAVAILABLE", details: {} };
    }
  }
}
module.exports = { CaptchaReminderService };
