-- Per-side background for each conversation.
ALTER TABLE `FriendLink` ADD COLUMN `aWallpaper` VARCHAR(24) NULL;
ALTER TABLE `FriendLink` ADD COLUMN `bWallpaper` VARCHAR(24) NULL;
