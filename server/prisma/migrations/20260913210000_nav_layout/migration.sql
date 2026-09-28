-- Sidebar layout travels with the account.
ALTER TABLE `User` ADD COLUMN `navLayout` JSON NULL;
