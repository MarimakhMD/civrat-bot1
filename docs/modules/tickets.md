# Tickets — état du module

## Portée actuelle

Le module Tickets est configuré exclusivement dans Discord via `/settings → Tickets`.

| Configuration | Rôle |
|---|---|
| `tickets_enabled` | Active ou désactive les créations Tickets. |
| `ticket_category_id` | Catégorie Discord dans laquelle les salons Tickets sont créés. |
| `ticket_support_role_id` | Rôle support autorisé à gérer les Tickets. |

`/ticketpanel` utilise `TicketPanelService`, `TicketPanelDeliveryService` et `DiscordTicketTransport` pour envoyer le panel persistant. Son bouton de création utilise `civrat:v1:tickets:create`.

## Création et accès

La création valide la configuration, la catégorie, le rôle support et la règle **One Open Ticket** : un membre ne peut posséder qu’un Ticket avec un statut `open` ou `claimed`.

Le salon créé applique les overwrites suivants :

- `@everyone` : pas de `ViewChannel` ;
- créateur : `ViewChannel`, `SendMessages`, `ReadMessageHistory` ;
- rôle `ticket_support_role_id` : mêmes permissions d’accès ;
- bot : accès, lecture, envoi et `ManageChannels`.

Un embed Welcome est envoyé après les overwrites. Il affiche le créateur et le rôle support, avec les contrôles préparés Close et Claim. Les chaînes visibles sont fournies en FR et EN par les traductions Tickets.

## Actions migrées

| Action | CustomId | Résultat |
|---|---|---|
| Close | `civrat:v1:tickets:close` | Bloque l’envoi du créateur, conserve le salon, persiste `status: "closed"`, `closed: true`, `closed_at`. |
| Reopen | `civrat:v1:tickets:reopen` | Restaure `SendMessages` au créateur et persiste `status: "open"`, `closed: false`, `closed_at: null`. |
| Delete | `civrat:v1:tickets:delete` | Supprime le salon puis persiste `status: "deleted"`, `closed: true`, `closed_at`. |
| Rename | `civrat:v1:tickets:rename` | Ouvre la modale `civrat:v1:tickets:rename:submit`, qui valide et renomme le salon. Le nom n’est pas persisté. |
| Add Member | `civrat:v1:tickets:add-member` | Ajoute un overwrite membre limité à `ViewChannel`, `SendMessages`, `ReadMessageHistory`. |
| Remove Member | `civrat:v1:tickets:remove-member` | Retire uniquement l’overwrite spécifique du membre. Le créateur est protégé. |

Les actions sont autorisées au créateur du Ticket ou à un membre disposant de `ticket_support_role_id`. Les autres membres reçoivent un résultat structuré `TICKET_UNAUTHORIZED`.

## Transcript

Le Transcript est une conséquence non bloquante du nouveau Close après fermeture Discord et persistance Supabase réussies. Il contient les 100 derniers messages en ordre chronologique, au format date ISO, tag auteur et contenu ; le fallback est `[pièce jointe / embed]`. Le fichier est nommé `transcript-<channelId>.txt`. Sans message, il contient `Aucun message dans ce ticket.`.

`ticket_log_channel_id` est réservé à cette destination Transcript. L’absence, l’invalidité ou l’échec de cette destination ne doit pas annuler le Close.

## Logs Tickets locaux

Les événements Tickets migrés sont livrés via Logs Foundation, localement à la guilde : création, fermeture, réouverture, suppression, renommage, ajout et retrait de membre.

`log_moderation_channel_id` est la destination Logs Foundation utilisée par ces événements. Il ne doit pas être confondu avec `ticket_log_channel_id`, qui reste spécifique au Transcript. Aucun dashboard, stockage global ou analytics CIVRAT n’est utilisé.

## Supabase

La source de vérité est PostgreSQL / Supabase. Le module utilise notamment `guild_id`, `user_id`, `channel_id`, `category`, `status`, `closed` et `closed_at`. La validation réelle du schéma, des contraintes et des valeurs autorisées nécessite les credentials de l’environnement concerné.

## Claim

Claim utilise `civrat:v1:tickets:claim` et est réservé au rôle `ticket_support_role_id`. Il vérifie le ticket, la guild, le statut fermé ou supprimé et le statut déjà claimed. Le repository persiste `status: "claimed"` ; le topic Discord conserve le propriétaire et le claimant au format `civrat-ticket:<ownerId>:<claimantId>`.

Aucun champ Supabase dédié au claimant n’est inventé ou modifié. La validation réelle de la contrainte Supabase autorisant `status: "claimed"` reste **Production validation pending**.

## Legacy encore présent

Les customIds legacy `ticket_create`, `ticket_options`, `ticket_reopen`, `ticket_delete`, `ticket_rename`, `ticket_add_user` et `ticket_remove_user` restent présents pour la continuité. Les nouveaux customIds `civrat:v1:*` sont distincts ; ils ne doivent pas provoquer de double traitement avec les routes legacy.
