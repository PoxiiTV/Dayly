-- AlterTable
ALTER TABLE `User` ADD COLUMN `mascotEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `mascotProvider` VARCHAR(32) NOT NULL DEFAULT 'opencode',
    ADD COLUMN `mascotModel` VARCHAR(80) NOT NULL DEFAULT 'auto-free',
    ADD COLUMN `mascotBaseUrl` VARCHAR(300) NULL,
    ADD COLUMN `mascotApiKeyEnc` TEXT NULL;
