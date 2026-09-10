-- Companion care: follow-up threads, mood samples, presence log.

-- CreateTable
CREATE TABLE "FollowUpThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "detail" TEXT,
    "kind" TEXT NOT NULL,
    "dueAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'open',
    "askedCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MoodSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mood" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "energy" TEXT,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PresenceLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionKey" TEXT NOT NULL,
    "gapHours" REAL NOT NULL,
    "lastSeenAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PresenceLog_sessionKey_key" ON "PresenceLog"("sessionKey");

-- CreateIndex
CREATE INDEX "FollowUpThread_status_dueAt_idx" ON "FollowUpThread"("status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUpThread_kind_status_idx" ON "FollowUpThread"("kind", "status");

-- CreateIndex
CREATE INDEX "MoodSample_createdAt_idx" ON "MoodSample"("createdAt");

-- CreateIndex
CREATE INDEX "PresenceLog_lastSeenAt_idx" ON "PresenceLog"("lastSeenAt");
