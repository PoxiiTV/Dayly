-- Per-side mute and "clear conversation" mark.
ALTER TABLE `FriendLink` ADD COLUMN `aMuted` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `FriendLink` ADD COLUMN `bMuted` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `FriendLink` ADD COLUMN `aClearedAt` DATETIME(3) NULL;
ALTER TABLE `FriendLink` ADD COLUMN `bClearedAt` DATETIME(3) NULL;
