"use strict";

// P15 — convergence du moteur Tickets : ce fichier n'est plus qu'un
// dispatcher. Tout le cycle de vie des tickets (création, fermeture, claim,
// renommage, membres, réouverture, suppression) est servi par les routes
// modulaires civrat:v1:tickets:* (src/modules/tickets/register.js), branchées
// sur des ids stables. Le moteur legacy historique — son sélecteur de
// création, son menu d'options, ses boutons de réouverture/suppression et
// surtout sa numérotation COUNT(*)+1 non atomique — est intégralement
// retiré : la numérotation passe par le compteur atomique unique (RPC
// increment_ticket_counter, cf. docs/architecture/phase-10-4-ticket-counter.md).
// Les interactions inconnues du registre tombent simplement sans réponse —
// contrat de continuité legacy existant (aucune fuite vers du code mort).
const commandHandler = require("../handlers/commandHandler");

module.exports = {
  name: "interactionCreate",
  once: false,
  async execute(interaction) {
    // Seules les routes modulaires enregistrées sont consommées ici ; toute
    // interaction legacy historique tombe simplement au travers.
    const { getGuildSettingsRuntime } = require("../runtime/getGuildSettingsRuntime");
    if (await getGuildSettingsRuntime().tryHandle(interaction)) return;
    if (interaction.isChatInputCommand()) return commandHandler.handleCommand(interaction);
  },
};
