-- AlterTable
ALTER TABLE `User` ADD COLUMN `quickPinHash` VARCHAR(255) NULL,
    ADD COLUMN `quickPinEnabled` BOOLEAN NOT NULL DEFAULT false;
