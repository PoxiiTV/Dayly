ALTER TABLE `User` ADD COLUMN `notifyTelegramReminders` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `Task` ADD COLUMN `notifyTelegram` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `TelegramSetting` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `botTokenEnc` TEXT NULL,
    `botUsername` VARCHAR(64) NULL,
    `webhookSecretEnc` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TelegramLink` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(32) NOT NULL,
    `telegramUserId` VARCHAR(32) NULL,
    `username` VARCHAR(64) NULL,
    `linkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `TelegramLink_userId_key` (`userId`),
    UNIQUE INDEX `TelegramLink_chatId_key` (`chatId`),
    INDEX `TelegramLink_chatId_idx` (`chatId`),
    CONSTRAINT `TelegramLink_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TelegramLinkNonce` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `TelegramLinkNonce_tokenHash_key` (`tokenHash`),
    INDEX `TelegramLinkNonce_userId_expiresAt_idx` (`userId`, `expiresAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AlertDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(32) NOT NULL,
    `dedupeKey` VARCHAR(190) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `AlertDelivery_userId_channel_dedupeKey_key` (`userId`, `channel`, `dedupeKey`),
    INDEX `AlertDelivery_userId_channel_idx` (`userId`, `channel`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
