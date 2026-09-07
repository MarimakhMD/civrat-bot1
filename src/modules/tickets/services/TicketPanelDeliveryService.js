"use strict";

const { normalizeButtons } = require("../persistence/TicketPanelRepository");

/**
 * M8 — Livraison d'un panel de tickets.
 *
 * P12.2 (B1) inchangé : la destination est un SALON TEXTE passé explicitement
 * par l'appelant (salon de l'interaction /ticketpanel) — jamais la catégorie de
 * configuration, qui n'est pas textuelle.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ORDRE DES OPÉRATIONS (décision D-B) : send Discord → insert Supabase.
 *
 * Pourquoi cet ordre : il garantit qu'aucune ligne ACTIVE sans message_id ne
 * peut subsister. Si l'insert échoue, on supprime le message qu'on vient
 * d'envoyer (compensation, même pattern que TicketService.rollbackTicketChannel)
 * et il ne reste rien.
 *
 * L'ordre inverse (insert → send) laisserait une fenêtre avec une ligne active
 * inutilisable — et comme la base ne concède aucun DELETE, on ne pourrait que
 * la désactiver, ce qui polluerait l'historique.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PROBLÈME DE L'ŒUF ET DE LA POULE, et sa résolution.
 *
 * Le customId d'un bouton encode le panelId :
 *     civrat:v1:tickets:create:<panelId>:<buttonIndex>
 * Or le panelId est un `bigint generated always as identity` : il n'existe
 * qu'APRÈS l'insert. On ne peut donc pas envoyer les boutons définitifs avant
 * d'avoir inséré.
 *
 * Résolution en trois temps, sans jamais exposer un customId invalide :
 *   1. SEND  — l'embed seul, SANS composant (rows([]) === []).
 *   2. INSERT — on obtient le vrai panelId.
 *   3. EDIT  — on ajoute les boutons avec leurs vrais customIds.
 *
 * Pendant la fenêtre (un aller-retour), le message n'a AUCUN bouton : il est
 * inerte, pas trompeur. Un customId de placeholder aurait été cliquable et
 * aurait renvoyé une erreur à un membre.
 *
 * Toute erreur après le send est compensée : le message est supprimé, et si la
 * ligne a déjà été insérée elle est désactivée (jamais supprimée).
 */
class TicketPanelDeliveryService {
  constructor({ panelService, transport, panelRepository }) {
    this.panelService = panelService;
    this.transport = transport;
    this.panelRepository = panelRepository;
  }

  /**
   * @param {object} options
   * @param {string} options.guildId
   * @param {Function} options.t
   * @param {string|null} options.channelId Salon texte de destination.
   * @param {object} options.draft { categoryId, supportRoleId, buttons }
   */
  async deliver({ guildId, t, channelId = null, draft = null } = {}) {
    if (!guildId) return { delivered: false, code: "TICKET_GUILD_OR_MEMBER_MISSING", details: {} };
    if (!this.panelRepository) return { delivered: false, code: "TICKET_PANEL_UNAVAILABLE", details: {} };
    if (!channelId) return { delivered: false, code: "CHANNEL_UNAVAILABLE", details: {} };
    // ─────────────────────────────────────────────────────────────────────
    // ORDRE DES GARDES. Le build passe EN PREMIER : c'est lui qui porte les
    // gardes historiques TICKETS_DISABLED puis TICKET_CONFIG_INCOMPLETE. Les
    // placer après la validation du brouillon ferait remonter
    // TICKET_CONFIG_INCOMPLETE pour une guilde dont les tickets sont
    // simplement désactivés — une régression du chemin d'erreur existant.
    //
    // Toutes ces gardes précèdent l'envoi Discord : aucun message orphelin ne
    // peut être créé pour une configuration invalide ou un plafond atteint.
    // ─────────────────────────────────────────────────────────────────────
    let chrome;
    try {
      // `panel: null` donne la vue historique (le chrome) ; les composants en
      // sont retirés au premier envoi, puis ajoutés à l'étape 3.
      chrome = await this.panelService.build({ guildId, panel: null, t });
    } catch (_error) {
      return { delivered: false, code: "TICKET_PANEL_UNAVAILABLE", details: {} };
    }
    if (!chrome.ready) return { delivered: false, code: chrome.code, details: {} };

    if (!draft || !draft.categoryId || !draft.supportRoleId) {
      return { delivered: false, code: "TICKET_CONFIG_INCOMPLETE", details: {} };
    }

    const buttons = normalizeButtons(draft.buttons);
    if (buttons.length === 0) return { delivered: false, code: "TICKET_PANEL_NO_BUTTON", details: {} };

    // Plafond validé : 10 panels actifs par guilde.
    let allowed = false;
    try {
      allowed = await this.panelRepository.canCreate(guildId);
    } catch (error) {
      return { delivered: false, code: this._persistenceCode(error), details: {} };
    }
    if (!allowed) return { delivered: false, code: "PANEL_LIMIT_REACHED", details: {} };

    // 1. SEND — embed seul, aucun composant.
    let message;
    try {
      message = await this.transport.sendPanel(channelId, { ...chrome.view, components: [] });
    } catch (_error) {
      return { delivered: false, code: "TRANSPORT_ERROR", details: {} };
    }
    const messageId = typeof message?.id === "string" ? message.id : null;
    if (!messageId) {
      return { delivered: false, code: "TRANSPORT_ERROR", details: {} };
    }

    // 2. INSERT — le panelId naît ici.
    let panel;
    try {
      panel = await this.panelRepository.create({
        guildId,
        channelId,
        messageId,
        categoryId: draft.categoryId,
        supportRoleId: draft.supportRoleId,
        buttons,
      });
    } catch (error) {
      // Compensation : le message vient d'être envoyé, il ne doit pas rester.
      await this.transport.deletePanel?.(channelId, messageId);
      return { delivered: false, code: this._persistenceCode(error), details: {} };
    }
    if (!panel?.id) {
      await this.transport.deletePanel?.(channelId, messageId);
      return { delivered: false, code: "TICKET_PANEL_UNAVAILABLE", details: {} };
    }

    // 3. EDIT — les boutons avec leurs vrais customIds.
    let finalPanel;
    try {
      const built = await this.panelService.build({ guildId, panel, t });
      if (!built.ready) throw new Error(built.code);
      await this.transport.editPanel(channelId, messageId, built.view);
      finalPanel = panel;
    } catch (_error) {
      // Le panel existe en base mais son message est inutilisable : on le
      // désactive (jamais de DELETE) et on retire le message.
      await this.panelRepository.deactivate(guildId, panel.id).catch(() => null);
      await this.transport.deletePanel?.(channelId, messageId);
      return { delivered: false, code: "TRANSPORT_ERROR", details: {} };
    }

    return {
      delivered: true,
      code: null,
      channelId,
      messageId,
      panelId: finalPanel.id,
      details: { panelId: finalPanel.id },
    };
  }

  /**
   * M8 — réédition d'un panel existant : DISCORD d'abord, puis la base.
   *
   * ─────────────────────────────────────────────────────────────────────
   * POURQUOI CET ORDRE (et pas l'inverse).
   *
   * Le customId d'un bouton porte son INDICE :
   *     civrat:v1:tickets:create:<panelId>:<buttonIndex>
   * Un indice hors bornes est refusé strictement à l'ouverture — un customId
   * forgé ne doit jamais pouvoir créer un ticket.
   *
   * La question est donc : pendant la réédition, quel état fait foi ?
   *
   *  · Base d'abord  → la base est réduite avant que Discord ne le soit. Un
   *    membre qui clique sur un ancien bouton encore affiché tombe sur un
   *    indice désormais hors bornes : refus, panel temporairement inexploitable.
   *
   *  · Discord d'abord (retenu) → le message est réduit AVANT la base. Pendant
   *    la transition la base contient encore l'ANCIEN état, qui est un
   *    SUR-ENSEMBLE en cas de réduction : tout bouton encore visible reste
   *    résolvable. Les boutons retirés ne sont plus affichés, donc plus
   *    cliquables. Et un indice arbitraire (99999) est hors bornes dans les
   *    deux états : toujours refusé.
   *
   * La création, elle, garde l'ordre inverse (send → insert → edit) parce
   * qu'aucun panelId n'existe avant l'insert : les deux ordres répondent à
   * deux contraintes différentes.
   * ─────────────────────────────────────────────────────────────────────
   *
   * Un message introuvable (suppression manuelle) déclenche la réconciliation
   * paresseuse : is_active = false.
   */
  async redeliver({ guildId, t, panel, updates = {} } = {}) {
    if (!panel?.id) return { delivered: false, code: "TICKET_PANEL_UNAVAILABLE", details: {} };

    // État CIBLE, projeté en mémoire : rien n'est écrit à ce stade.
    const projected = {
      ...panel,
      buttons: updates.buttons !== undefined ? normalizeButtons(updates.buttons) : panel.buttons,
      ...(updates.categoryId !== undefined ? { categoryId: updates.categoryId } : {}),
      ...(updates.supportRoleId !== undefined ? { supportRoleId: updates.supportRoleId } : {}),
    };
    if (projected.buttons.length === 0) {
      return { delivered: false, code: "TICKET_PANEL_NO_BUTTON", details: { panelId: panel.id } };
    }

    let built;
    try {
      built = await this.panelService.build({ guildId, panel: projected, t });
    } catch (_error) {
      return { delivered: false, code: "TICKET_PANEL_UNAVAILABLE", details: { panelId: panel.id } };
    }
    if (!built.ready) return { delivered: false, code: built.code, details: { panelId: panel.id } };

    // 1. DISCORD — le message ne montre jamais un bouton que la base refuserait.
    try {
      await this.transport.editPanel(panel.channelId, panel.messageId, built.view);
    } catch (error) {
      if (error?.message === "panel_message_not_found" || error?.message === "channel_unavailable") {
        // Réconciliation paresseuse. Rien n'a encore été écrit en base.
        await this.panelRepository.deactivate(guildId, panel.id).catch(() => null);
        return { delivered: false, code: "TICKET_PANEL_MESSAGE_MISSING", details: { panelId: panel.id } };
      }
      // Échec transitoire : la base n'a pas bougé, l'état reste cohérent.
      return { delivered: false, code: "TRANSPORT_ERROR", details: { panelId: panel.id } };
    }

    // 2. BASE.
    let updated;
    try {
      updated = await this.panelRepository.updatePanel(guildId, panel.id, updates);
    } catch (error) {
      return this._revertMessage({ guildId, t, panel, code: this._persistenceCode(error) });
    }
    // updatePanel renvoie null si le panel a été désactivé entre-temps.
    if (!updated) return this._revertMessage({ guildId, t, panel, code: "TICKET_PANEL_UNAVAILABLE" });

    return { delivered: true, code: null, panelId: updated.id, details: { panelId: updated.id } };
  }

  /**
   * M8 — retour arrière du message après un échec d'écriture en base.
   *
   * Discord a déjà été mis à jour, la base non : on remet le message dans
   * l'état ANTÉRIEUR pour que les deux concordent de nouveau.
   *
   * Si ce retour arrière échoue à son tour, on le signale par un code
   * distinct plutôt que de masquer la divergence. La dégradation reste
   * bornée : en cas de réduction, Discord affiche MOINS de boutons que la
   * base n'en connaît, donc tout bouton visible reste résolvable.
   */
  async _revertMessage({ guildId, t, panel, code }) {
    let reverted = false;
    try {
      const previousView = await this.panelService.build({ guildId, panel, t });
      if (previousView.ready) {
        await this.transport.editPanel(panel.channelId, panel.messageId, previousView.view);
        reverted = true;
      }
    } catch (_error) {
      reverted = false;
    }
    return {
      delivered: false,
      code: reverted ? code : "TICKET_PANEL_STATE_DIVERGENT",
      details: { panelId: panel.id, reverted },
    };
  }

  /**
   * M8 — désactivation : is_active = false, puis suppression BEST-EFFORT du
   * message. La base fait foi : un message qui n'a pas pu être supprimé reste
   * cliquable, mais son bouton retombe sur TICKET_PANEL_UNAVAILABLE.
   */
  async deactivate({ guildId, panel } = {}) {
    if (!panel?.id) return { deactivated: false, code: "TICKET_PANEL_UNAVAILABLE", details: {} };
    let result;
    try {
      result = await this.panelRepository.deactivate(guildId, panel.id);
    } catch (error) {
      return { deactivated: false, code: this._persistenceCode(error), details: {} };
    }
    if (result?.deactivated) {
      await this.transport.deletePanel?.(panel.channelId, panel.messageId);
    }
    return { deactivated: Boolean(result?.deactivated), code: null, panelId: panel.id, details: { panelId: panel.id } };
  }

  /** 42P01 est le seul signal retenu ; tout le reste remonte en PERSISTENCE_ERROR. */
  _persistenceCode(error) {
    return error?.code === "TICKET_PANELS_UNAVAILABLE" ? "TICKET_PANELS_UNAVAILABLE" : "PERSISTENCE_ERROR";
  }
}

module.exports = { TicketPanelDeliveryService };
