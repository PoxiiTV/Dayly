-- AlterTable
ALTER TABLE `MessagingConnection` ADD COLUMN `disconnectedByUserAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `ScheduledReply` ADD COLUMN `templateEnc` TEXT NULL;

-- CreateTable
CREATE TABLE `TelegramAssistantSession` (
    `id` VARCHAR(191) NOT NULL,
    `botId` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(32) NOT NULL,
    `historyEnc` LONGTEXT NULL,
    `busyUntil` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TelegramAssistantSession_botId_chatId_key`(`botId`, `chatId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TelegramAssistantSession` ADD CONSTRAINT `TelegramAssistantSession_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `TelegramBot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

