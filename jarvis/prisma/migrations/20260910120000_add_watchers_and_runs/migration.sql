-- Add browser watchers, samples, and run history
CREATE TABLE "WatchJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "workflow" TEXT NOT NULL,
    "actionsJson" TEXT,
    "variablesJson" TEXT NOT NULL DEFAULT '{}',
    "selector" TEXT,
    "extract" TEXT NOT NULL DEFAULT 'price',
    "condition" TEXT NOT NULL DEFAULT 'lt',
    "threshold" REAL,
    "expectedText" TEXT,
    "intervalMin" INTEGER NOT NULL DEFAULT 60,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastValue" TEXT,
    "lastCheckedAt" DATETIME,
    "lastAlertAt" DATETIME,
    "checkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "WatchJob_active_lastCheckedAt_idx" ON "WatchJob"("active", "lastCheckedAt");

CREATE TABLE "WatchSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchId" TEXT NOT NULL,
    "value" REAL,
    "text" TEXT,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "WatchSample_watchId_takenAt_idx" ON "WatchSample"("watchId", "takenAt");

CREATE TABLE "BrowserRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflow" TEXT NOT NULL,
    "goal" TEXT,
    "variables" TEXT NOT NULL DEFAULT '{}',
    "success" BOOLEAN NOT NULL,
    "summary" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "screenshotPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "BrowserRun_createdAt_idx" ON "BrowserRun"("createdAt");
