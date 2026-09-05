"use strict";const test=require("node:test"),assert=require("node:assert/strict");const {SupabaseTicketRepository}=require("../persistence/SupabaseTicketRepository");const {TicketPanelService}=require("../services/TicketPanelService");test("ticket repository delegates to mocked Supabase",async()=>{const repo=new SupabaseTicketRepository({supabase:{from:()=>({select:()=>({eq:()=>({eq:()=>({in:()=>({maybeSingle:async()=>({data:null,error:null})})})})})})}});assert.equal(await repo.findOpen("g","u"),null);});// M8 — build() prend désormais un objet { guildId, panel, t }.
// Sans panel (mode aperçu), la vue retombe sur le customId historique : il
// n'y a pas encore d'identifiant à encoder.
test("panel requires complete Free configuration and stable create id",async()=>{
  const service=new TicketPanelService({configService:{read:async()=>({tickets_enabled:true,ticket_category_id:"c",ticket_support_role_id:"r"})}});
  const panel=await service.build({guildId:"g",panel:null,t:k=>k});
  assert.equal(panel.ready,true);
  assert.equal(panel.view.components[0].customId,"civrat:v1:tickets:create");
});

// M8 — avec une ligne de panel, chaque bouton porte le customId complet
// civrat:v1:tickets:create:<panelId>:<buttonIndex>.
test("panel buttons encode panelId and buttonIndex in the custom id",async()=>{
  const service=new TicketPanelService({configService:{read:async()=>({tickets_enabled:true})}});
  const panel={id:"42",categoryId:"111111111111111111",supportRoleId:"222222222222222222",
    buttons:[{label:"Support",emoji:null,style:"primary",category_id:null,support_role_id:null},
             {label:"Bug",emoji:"🐛",style:"danger",category_id:null,support_role_id:null}]};
  const built=await service.build({guildId:"g",panel,t:k=>k});
  assert.equal(built.ready,true);
  assert.equal(built.view.components.length,2);
  assert.equal(built.view.components[0].customId,"civrat:v1:tickets:create:42:0");
  assert.equal(built.view.components[1].customId,"civrat:v1:tickets:create:42:1");
  assert.equal(built.view.components[1].emoji,"🐛");
  assert.equal(built.view.components[1].style,"danger");
  // 46 caractères au pire : très loin de la limite Discord de 100.
  assert.ok(built.view.components[1].customId.length<=100);
});

// M8 — un panel sans bouton valide ne doit pas être publié.
test("panel without any usable button is refused",async()=>{
  const service=new TicketPanelService({configService:{read:async()=>({tickets_enabled:true})}});
  const built=await service.build({guildId:"g",panel:{id:"1",categoryId:"111111111111111111",supportRoleId:"222222222222222222",buttons:[]},t:k=>k});
  assert.equal(built.ready,false);
  assert.equal(built.code,"TICKET_PANEL_NO_BUTTON");
});
