"use strict";
const fs=require("node:fs"),path=require("node:path");

// Racines de découverte des gabarits officiels. La racine historique
// `templates/` porte les trois gabarits standards ; `image/templates/` porte
// les gabarits officiels à asset graphique dédié (ex. template-civrat).
// La racine PAR DÉFAUT reste `templates/` seule : les tests et les registres
// génériques continuent de découvrir exactement les trois gabarits standards.
// La composition (runtime) passe explicitement `defaultTemplateRoots()` pour
// exposer aussi les gabarits officiels à asset dédié.
function defaultTemplateRoots(){return [path.join(__dirname,"..","templates"),path.join(__dirname,"..","image","templates")];}

class WelcomeTemplateRegistry {
  constructor({templatesPath,templatesPaths}={}){
    this.templatesPaths=templatesPaths||(templatesPath?[templatesPath]:[path.join(__dirname,"..","templates")]);
    this.templates=new Map();
  }
  discover(){
    for(const root of this.templatesPaths){
      if(!fs.existsSync(root))continue;
      for(const name of fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort()){
        const manifestPath=path.join(root,name,"template.json");
        if(!fs.existsSync(manifestPath))continue;
        const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
        if(this.templates.has(manifest.id))throw new Error(`Duplicate template: ${manifest.id}`);
        this.templates.set(manifest.id,Object.freeze({...manifest,assetsPath:path.join(root,name)}));
      }
    }
    return this.list();
  }
  list(){return [...this.templates.values()];}
  get(id){return this.templates.get(id)||null;}
  // Un gabarit déclarant `guildIds` (liste de guildes autorisées) n'est renvoyé
  // que si `guildId` y figure ; sinon il est invisible pour cette guilde.
  getForGuild(id,guildId){
    const template=this.get(id);
    if(!template)return null;
    if(Array.isArray(template.guildIds)&&!template.guildIds.includes(String(guildId)))return null;
    return template;
  }
  listForGuild(guildId){return this.list().filter(t=>!Array.isArray(t.guildIds)||t.guildIds.includes(String(guildId)));}
  select({mode="fixed",templateId,templateIds=[],random=Math.random}={}){const available=mode==="random"?templateIds.filter(id=>this.templates.has(id)):[templateId];if(!available.length)throw new Error("No welcome template available");return this.get(available[Math.floor(random()*available.length)]);}
}

// Résout le gabarit de base d'une guilde en respectant la restriction
// `guildIds` : un gabarit réservé à d'autres guildes retombe sur le gabarit par
// défaut. Tolère un registre minimal (stub de test) dépourvu de `getForGuild`.
function resolveBaseTemplate(registry,templateId,guildId,fallbackId="template-1"){
  if(!registry)return null;
  const direct=typeof registry.getForGuild==="function"?registry.getForGuild(templateId,guildId):registry.get(templateId);
  return direct||registry.get(fallbackId)||null;
}

module.exports={WelcomeTemplateRegistry,resolveBaseTemplate,defaultTemplateRoots};
