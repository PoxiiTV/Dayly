ALTER TABLE `Reminder`
  MODIFY `targetType` ENUM('TASK', 'EVENT', 'NOTE', 'GOAL', 'CONVERSATION', 'NONE') NOT NULL DEFAULT 'NONE',
  ADD COLUMN `conversationId` VARCHAR(191) NULL,
  ADD COLUMN `messageId` VARCHAR(191) NULL;

CREATE TABLE `MessagingConnection` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `provider` ENUM('TELEGRAM', 'WHATSAPP') NOT NULL,
  `status` ENUM('PENDING', 'ACTIVE', 'REVOKED', 'ERROR') NOT NULL DEFAULT 'PENDING',
  `externalAccountIdEnc` TEXT NOT NULL,
  `externalAccountIdHash` VARCHAR(64) NOT NULL,
  `ownerExternalIdEnc` TEXT NULL,
  `ownerExternalIdHash` VARCHAR(64) NULL,
  `labelEnc` TEXT NULL,
  `credentialEnc` LONGTEXT NULL,
  `providerDataEnc` LONGTEXT NULL,
  `capabilities` JSON NOT NULL,
  `connectedAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `lastWebhookAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `MessagingConnection_userId_provider_key` (`userId`, `provider`),
  UNIQUE INDEX `MessagingConnection_provider_externalAccountIdHash_key` (`provider`, `externalAccountIdHash`),
  INDEX `MessagingConnection_userId_status_idx` (`userId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Conversation` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `connectionId` VARCHAR(191) NOT NULL,
  `externalChatIdEnc` TEXT NOT NULL,
  `externalChatIdHash` VARCHAR(64) NOT NULL,
  `displayNameEnc` TEXT NULL,
  `lastMessageAt` DATETIME(3) NULL,
  `lastInboundAt` DATETIME(3) NULL,
  `lastOutboundAt` DATETIME(3) NULL,
  `lastActivityAt` DATETIME(3) NULL,
  `unreadCount` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `Conversation_connectionId_externalChatIdHash_key` (`connectionId`, `externalChatIdHash`),
  INDEX `Conversation_userId_lastActivityAt_idx` (`userId`, `lastActivityAt`),
  INDEX `Conversation_userId_unreadCount_idx` (`userId`, `unreadCount`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ChannelMessage` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `providerMessageIdEnc` TEXT NULL,
  `providerMessageIdHash` VARCHAR(64) NULL,
  `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL,
  `origin` ENUM('CUSTOMER', 'OWNER_DEVICE', 'API') NOT NULL,
  `kind` ENUM('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'LOCATION', 'CONTACT', 'STICKER', 'UNKNOWN') NOT NULL DEFAULT 'TEXT',
  `bodyEnc` LONGTEXT NULL,
  `attachmentEnc` LONGTEXT NULL,
  `mediaHandleEnc` LONGTEXT NULL,
  `deliveryStatus` ENUM('RECEIVED', 'PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN') NOT NULL DEFAULT 'RECEIVED',
  `providerSentAt` DATETIME(3) NOT NULL,
  `editedAt` DATETIME(3) NULL,
  `providerDeletedAt` DATETIME(3) NULL,
  `replyToMessageId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ChannelMessage_conversationId_providerMessageIdHash_key` (`conversationId`, `providerMessageIdHash`),
  INDEX `ChannelMessage_userId_providerSentAt_idx` (`userId`, `providerSentAt`),
  INDEX `ChannelMessage_conversationId_providerSentAt_idx` (`conversationId`, `providerSentAt`),
  INDEX `ChannelMessage_replyToMessageId_idx` (`replyToMessageId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScheduledReply` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `quotedMessageId` VARCHAR(191) NULL,
  `deliveredMessageId` VARCHAR(191) NULL,
  `bodyEnc` LONGTEXT NOT NULL,
  `sendAt` DATETIME(3) NOT NULL,
  `timezone` VARCHAR(80) NOT NULL,
  `status` ENUM('AWAITING_CONFIRMATION', 'SCHEDULED', 'PROCESSING', 'SENT', 'PAUSED', 'REQUIRES_ATTENTION', 'FAILED', 'CANCELED') NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
  `draftVersion` INTEGER NOT NULL DEFAULT 1,
  `confirmedVersion` INTEGER NULL,
  `pauseOnActivity` BOOLEAN NOT NULL DEFAULT true,
  `activitySnapshotAt` DATETIME(3) NULL,
  `authorizedAt` DATETIME(3) NULL,
  `confirmationExpiresAt` DATETIME(3) NULL,
  `idempotencyKeyHash` VARCHAR(64) NULL,
  `claimTokenHash` VARCHAR(64) NULL,
  `leaseUntil` DATETIME(3) NULL,
  `attemptStartedAt` DATETIME(3) NULL,
  `lastErrorCode` VARCHAR(80) NULL,
  `lastErrorEnc` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ScheduledReply_deliveredMessageId_key` (`deliveredMessageId`),
  UNIQUE INDEX `ScheduledReply_idempotencyKeyHash_key` (`idempotencyKeyHash`),
  INDEX `ScheduledReply_userId_status_idx` (`userId`, `status`),
  INDEX `ScheduledReply_status_sendAt_idx` (`status`, `sendAt`),
  INDEX `ScheduledReply_conversationId_status_idx` (`conversationId`, `status`),
  INDEX `ScheduledReply_quotedMessageId_idx` (`quotedMessageId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WebhookReceipt` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NULL,
  `connectionId` VARCHAR(191) NULL,
  `provider` ENUM('TELEGRAM', 'WHATSAPP') NOT NULL,
  `eventKeyHash` VARCHAR(64) NOT NULL,
  `payloadEnc` LONGTEXT NOT NULL,
  `status` ENUM('RECEIVED', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
  `errorCode` VARCHAR(80) NULL,
  `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `processedAt` DATETIME(3) NULL,

  UNIQUE INDEX `WebhookReceipt_eventKeyHash_key` (`eventKeyHash`),
  INDEX `WebhookReceipt_provider_receivedAt_idx` (`provider`, `receivedAt`),
  INDEX `WebhookReceipt_userId_receivedAt_idx` (`userId`, `receivedAt`),
  INDEX `WebhookReceipt_connectionId_idx` (`connectionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Reminder_userId_conversationId_idx` ON `Reminder` (`userId`, `conversationId`);
CREATE INDEX `Reminder_messageId_idx` ON `Reminder` (`messageId`);

ALTER TABLE `MessagingConnection` ADD CONSTRAINT `MessagingConnection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `MessagingConnection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ChannelMessage` ADD CONSTRAINT `ChannelMessage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ChannelMessage` ADD CONSTRAINT `ChannelMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ChannelMessage` ADD CONSTRAINT `ChannelMessage_replyToMessageId_fkey` FOREIGN KEY (`replyToMessageId`) REFERENCES `ChannelMessage` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ScheduledReply` ADD CONSTRAINT `ScheduledReply_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ScheduledReply` ADD CONSTRAINT `ScheduledReply_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ScheduledReply` ADD CONSTRAINT `ScheduledReply_quotedMessageId_fkey` FOREIGN KEY (`quotedMessageId`) REFERENCES `ChannelMessage` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ScheduledReply` ADD CONSTRAINT `ScheduledReply_deliveredMessageId_fkey` FOREIGN KEY (`deliveredMessageId`) REFERENCES `ChannelMessage` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `WebhookReceipt` ADD CONSTRAINT `WebhookReceipt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WebhookReceipt` ADD CONSTRAINT `WebhookReceipt_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `MessagingConnection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Reminder` ADD CONSTRAINT `Reminder_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Reminder` ADD CONSTRAINT `Reminder_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `ChannelMessage` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
