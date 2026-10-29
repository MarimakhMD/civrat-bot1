"use strict";const {withModerationMetadata}=require("./services/slashMetadata");const {PermissionName}=require("../../core/permissions");const {WarningService}=require("./services/WarningService");const {TimeoutService}=require("./services/TimeoutService");const {BanService}=require("./services/BanService");const {KickService}=require("./services/KickService");const {DiscordModerationTransport}=require("../../adapters/discord/DiscordModerationTransport");const cmd=(name,description,permission,options)=>({name,description,permissions:{allOf:[permission]},options});const user=[{type:"user",name:"user",description:"Member",required:true}],reason=[{type:"string",name:"reason",description:"Reason",required:false}];const defs=[cmd("warn","Warn a member",PermissionName.MODERATE_MEMBERS,[...user,...reason]),cmd("mute","Timeout a member",PermissionName.MODERATE_MEMBERS,[...user,{type:"integer",name:"duration",description:"Minutes",required:false},...reason]),cmd("unmute","Remove timeout",PermissionName.MODERATE_MEMBERS,user),cmd("bannir","Ban a member",PermissionName.BAN_MEMBERS,[...user,...reason]),cmd("debannir","Unban a user",PermissionName.BAN_MEMBERS,[{type:"string",name:"id",description:"User ID",required:true}]),cmd("expulser","Kick a member",PermissionName.KICK_MEMBERS,[...user,...reason])].map(withModerationMetadata);
const { validUserId } = require("./services/sanctionReliability");
function registerModeration({
  registry,
  transportFactory = context => new DiscordModerationTransport({ guild: context.envelope.discordMember.guild, actor: context.envelope.discordMember }),
  logsRuntimeFactory = () => require("../../modules/logs/runtime/getLogsRuntime").getLogsRuntime(),
  warningRepositoryFactory = () => require("./runtime/getWarningRepository").getWarningRepository(),
}) {
  for (const definition of defs) registry.registerCommand({
    ...definition,
    execute: async context => {
      const options = context.envelope.options;
      const actor = context.envelope.discordMember;
      const transport = transportFactory(context);
      const targetId = definition.name === "debannir" ? options.getString("id") : options.getUser?.("user")?.id;
      const reason = options.getString?.("reason") ?? null;
      const params = { guildId: context.guildId, actor, targetId, reason, transport };
      const prefixes = { warn: "WARN", mute: "TIMEOUT", unmute: "UNTIMEOUT", bannir: "BAN", debannir: "UNBAN", expulser: "KICK" };
      let result;
      // Both resolved user IDs and the free-text unban ID are validated here.
      // The unban service revalidates its free-text ID independently.
      if (!validUserId(targetId)) result = { [definition.name === "warn" ? "warned" : "ok"]: false, code: `${prefixes[definition.name]}_INVALID_TARGET` };
      else if (definition.name === "warn") result = await new WarningService({ repository: warningRepositoryFactory() }).warn({ ...params, t: context.t });
      else if (definition.name === "mute") result = await new TimeoutService().apply({ ...params, durationMinutes: options.getInteger("duration") ?? 10 });
      else if (definition.name === "unmute") result = await new TimeoutService().remove(params);
      else if (definition.name === "bannir") result = await new BanService().ban(params);
      else if (definition.name === "debannir") result = await new BanService().unban({ ...params, userId: targetId });
      else result = await new KickService().kick(params);

      // Only warn logs originate here. All other sanction logs remain event-driven.
      if (result.warned) {
        try {
          const logs = logsRuntimeFactory();
          if (!logs.disabled) await logs.handleModerationEvent({
            guild: actor.guild, action: definition.name, targetId: result.targetId,
            reason: result.reason ?? null, moderatorId: actor.id,
          });
        } catch { /* A recorded warning must not be retried because logging failed. */ }
      }
      let content = context.t(`moderation.${result.code}`);
      if (result.warned && result.persistence !== "durable") {
        content += "\n" + context.t(result.persistence === "memory" ? "moderation.warningMemory" : "moderation.warningPersistenceUnknown");
      }
      const view = { title: context.t("moderation.title"), content, components: [] };
      if (result.warned) view.embed = { fields: [{ name: context.t("moderation.reasonLabel"), value: result.reason || context.t("moderation.noReason") }] };
      await context.envelope.transport.reply({ view, ephemeral: true });
      return result;
    },
  });
  return { commands: defs };
}
module.exports = { registerModeration };
