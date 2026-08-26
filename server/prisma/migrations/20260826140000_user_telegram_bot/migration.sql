-- Bot de Telegram propio por usuario (token cifrado, como las claves de la mascota).
ALTER TABLE `User` ADD COLUMN `telegramBotTokenEnc` TEXT NULL;