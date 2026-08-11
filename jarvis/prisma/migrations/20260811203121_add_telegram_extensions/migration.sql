-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" BIGINT NOT NULL,
    "fireAt" DATETIME NOT NULL,
    "text" TEXT NOT NULL,
    "createdFromMsgId" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dispatchedAt" DATETIME,
    "error" TEXT,
    "idempotencyKey" TEXT,
    "quietStartMin" INTEGER NOT NULL DEFAULT 1380,
    "quietEndMin" INTEGER NOT NULL DEFAULT 420,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserLocation" (
    "chatId" BIGINT NOT NULL PRIMARY KEY,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "accuracyM" REAL,
    "livePeriodSeconds" INTEGER,
    "heading" REAL,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PendingOsAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" BIGINT NOT NULL,
    "action" TEXT NOT NULL,
    "params" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Reminder_status_fireAt_idx" ON "Reminder"("status", "fireAt");

-- CreateIndex
CREATE INDEX "Reminder_chatId_fireAt_idx" ON "Reminder"("chatId", "fireAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_chatId_idempotencyKey_key" ON "Reminder"("chatId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PendingOsAction_chatId_status_idx" ON "PendingOsAction"("chatId", "status");

-- CreateIndex
CREATE INDEX "PendingOsAction_expiresAt_idx" ON "PendingOsAction"("expiresAt");
