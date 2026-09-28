-- Group conversations. A message (and a file transfer) now belongs either to a
-- FriendLink or to a ChatGroup, so both foreign keys become nullable.
CREATE TABLE `ChatGroup` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(60) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `lastMessageAt` DATETIME(3) NULL,
  `lastMessageEnc` TEXT NULL,
  `lastMessageSenderId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ChatGroup_ownerId_idx`(`ownerId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ChatGroupMember` (
  `id` VARCHAR(191) NOT NULL,
  `groupId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `unreadCount` INTEGER NOT NULL DEFAULT 0,
  `lastReadAt` DATETIME(3) NULL,
  `clearedAt` DATETIME(3) NULL,
  `muted` BOOLEAN NOT NULL DEFAULT false,
  `wallpaper` VARCHAR(24) NULL,
  `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ChatGroupMember_groupId_userId_key`(`groupId`, `userId`),
  INDEX `ChatGroupMember_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ChatGroupMember`
  ADD CONSTRAINT `ChatGroupMember_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `ChatGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ChatGroupMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ChatMessage`
  MODIFY `linkId` VARCHAR(191) NULL,
  ADD COLUMN `groupId` VARCHAR(191) NULL,
  ADD INDEX `ChatMessage_groupId_createdAt_idx`(`groupId`, `createdAt`),
  ADD CONSTRAINT `ChatMessage_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `ChatGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ChatTransfer`
  MODIFY `linkId` VARCHAR(191) NULL,
  ADD COLUMN `groupId` VARCHAR(191) NULL,
  ADD INDEX `ChatTransfer_groupId_createdAt_idx`(`groupId`, `createdAt`);
