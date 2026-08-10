"use strict";
const { TicketComponentId: Id } = require("../configuration/ticketConstants");
function openMemberModal(action) { return async (context) => context.envelope.transport.showModal({ customId: action === "add" ? Id.ADD_MEMBER_SUBMIT : Id.REMOVE_MEMBER_SUBMIT, title: context.t(action === "add" ? "tickets.addMemberTitle" : "tickets.removeMemberTitle"), fields: [{ id: "member_id", label: context.t("tickets.memberId"), required: true }] }); }
async function handleMemberAccess(context, factory, action) { const result=await factory(context).updateMemberAccess({guildId:context.guildId,channelId:context.envelope.discordChannel?.id||null,member:context.envelope.discordMember,targetMemberId:context.envelope.modalValues?.member_id?.trim(),action}); await context.envelope.transport.reply({view:{title:context.t("tickets.title"),content:context.t(`tickets.${result.code}`),components:[]},ephemeral:true}); return result; }
module.exports={openMemberModal,handleMemberAccess};
