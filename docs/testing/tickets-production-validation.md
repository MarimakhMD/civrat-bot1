# Tickets — protocole de validation de production

## Niveaux de validation

- **Tests offline** : mocks Discord et Supabase, exécutés sans guild ni projet réel.
- **Validation Discord réelle** : vérification des interactions, salons, rôles et permissions dans une guild de test.
- **Validation Supabase réelle** : vérification du schéma, des contraintes et des records dans l’environnement autorisé.

Ces trois niveaux sont distincts. Des tests offline verts ne constituent pas une validation Discord ou Supabase réelle.

## Préconditions

- Bot invité dans une guild de test avec les permissions nécessaires, notamment gestion des salons et des overwrites.
- Catégorie Tickets, rôle support, canal panel, canal Transcript et canal Logs Foundation disponibles.
- Credentials Supabase de l’environnement concerné disponibles pour une vérification en lecture contrôlée.
- Aucun test ne doit être réalisé dans une guild de production sans procédure approuvée.

## Checklist Discord

### Configuration et panel

- [ ] Ouvrir `/settings → Tickets` en FR puis en EN.
- [ ] Activer puis désactiver `tickets_enabled` et vérifier le blocage de création lorsqu’il est désactivé.
- [ ] Configurer `ticket_category_id`.
- [ ] Configurer `ticket_support_role_id`.
- [ ] Exécuter `/ticketpanel` et vérifier le panel persistant ainsi que `civrat:v1:tickets:create`.

### Création et permissions

- [ ] Créer un Ticket avec un membre standard.
- [ ] Vérifier la règle One Open Ticket.
- [ ] Vérifier que `@everyone` ne voit pas le salon.
- [ ] Vérifier les accès du créateur, du rôle support et du bot.
- [ ] Vérifier l’embed Welcome, le créateur, le rôle support et les chaînes FR/EN.

### Cycle de vie

- [ ] Close : vérifier le blocage d’envoi du créateur, le statut fermé et la conservation du salon.
- [ ] Reopen : vérifier le retour de `SendMessages` et l’état ouvert.
- [ ] Rename : vérifier la modale et les règles de validation du nom.
- [ ] Add Member : vérifier les trois permissions ciblées uniquement.
- [ ] Remove Member : vérifier le retrait du seul overwrite du membre ciblé ; vérifier la protection du créateur, du rôle support et de `@everyone`.
- [ ] Delete : vérifier la suppression Discord et l’état `deleted` du record.

### Transcript et logs

- [ ] Fermer un Ticket avec `ticket_log_channel_id` configuré et vérifier le fichier Transcript, ses 100 messages maximum, l’ordre et le fallback pièce jointe/embed.
- [ ] Vérifier qu’une destination Transcript absente ou invalide ne fait pas échouer Close.
- [ ] Vérifier les événements locaux Logs Foundation : création, fermeture, réouverture, suppression, renommage, ajout et retrait de membre.
- [ ] Vérifier que ces événements utilisent `log_moderation_channel_id` et non `ticket_log_channel_id`.

### Après redémarrage

- [ ] Redémarrer le bot.
- [ ] Vérifier que les panels et customIds persistants fonctionnent toujours.
- [ ] Vérifier qu’un Ticket ouvert reste détecté par One Open Ticket.
- [ ] Vérifier qu’aucun événement Tickets n’est livré deux fois.

## Checklist Supabase réelle

- [ ] Vérifier les records Tickets créés, fermés, rouverts et supprimés.
- [ ] Vérifier `guild_id`, `user_id`, `channel_id`, `status`, `closed` et `closed_at`.
- [ ] Vérifier que le Delete conserve le record avec l’état `deleted`.
- [ ] Vérifier les contraintes réelles de `status`.
- [ ] Ne pas valider Claim avant confirmation du champ permettant de persister le membre ayant effectué le Claim.
