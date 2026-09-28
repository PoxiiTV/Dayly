-- AlterTable
ALTER TABLE `User` ADD COLUMN `calendarFeedToken` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_calendarFeedToken_key` ON `User`(`calendarFeedToken`);

-- CreateTable
CREATE TABLE `RecurrenceException` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `recurrenceId` VARCHAR(191) NOT NULL,
    `skipAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RecurrenceException_recurrenceId_skipAt_key`(`recurrenceId`, `skipAt`),
    INDEX `RecurrenceException_userId_idx`(`userId`),
    INDEX `RecurrenceException_recurrenceId_idx`(`recurrenceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Passkey` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `credentialId` VARCHAR(512) NOT NULL,
    `publicKey` LONGBLOB NOT NULL,
    `counter` INTEGER NOT NULL DEFAULT 0,
    `deviceType` VARCHAR(32) NOT NULL DEFAULT 'unknown',
    `backedUp` BOOLEAN NOT NULL DEFAULT false,
    `transports` JSON NULL,
    `name` VARCHAR(80) NOT NULL DEFAULT 'Passkey',
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Passkey_credentialId_key`(`credentialId`),
    INDEX `Passkey_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasskeyChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `kind` VARCHAR(20) NOT NULL,
    `challenge` VARCHAR(255) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PasskeyChallenge_expiresAt_idx`(`expiresAt`),
    INDEX `PasskeyChallenge_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RecurrenceException` ADD CONSTRAINT `RecurrenceException_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecurrenceException` ADD CONSTRAINT `RecurrenceException_recurrenceId_fkey` FOREIGN KEY (`recurrenceId`) REFERENCES `Recurrence`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Passkey` ADD CONSTRAINT `Passkey_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasskeyChallenge` ADD CONSTRAINT `PasskeyChallenge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
