-- Files sent through the chat: relayed, encrypted and short-lived.
ALTER TABLE `ChatMessage` MODIFY `kind` ENUM('TEXT', 'BUZZ', 'GIF', 'FILE') NOT NULL DEFAULT 'TEXT';

CREATE TABLE `ChatTransfer` (
  `id` VARCHAR(191) NOT NULL,
  `linkId` VARCHAR(191) NOT NULL,
  `senderId` VARCHAR(191) NOT NULL,
  `filename` VARCHAR(180) NOT NULL,
  `mimeType` VARCHAR(120) NOT NULL,
  `sizeBytes` INTEGER NOT NULL,
  `storageKey` VARCHAR(200) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NOT NULL,
  INDEX `ChatTransfer_expiresAt_idx`(`expiresAt`),
  INDEX `ChatTransfer_linkId_createdAt_idx`(`linkId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ChatTransfer` ADD CONSTRAINT `ChatTransfer_linkId_fkey`
  FOREIGN KEY (`linkId`) REFERENCES `FriendLink`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
