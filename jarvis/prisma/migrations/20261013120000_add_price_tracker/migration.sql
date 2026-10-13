-- Price tracker, server-owned.
--
-- The tracker used to live in a module-level array inside the route handler,
-- so every dev-server restart wiped it and any refresh only happened while a
-- browser tab kept the panel open. These tables make the tracked products and
-- their sample history durable, so the background tick can keep sampling with
-- no UI attached.

CREATE TABLE "PriceProduct" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "asin"          TEXT NOT NULL,
    "title"         TEXT NOT NULL,
    "imageUrl"      TEXT,
    "currency"      TEXT NOT NULL DEFAULT 'USD',
    "url"           TEXT NOT NULL,
    "targetPrice"   REAL,
    "currentPrice"  REAL,
    "lowestPrice"   REAL,
    "highestPrice"  REAL,
    "source"        TEXT NOT NULL DEFAULT 'scrape', -- keepa | scrape
    "active"        BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" DATETIME,
    "lastAlertAt"   DATETIME,
    "lastError"     TEXT,
    "checkCount"    INTEGER NOT NULL DEFAULT 0,
    "intervalMin"   INTEGER NOT NULL DEFAULT 30,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "PriceProduct_asin_key" ON "PriceProduct"("asin");
CREATE INDEX "PriceProduct_active_lastCheckedAt_idx" ON "PriceProduct"("active", "lastCheckedAt");

CREATE TABLE "PriceSample" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "price"     REAL NOT NULL,
    "takenAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "PriceSample_productId_takenAt_idx" ON "PriceSample"("productId", "takenAt");
