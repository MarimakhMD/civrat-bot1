"use strict";
const test=require("node:test"),assert=require("node:assert/strict");const {payload,DiscordResponseTransport}=require("../../../src/adapters/discord");
test("Discord response payload converts neutral views",()=>{const result=payload({title:"Title",content:"Content",components:[{type:"button",customId:"civrat:v1:x:y",label:"Open",style:"primary"}]},true);assert.equal(result.content,"Title\n\nContent");assert.equal(result.components.length,1);assert.equal(result.ephemeral,true);});

// Régression Phase 3.1 : sendTestWelcome construit un EmbedBuilder — l'import
// était absent (ReferenceError sur le bouton « Tester Welcome » en mode embed).
function testWelcomeTransport(channel){const interaction={guild:{channels:{cache:{get:()=>channel}}}};return new DiscordResponseTransport(interaction);}

test("sendTestWelcome with an embed builds a real EmbedBuilder instance",async()=>{const sent=[];const transport=testWelcomeTransport({isTextBased:()=>true,send:async(message)=>{sent.push(message);return message;}});await transport.sendTestWelcome({channelId:"123",content:"plain",embed:{color:"#ff0000",description:"Bienvenue {user} !"}});assert.equal(sent.length,1);assert.equal(sent[0].embeds.length,1);assert.equal(sent[0].embeds[0].constructor.name,"EmbedBuilder");assert.equal(sent[0].embeds[0].data.description,"Bienvenue {user} !");assert.equal(sent[0].embeds[0].data.color,0xff0000);assert.equal(sent[0].content,undefined);});

test("sendTestWelcome without embed keeps the historical plain content path",async()=>{const sent=[];const transport=testWelcomeTransport({isTextBased:()=>true,send:async(message)=>{sent.push(message);return message;}});await transport.sendTestWelcome({channelId:"123",content:"Bienvenue {user} !",embed:null});assert.deepEqual(sent,[{content:"Bienvenue {user} !"}]);});

test("sendTestWelcome rejects an unavailable target channel",async()=>{const transport=testWelcomeTransport(null);await assert.rejects(()=>transport.sendTestWelcome({channelId:"999",content:"x"}),/welcome_channel_unavailable/);});

// Phase 3.2 — contrat sendChannelMessage, miroir de DiscordWelcomeGoodbyeTransport
// (utilisé par le bouton « Tester Goodbye » dans /settings).
test("sendChannelMessage delivers the plain content to the configured channel",async()=>{const sent=[];const transport=testWelcomeTransport({isTextBased:()=>true,send:async(message)=>{sent.push(message);return message;}});await transport.sendChannelMessage("123",{content:"Au revoir !",embed:null});assert.deepEqual(sent,[{content:"Au revoir !"}]);});

test("sendChannelMessage builds an embed with the sibling default color and forwards files",async()=>{const sent=[];const transport=testWelcomeTransport({isTextBased:()=>true,send:async(message)=>{sent.push(message);return message;}});const buffer=Buffer.from("png");await transport.sendChannelMessage("123",{content:"ignored",embed:{color:null,description:"Au revoir !"},files:[{attachment:buffer,name:"card.png"}]});assert.equal(sent.length,1);assert.equal(sent[0].embeds[0].constructor.name,"EmbedBuilder");assert.equal(sent[0].embeds[0].data.description,"Au revoir !");assert.equal(sent[0].embeds[0].data.color,0x5865f2,"default embed color must match DiscordWelcomeGoodbyeTransport");assert.equal(sent[0].content,undefined);assert.deepEqual(sent[0].files,[{attachment:buffer,name:"card.png"}]);});

test("sendChannelMessage rejects an unavailable channel like the sibling transport",async()=>{const transport=testWelcomeTransport(null);await assert.rejects(()=>transport.sendChannelMessage("999",{content:"x"}),/channel_unavailable/);});
