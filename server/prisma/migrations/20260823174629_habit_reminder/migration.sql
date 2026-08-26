-- AlterTable
ALTER TABLE `Habit` ADD COLUMN `lastReminderKey` VARCHAR(20) NULL,
    ADD COLUMN `reminderMinuteOfDay` INTEGER NULL;
