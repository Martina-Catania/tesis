-- CreateTable
CREATE TABLE "Client" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Alias" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alias" TEXT NOT NULL,
    "client_id" INTEGER NOT NULL,
    CONSTRAINT "Alias_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Address" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "address" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "client_id" INTEGER NOT NULL,
    CONSTRAINT "Address_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TariffPeriod" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "label" TEXT NOT NULL,
    "valid_from" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TariffRate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "volume_min_m3" REAL NOT NULL,
    "volume_max_m3" REAL,
    "per_m3" BOOLEAN NOT NULL DEFAULT false,
    "zone" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "period_id" INTEGER NOT NULL,
    CONSTRAINT "TariffRate_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "TariffPeriod" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TariffHourlyRate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "zone" TEXT NOT NULL DEFAULT 'CABA',
    "price" REAL NOT NULL,
    "period_id" INTEGER NOT NULL,
    CONSTRAINT "TariffHourlyRate_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "TariffPeriod" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "client_id" INTEGER NOT NULL,
    "period_id" INTEGER,
    CONSTRAINT "Delivery_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Delivery_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "TariffPeriod" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Package" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "length" REAL NOT NULL,
    "width" REAL NOT NULL,
    "height" REAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "volume" REAL NOT NULL,
    "delivery_id" INTEGER NOT NULL,
    CONSTRAINT "Package_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "Delivery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeliveryError" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_message" TEXT,
    "client_name" TEXT,
    "client_id" INTEGER,
    "packages" JSONB,
    "errors" JSONB
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Alias_alias_key" ON "Alias"("alias");

-- CreateIndex
CREATE INDEX "Alias_client_id_idx" ON "Alias"("client_id");

-- CreateIndex
CREATE INDEX "Address_client_id_idx" ON "Address"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "TariffPeriod_label_key" ON "TariffPeriod"("label");

-- CreateIndex
CREATE INDEX "TariffRate_period_id_idx" ON "TariffRate"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "TariffRate_period_id_volume_min_m3_volume_max_m3_zone_key" ON "TariffRate"("period_id", "volume_min_m3", "volume_max_m3", "zone");

-- CreateIndex
CREATE INDEX "TariffHourlyRate_period_id_idx" ON "TariffHourlyRate"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "TariffHourlyRate_period_id_zone_key" ON "TariffHourlyRate"("period_id", "zone");

-- CreateIndex
CREATE INDEX "Delivery_client_id_idx" ON "Delivery"("client_id");

-- CreateIndex
CREATE INDEX "Delivery_period_id_idx" ON "Delivery"("period_id");

-- CreateIndex
CREATE INDEX "Delivery_date_idx" ON "Delivery"("date");

-- CreateIndex
CREATE INDEX "Package_delivery_id_idx" ON "Package"("delivery_id");

-- CreateIndex
CREATE INDEX "DeliveryError_client_id_idx" ON "DeliveryError"("client_id");

-- CreateIndex
CREATE INDEX "DeliveryError_created_at_idx" ON "DeliveryError"("created_at");
