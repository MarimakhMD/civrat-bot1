"use strict";

async function handleCaptchaVerify(context, verificationService) {
  const member = context.envelope.discordMember;
  const result = await verificationService.verify({
    guildId: context.guildId,
    member: {
      id: member?.id || null,
      roleIds: member ? [...member.roles.cache.keys()] : [],
      discordMember: member,
    },
  });

  await context.envelope.transport.reply({
    view: {
      content: context.t(`captcha.${result.code}`),
      components: [],
    },
    ephemeral: true,
  });

  return result;
}
module.exports = { handleCaptchaVerify };
