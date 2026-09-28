CREATE TABLE `TaskAlertSnooze` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `occurrenceAt` DATETIME(3) NOT NULL,
    `snoozedUntil` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `TaskAlertSnooze_taskId_occurrenceAt_key` (`taskId`, `occurrenceAt`),
    INDEX `TaskAlertSnooze_userId_snoozedUntil_idx` (`userId`, `snoozedUntil`),
    CONSTRAINT `TaskAlertSnooze_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `TaskAlertSnooze_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
