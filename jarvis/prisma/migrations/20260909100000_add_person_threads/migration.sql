-- Companion care: people threads.

-- CreateTable
CREATE TABLE "PersonThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "relation" TEXT,
    "mentionCount" INTEGER NOT NULL DEFAULT 1,
    "lastMention" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonThread_name_key" ON "PersonThread"("name");

-- CreateIndex
CREATE INDEX "PersonThread_lastMention_idx" ON "PersonThread"("lastMention");
