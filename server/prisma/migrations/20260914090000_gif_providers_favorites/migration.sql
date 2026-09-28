-- Tenor stopped issuing keys: two providers now, one key each.
ALTER TABLE `GifSetting` ADD COLUMN `giphyKeyEnc` TEXT NULL;
ALTER TABLE `GifSetting` ADD COLUMN `klipyKeyEnc` TEXT NULL;
ALTER TABLE `GifSetting` DROP COLUMN `apiKeyEnc`;
ALTER TABLE `GifSetting` DROP COLUMN `provider`;
-- The Tenor key is useless, so nothing is carried over.
UPDATE `GifSetting` SET `enabled` = false WHERE `id` = 1;

-- Favourite GIFs, capped in the application at 50 per user.
CREATE TABLE `GifFavorite` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(16) NOT NULL,
  `url` VARCHAR(500) NOT NULL,
  `preview` VARCHAR(500) NOT NULL,
  `width` INTEGER NOT NULL,
  `height` INTEGER NOT NULL,
  `description` VARCHAR(120) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `GifFavorite_userId_url_key`(`userId`, `url`),
  INDEX `GifFavorite_userId_createdAt_idx`(`userId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `GifFavorite` ADD CONSTRAINT `GifFavorite_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
