-- Presence for the chat: the state each person picks, and when their client
-- was last alive. "ONLINE" is what everyone had implicitly until now.
ALTER TABLE `User` ADD COLUMN `chatStatus` VARCHAR(8) NOT NULL DEFAULT 'ONLINE';
ALTER TABLE `User` ADD COLUMN `chatSeenAt` DATETIME(3) NULL;
