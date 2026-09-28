-- AlterTable
ALTER TABLE `Task` ADD COLUMN `dueEndDate` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Reminder` ADD COLUMN `endAt` DATETIME(3) NULL;
