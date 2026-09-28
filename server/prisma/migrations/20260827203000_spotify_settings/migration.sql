CREATE TABLE `SpotifySetting` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `clientId` VARCHAR(80) NOT NULL DEFAULT '',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
