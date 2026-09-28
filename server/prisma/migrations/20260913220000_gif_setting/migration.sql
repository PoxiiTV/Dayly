-- GIF search provider, with its key encrypted at rest.
CREATE TABLE `GifSetting` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `provider` VARCHAR(16) NOT NULL DEFAULT 'tenor',
  `apiKeyEnc` TEXT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
