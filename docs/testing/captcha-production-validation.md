# Protocole de validation production Captcha

Configurer `/settings → Captcha` en FR puis EN : activation, Channel Select,
Role Select, Preview et ManageGuild. Publier `/captcha panel`, vérifier le salon
configuré et le bouton `civrat:v1:captcha:verify`. Tester membre non vérifié,
membre déjà vérifié, rôle absent, rôle non gérable et Captcha désactivé.

Tester le reminder avec membre humain, DMs ouverts, DMs fermés, membre vérifié et
bot. Vérifier `CAPTCHA_VERIFIED` et `CAPTCHA_VERIFICATION_FAILED` avec guildId,
memberId et roleId si disponible. Vérifier la continuité AutoRole, Welcome,
Invites, Security et Logs.
