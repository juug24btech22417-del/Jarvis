-- CreateTable
-- PendingEmail: outbound email queue with a 30-second cancel window.
-- The dispatcher (lib/composio/emailDispatcher) ticks every 5s, claims
-- rows where status="pending" AND fireAt<=now, and sends via composio.
CREATE TABLE "PendingEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "toEmail" TEXT NOT NULL,
    "toName" TEXT,
    "body" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "requestRaw" TEXT NOT NULL,
    "chatId" BIGINT,
    "callbackMessageId" BIGINT,
    "fireAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "connectedAccountId" TEXT NOT NULL,
    "sentMessageId" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "PendingEmail_status_fireAt_idx" ON "PendingEmail"("status", "fireAt");

-- CreateIndex
CREATE INDEX "PendingEmail_chatId_status_idx" ON "PendingEmail"("chatId", "status");
