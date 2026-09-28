-- Subscriptions get their own tag vocabulary, separate from the task tags.
-- The order matters: the new tables are created and filled BEFORE the old
-- bridge is dropped, so any subscription already tagged keeps its labels.

-- CreateTable
CREATE TABLE `SubscriptionTag` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `color` VARCHAR(20) NULL DEFAULT '#3b82f6',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SubscriptionTag_userId_idx`(`userId`),
    UNIQUE INDEX `SubscriptionTag_userId_name_key`(`userId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_SubscriptionTagLinks` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_SubscriptionTagLinks_AB_unique`(`A`, `B`),
    INDEX `_SubscriptionTagLinks_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SubscriptionTag` ADD CONSTRAINT `SubscriptionTag_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_SubscriptionTagLinks` ADD CONSTRAINT `_SubscriptionTagLinks_A_fkey` FOREIGN KEY (`A`) REFERENCES `Subscription`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_SubscriptionTagLinks` ADD CONSTRAINT `_SubscriptionTagLinks_B_fkey` FOREIGN KEY (`B`) REFERENCES `SubscriptionTag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over every task tag that was in use by a subscription. Ids are 32 hex
-- characters (no dashes) so they still match the alphanumeric id validator.
-- In `_SubscriptionTags`, A is the Subscription and B is the Tag.
INSERT INTO `SubscriptionTag` (`id`, `userId`, `name`, `color`, `createdAt`)
SELECT REPLACE(UUID(), '-', ''), `t`.`userId`, `t`.`name`, `t`.`color`, NOW(3)
FROM `Tag` `t`
WHERE EXISTS (SELECT 1 FROM `_SubscriptionTags` `st` WHERE `st`.`B` = `t`.`id`);

INSERT INTO `_SubscriptionTagLinks` (`A`, `B`)
SELECT `st`.`A`, `nt`.`id`
FROM `_SubscriptionTags` `st`
JOIN `Tag` `t` ON `t`.`id` = `st`.`B`
JOIN `SubscriptionTag` `nt` ON `nt`.`userId` = `t`.`userId` AND `nt`.`name` = `t`.`name`;

-- DropForeignKey
ALTER TABLE `_SubscriptionTags` DROP FOREIGN KEY `_SubscriptionTags_A_fkey`;

-- DropForeignKey
ALTER TABLE `_SubscriptionTags` DROP FOREIGN KEY `_SubscriptionTags_B_fkey`;

-- DropTable
DROP TABLE `_SubscriptionTags`;
