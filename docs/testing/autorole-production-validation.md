# Protocole de validation production AutoRole

Sur une guild Discord de test : configurer un rôle membre et un rôle bot, puis
vérifier l’attribution sur arrivée humaine et bot. Vérifier séparément AutoRole
désactivé, rôle absent, rôle géré, rôle au-dessus de CIVRAT, ManageRoles absent,
membre non gérable et rôle déjà détenu. Confirmer les logs guild
`AUTOROLE_ASSIGNED`, `AUTOROLE_SKIPPED`, `AUTOROLE_ASSIGNMENT_FAILED` et la
continuité Welcome, Captcha, Invites et Security.
