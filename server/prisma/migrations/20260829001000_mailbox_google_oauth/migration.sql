ALTER TABLE `Mailbox` ADD COLUMN `authType` VARCHAR(20) NOT NULL DEFAULT 'password';
ALTER TABLE `Mailbox` MODIFY `passwordEnc` TEXT NULL;
ALTER TABLE `Mailbox` ADD COLUMN `oauthRefreshEnc` TEXT NULL;
