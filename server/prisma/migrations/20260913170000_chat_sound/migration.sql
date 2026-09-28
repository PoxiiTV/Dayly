-- Per-user tone for incoming chat messages.
ALTER TABLE `User` ADD COLUMN `chatSound` VARCHAR(24) NOT NULL DEFAULT 'soundchat';
