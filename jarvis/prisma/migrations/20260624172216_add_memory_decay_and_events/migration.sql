-- Tier 1A: Forgetting curve + reinforcement on Entity
-- Tier 1A: Decay fields on flat Memory table
-- Tier 1C: MemoryEvent table for pattern-of-life observability

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Entity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "metadata" TEXT,
    "strength" REAL NOT NULL DEFAULT 1.0,
    "baseStrength" REAL NOT NULL DEFAULT 1.0,
    "lastAccessed" DATETIME,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "cue" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Entity" ("accessCount", "archived", "createdAt", "cue", "description", "id", "lastAccessed", "metadata", "name", "pinned", "strength", "type", "updatedAt") SELECT "accessCount", "archived", "createdAt", "cue", "description", "id", "lastAccessed", "metadata", "name", "pinned", "strength", "type", "updatedAt" FROM "Entity";
DROP TABLE "Entity";
ALTER TABLE "new_Entity" RENAME TO "Entity";
CREATE INDEX "Entity_type_idx" ON "Entity"("type");
CREATE INDEX "Entity_name_idx" ON "Entity"("name");
CREATE INDEX "Entity_archived_idx" ON "Entity"("archived");
CREATE INDEX "Entity_pinned_idx" ON "Entity"("pinned");

-- Redefine Memory (add decay + linkedEntityId)
CREATE TABLE "new_Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "strength" REAL NOT NULL DEFAULT 1.0,
    "lastAccessed" DATETIME,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "linkedEntityId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Memory" ("category", "content", "createdAt", "id", "lastAccessed", "linkedEntityId", "pinned", "source", "strength", "updatedAt")
SELECT "category", "content", "createdAt", "id", "lastAccessed", "linkedEntityId", "pinned", "source", "strength", "updatedAt" FROM "Memory";
DROP TABLE "Memory";
ALTER TABLE "new_Memory" RENAME TO "Memory";
CREATE INDEX "Memory_category_idx" ON "Memory"("category");
CREATE INDEX "Memory_pinned_idx" ON "Memory"("pinned");
CREATE INDEX "Memory_linkedEntityId_idx" ON "Memory"("linkedEntityId");

-- CreateTable: MemoryEvent
CREATE TABLE "MemoryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MemoryEvent_kind_createdAt_idx" ON "MemoryEvent"("kind", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;