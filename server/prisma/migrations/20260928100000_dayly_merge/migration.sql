-- Dayly 2.0: el resumen matinal vuelve a tener su tipo de notificación
-- (20260913120000_user_chat redefinió el enum sin BRIEFING).
ALTER TABLE `Notification` MODIFY `type` ENUM('TASK','EVENT','REMINDER','OVERDUE','SYSTEM','CHAT','BRIEFING') NOT NULL DEFAULT 'SYSTEM';

-- El chat de Telegram vive ahora en TelegramLink (bot propio por usuario).
ALTER TABLE `User` DROP COLUMN `telegramChatId`;
