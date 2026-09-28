-- Chat between users of this instance: friend links, messages and buzzes.

ALTER TABLE `User`
  ADD COLUMN `friendCode` VARCHAR(12) NULL,
  ADD COLUMN `friendCodeUpdatedAt` DATETIME(3) NULL,
  ADD COLUMN `chatDiscoverableByEmail` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `chatBuzzEnabled` BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX `User_friendCode_key` ON `User` (`friendCode`);

ALTER TABLE `Notification`
  MODIFY `type` ENUM('TASK','EVENT','REMINDER','OVERDUE','SYSTEM','CHAT') NOT NULL DEFAULT 'SYSTEM';

CREATE TABLE `FriendLink` (
  `id` VARCHAR(191) NOT NULL,
  `userAId` VARCHAR(191) NOT NULL,
  `userBId` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING','ACCEPTED','DECLINED','BLOCKED') NOT NULL DEFAULT 'PENDING',
  `requestedById` VARCHAR(191) NOT NULL,
  `blockedById` VARCHAR(191) NULL,
  `acceptedAt` DATETIME(3) NULL,
  `declinedAt` DATETIME(3) NULL,
  `lastMessageAt` DATETIME(3) NULL,
  `aUnreadCount` INTEGER NOT NULL DEFAULT 0,
  `bUnreadCount` INTEGER NOT NULL DEFAULT 0,
  `aLastReadAt` DATETIME(3) NULL,
  `bLastReadAt` DATETIME(3) NULL,
  `aLastBuzzAt` DATETIME(3) NULL,
  `bLastBuzzAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `FriendLink_userAId_userBId_key` (`userAId`, `userBId`),
  INDEX `FriendLink_userAId_status_lastMessageAt_idx` (`userAId`, `status`, `lastMessageAt`),
  INDEX `FriendLink_userBId_status_lastMessageAt_idx` (`userBId`, `status`, `lastMessageAt`),
  INDEX `FriendLink_requestedById_createdAt_idx` (`requestedById`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ChatMessage` (
  `id` VARCHAR(191) NOT NULL,
  `linkId` VARCHAR(191) NOT NULL,
  `senderId` VARCHAR(191) NOT NULL,
  `kind` ENUM('TEXT','BUZZ','GIF') NOT NULL DEFAULT 'TEXT',
  `bodyEnc` LONGTEXT NULL,
  `attachmentEnc` LONGTEXT NULL,
  `clientMsgId` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ChatMessage_senderId_clientMsgId_key` (`senderId`, `clientMsgId`),
  INDEX `ChatMessage_linkId_createdAt_idx` (`linkId`, `createdAt`),
  INDEX `ChatMessage_senderId_createdAt_idx` (`senderId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FriendLink` ADD CONSTRAINT `FriendLink_userAId_fkey` FOREIGN KEY (`userAId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `FriendLink` ADD CONSTRAINT `FriendLink_userBId_fkey` FOREIGN KEY (`userBId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ChatMessage` ADD CONSTRAINT `ChatMessage_linkId_fkey` FOREIGN KEY (`linkId`) REFERENCES `FriendLink` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
