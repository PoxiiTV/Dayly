CREATE TABLE `SmtpSetting` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `host` VARCHAR(255) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 587,
    `username` VARCHAR(190) NOT NULL,
    `passwordEnc` TEXT NULL,
    `fromAddress` VARCHAR(255) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
