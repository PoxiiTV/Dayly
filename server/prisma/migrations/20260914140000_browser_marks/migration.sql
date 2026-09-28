-- Bookmarks and history for the built-in browser. The address travels
-- encrypted; the hash beside it is an HMAC, so a repeated page can be found
-- without keeping a readable trail of anyone's browsing.
CREATE TABLE `BrowserBookmark` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `urlHash` VARCHAR(64) NOT NULL,
  `urlEnc` TEXT NOT NULL,
  `titleEnc` TEXT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `BrowserBookmark_userId_urlHash_key`(`userId`, `urlHash`),
  INDEX `BrowserBookmark_userId_sortOrder_idx`(`userId`, `sortOrder`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BrowserVisit` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `urlHash` VARCHAR(64) NOT NULL,
  `urlEnc` TEXT NOT NULL,
  `titleEnc` TEXT NULL,
  `visits` INTEGER NOT NULL DEFAULT 1,
  `visitedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `BrowserVisit_userId_urlHash_key`(`userId`, `urlHash`),
  INDEX `BrowserVisit_userId_visitedAt_idx`(`userId`, `visitedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BrowserBookmark`
  ADD CONSTRAINT `BrowserBookmark_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `BrowserVisit`
  ADD CONSTRAINT `BrowserVisit_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `User`
  ADD COLUMN `browserHistoryEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `browserHomeUrl` VARCHAR(300) NULL;
