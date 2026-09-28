-- Resumen matinal: preferencias del usuario y chat de Telegram.
ALTER TABLE `User` ADD COLUMN `briefingEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `briefingHour` INT NOT NULL DEFAULT 8,
    ADD COLUMN `briefingLastKey` VARCHAR(20) NULL,
    ADD COLUMN `telegramChatId` VARCHAR(80) NULL;