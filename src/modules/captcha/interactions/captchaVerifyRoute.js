"use strict";

const { getLogsRuntime } = require("../../logs/runtime/getLogsRuntime");

async function handleCaptchaVerify(context, verificationService) {
  // Déferrement immédiat : la vérification lit la config, vérifie/attribue le
  // rôle et écrit un log avant de répondre — sans deferUpdate, une latence
  // Supabase/Discord ferait expirer l'interaction.
  await context.envelope.transport.deferUpdate?.();

  const member = context.envelope.discordMember;
  const result = await verificationService.verify({
    guildId: context.guildId,
    member: member
      ? { id: member.id, roleIds: [...member.roles.cache.keys()], discordMember: member }
      : null,
  });

  const action = result.verified && result.code === "CAPTCHA_VERIFIED"
    ? "captcha_verified"
    : "captcha_verification_failed";

  if (member?.guild) {
    await getLogsRuntime().handleCaptchaEvent({
      guild: member.guild,
      action,
      memberId: result.memberId,
      roleId: result.details?.roleId || null,
    });
  }

  await context.envelope.transport.reply({
    view: { content: context.t(`captcha.${result.code}`), components: [] },
    ephemeral: true,
  });

  return result;
}

module.exports = { handleCaptchaVerify };
