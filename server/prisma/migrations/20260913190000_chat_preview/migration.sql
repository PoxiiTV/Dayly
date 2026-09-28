-- Preview of the last message, so the conversation list needs no join.
ALTER TABLE `FriendLink` ADD COLUMN `lastMessageEnc` TEXT NULL;
ALTER TABLE `FriendLink` ADD COLUMN `lastMessageSenderId` VARCHAR(191) NULL;
