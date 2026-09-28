-- CreateTable
CREATE TABLE `IntegrationVisibility` (
    `key` VARCHAR(40) NOT NULL,
    `whenUnavailable` ENUM('HIDDEN', 'COMING_SOON') NOT NULL DEFAULT 'COMING_SOON',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

