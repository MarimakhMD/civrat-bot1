"use strict";const {TicketConfigKey:Key,TicketComponentId:Id,DISCORD_ID_PATTERN}=require("../configuration/ticketConstants");const {ticketView}=require("./ticketViews");async function update(context,updates){const config=await context.service.update(context.guildId,updates);await context.envelope.transport.update({view:ticketView({t:context.t,config})});return config;}async function toggleTickets(context){const config=await context.service.read(context.guildId);return update(context,{[Key.ENABLED]:!config[Key.ENABLED]});}// P13 (B3) : la destination Free des transcripts rejoint les sélecteurs persistés.
const SELECT_KEY_BY_CUSTOM_ID = Object.freeze({ [Id.CATEGORY]: Key.CATEGORY_ID, [Id.SUPPORT_ROLE]: Key.SUPPORT_ROLE_ID, [Id.LOG_CHANNEL]: Key.LOG_CHANNEL_ID });
// 4G C4 — les trois sélecteurs (catégorie, rôle support, salon de logs)
// écrivent un identifiant Discord dans guild_configs. La valeur vient de
// l'interaction : un client modifié peut soumettre n'importe quelle chaîne, et
// la whitelist A1 ne valide que les CLÉS, jamais le FORMAT des valeurs.
//
// Toutes les cibles étant scopées par guilde côté transport
// (guild.channels.cache / guild.roles.cache), une valeur forgée ne permettait
// pas d'atteindre une autre guilde — elle produisait seulement une
// configuration morte (TICKET_CONFIG_INCOMPLETE ou TRANSCRIPT_FAILED).
// Le refus est désormais explicite et antérieur à toute écriture.
//
// Une valeur vide reste acceptée : c'est la désélection volontaire, un état
// « non configuré » légitime que l'interface sait afficher.
async function selectTicket(context){
  const key=SELECT_KEY_BY_CUSTOM_ID[context.envelope.customId];
  if(!key)return null;
  const raw=context.envelope.values?.[0];
  const value=(raw===undefined||raw===null||String(raw).trim()==="")?null:String(raw).trim();
  if(value!==null&&!DISCORD_ID_PATTERN.test(value)){
    await context.envelope.transport.reply({view:{title:context.t("tickets.title"),content:context.t("tickets.TICKET_INVALID_DISCORD_ID"),components:[]},ephemeral:true});
    return null;
  }
  return update(context,{[key]:value});
}async function previewTickets(context){const config=await context.service.read(context.guildId);await context.envelope.transport.reply({view:{title:context.t("tickets.title"),content:`${context.t(config.tickets_enabled?"tickets.enabled":"tickets.disabled")}\n${context.t("tickets.category")}: ${context.t(config.ticket_category_id?"tickets.categoryConfigured":"tickets.categoryMissing")}\n${context.t("tickets.supportRole")}: ${context.t(config.ticket_support_role_id?"tickets.supportRoleConfigured":"tickets.supportRoleMissing")}`,components:[]},ephemeral:true});}module.exports={toggleTickets,selectTicket,previewTickets};
