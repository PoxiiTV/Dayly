ALTER TABLE `MessagingConnection`
  ADD COLUMN `lastError` VARCHAR(300) NULL;

UPDATE `User`
SET `notifyEmail` = false
WHERE `defaultMailboxId` IS NULL;
