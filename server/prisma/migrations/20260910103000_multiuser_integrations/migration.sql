ALTER TABLE `SpotifySetting`
  ADD COLUMN `enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `importedFromEnvAt` DATETIME(3) NULL;

ALTER TABLE `TelegramSetting`
  ADD COLUMN `enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `importedFromEnvAt` DATETIME(3) NULL;

CREATE TABLE `GoogleOAuthSetting` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `clientId` VARCHAR(255) NOT NULL DEFAULT '',
  `clientSecretEnc` TEXT NULL,
  `importedFromEnvAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WhatsAppPlatformSetting` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `appId` VARCHAR(80) NOT NULL DEFAULT '',
  `appSecretEnc` TEXT NULL,
  `configId` VARCHAR(120) NOT NULL DEFAULT '',
  `verifyTokenEnc` TEXT NULL,
  `graphVersion` VARCHAR(20) NOT NULL DEFAULT '',
  `importedFromEnvAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TelegramBot` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `telegramBotId` VARCHAR(32) NOT NULL,
  `tokenEnc` TEXT NOT NULL,
  `username` VARCHAR(64) NULL,
  `firstName` VARCHAR(120) NULL,
  `routingTokenHash` VARCHAR(64) NOT NULL,
  `routingTokenEnc` TEXT NOT NULL,
  `webhookSecretEnc` TEXT NOT NULL,
  `businessCapable` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('PENDING', 'ACTIVE', 'REVOKED', 'ERROR') NOT NULL DEFAULT 'PENDING',
  `lastError` VARCHAR(300) NULL,
  `webhookVerifiedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `TelegramBot_telegramBotId_key` (`telegramBotId`),
  UNIQUE INDEX `TelegramBot_routingTokenHash_key` (`routingTokenHash`),
  INDEX `TelegramBot_userId_status_idx` (`userId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SpotifyConnection` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `spotifyUserIdEnc` TEXT NOT NULL,
  `spotifyUserIdHash` VARCHAR(64) NOT NULL,
  `displayNameEnc` TEXT NULL,
  `product` VARCHAR(20) NOT NULL DEFAULT 'free',
  `scopes` TEXT NOT NULL,
  `refreshTokenEnc` LONGTEXT NOT NULL,
  `selectedEmbedKind` VARCHAR(24) NULL,
  `selectedEmbedId` VARCHAR(100) NULL,
  `status` ENUM('PENDING', 'ACTIVE', 'REVOKED', 'ERROR') NOT NULL DEFAULT 'ACTIVE',
  `connectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revokedAt` DATETIME(3) NULL,
  `lastError` VARCHAR(300) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `SpotifyConnection_userId_status_idx` (`userId`, `status`),
  UNIQUE INDEX `SpotifyConnection_spotifyUserIdHash_key` (`spotifyUserIdHash`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OAuthAttempt` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `sessionId` VARCHAR(191) NOT NULL,
  `provider` ENUM('GOOGLE_MAIL', 'SPOTIFY') NOT NULL,
  `stateHash` VARCHAR(64) NOT NULL,
  `verifierEnc` TEXT NULL,
  `redirectUri` VARCHAR(500) NOT NULL,
  `returnTo` VARCHAR(500) NOT NULL DEFAULT '/',
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `OAuthAttempt_stateHash_key` (`stateHash`),
  INDEX `OAuthAttempt_userId_provider_expiresAt_idx` (`userId`, `provider`, `expiresAt`),
  INDEX `OAuthAttempt_sessionId_expiresAt_idx` (`sessionId`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `User` ADD COLUMN `defaultMailboxId` VARCHAR(191) NULL;
UPDATE `User` AS `u`
SET `u`.`defaultMailboxId` = (
  SELECT `m`.`id`
  FROM `Mailbox` AS `m`
  WHERE `m`.`userId` = `u`.`id`
  ORDER BY `m`.`createdAt` ASC
  LIMIT 1
);
CREATE UNIQUE INDEX `User_defaultMailboxId_key` ON `User` (`defaultMailboxId`);

DROP INDEX `TelegramLink_chatId_key` ON `TelegramLink`;
ALTER TABLE `TelegramLink` DROP FOREIGN KEY `TelegramLink_userId_fkey`;
DROP INDEX `TelegramLink_userId_key` ON `TelegramLink`;
ALTER TABLE `TelegramLink` ADD COLUMN `botId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `TelegramLink_botId_key` ON `TelegramLink` (`botId`);
CREATE UNIQUE INDEX `TelegramLink_botId_chatId_key` ON `TelegramLink` (`botId`, `chatId`);
CREATE INDEX `TelegramLink_userId_revokedAt_idx` ON `TelegramLink` (`userId`, `revokedAt`);

DROP INDEX `TelegramLinkNonce_userId_expiresAt_idx` ON `TelegramLinkNonce`;
ALTER TABLE `TelegramLinkNonce` ADD COLUMN `botId` VARCHAR(191) NULL;
CREATE INDEX `TelegramLinkNonce_userId_botId_expiresAt_idx` ON `TelegramLinkNonce` (`userId`, `botId`, `expiresAt`);

DROP INDEX `MessagingConnection_userId_provider_key` ON `MessagingConnection`;
ALTER TABLE `MessagingConnection` DROP FOREIGN KEY `MessagingConnection_userId_fkey`;
DROP INDEX `MessagingConnection_userId_status_idx` ON `MessagingConnection`;
ALTER TABLE `MessagingConnection` ADD COLUMN `telegramBotId` VARCHAR(191) NULL;
CREATE INDEX `MessagingConnection_userId_provider_status_idx` ON `MessagingConnection` (`userId`, `provider`, `status`);
CREATE INDEX `MessagingConnection_telegramBotId_status_idx` ON `MessagingConnection` (`telegramBotId`, `status`);

ALTER TABLE `TelegramBot` ADD CONSTRAINT `TelegramBot_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SpotifyConnection` ADD CONSTRAINT `SpotifyConnection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `OAuthAttempt` ADD CONSTRAINT `OAuthAttempt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `OAuthAttempt` ADD CONSTRAINT `OAuthAttempt_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `User` ADD CONSTRAINT `User_defaultMailboxId_fkey` FOREIGN KEY (`defaultMailboxId`) REFERENCES `Mailbox` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `TelegramLink` ADD CONSTRAINT `TelegramLink_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TelegramLink` ADD CONSTRAINT `TelegramLink_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `TelegramBot` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TelegramLinkNonce` ADD CONSTRAINT `TelegramLinkNonce_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TelegramLinkNonce` ADD CONSTRAINT `TelegramLinkNonce_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `TelegramBot` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MessagingConnection` ADD CONSTRAINT `MessagingConnection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MessagingConnection` ADD CONSTRAINT `MessagingConnection_telegramBotId_fkey` FOREIGN KEY (`telegramBotId`) REFERENCES `TelegramBot` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
