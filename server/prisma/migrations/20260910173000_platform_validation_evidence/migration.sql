ALTER TABLE `SpotifySetting`
  ADD COLUMN `validatedAt` DATETIME(3) NULL;

ALTER TABLE `GoogleOAuthSetting`
  ADD COLUMN `validatedAt` DATETIME(3) NULL;

ALTER TABLE `WhatsAppPlatformSetting`
  ADD COLUMN `validatedAt` DATETIME(3) NULL;

UPDATE `SpotifySetting`
SET `validatedAt` = CURRENT_TIMESTAMP(3)
WHERE EXISTS (
  SELECT 1 FROM `SpotifyConnection`
  WHERE `SpotifyConnection`.`status` = 'ACTIVE'
);

UPDATE `GoogleOAuthSetting`
SET `validatedAt` = CURRENT_TIMESTAMP(3)
WHERE EXISTS (
  SELECT 1 FROM `Mailbox`
  WHERE `Mailbox`.`authType` = 'google'
    AND `Mailbox`.`oauthRefreshEnc` IS NOT NULL
);

UPDATE `WhatsAppPlatformSetting`
SET `validatedAt` = CURRENT_TIMESTAMP(3)
WHERE EXISTS (
  SELECT 1 FROM `MessagingConnection`
  WHERE `MessagingConnection`.`provider` = 'WHATSAPP'
    AND `MessagingConnection`.`status` = 'ACTIVE'
);
