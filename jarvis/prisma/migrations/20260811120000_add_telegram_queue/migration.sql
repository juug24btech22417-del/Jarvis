-- CreateTable
CREATE TABLE "TelegramMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" BIGINT NOT NULL,
    "telegramMsgId" BIGINT,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "replyToId" TEXT,
    "metadata" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "TelegramMessage_chatId_status_idx" ON "TelegramMessage"("chatId", "status");

-- CreateIndex
CREATE INDEX "TelegramMessage_status_createdAt_idx" ON "TelegramMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TelegramMessage_direction_createdAt_idx" ON "TelegramMessage"("direction", "createdAt");
