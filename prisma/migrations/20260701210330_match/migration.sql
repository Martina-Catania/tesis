/*
  Warnings:

  - You are about to drop the `Delivery` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DeliveryError` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `delivery_id` on the `Package` table. All the data in the column will be lost.
  - Added the required column `measurement_data_id` to the `Package` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Delivery_date_idx";

-- DropIndex
DROP INDEX "Delivery_period_id_idx";

-- DropIndex
DROP INDEX "Delivery_client_id_idx";

-- DropIndex
DROP INDEX "DeliveryError_date_idx";

-- DropIndex
DROP INDEX "DeliveryError_client_id_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Delivery";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "DeliveryError";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "MeasurementData" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "client_id" INTEGER NOT NULL,
    "period_id" INTEGER,
    CONSTRAINT "MeasurementData_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeasurementData_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "TariffPeriod" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MeasurementDataError" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_message" TEXT,
    "client_name" TEXT,
    "client_id" INTEGER,
    "packages" JSONB,
    "errors" JSONB
);

-- CreateTable
CREATE TABLE "match_run_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "last_run_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "delivery_match" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "measurement_data_id" INTEGER NOT NULL,
    "remito_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "delivery_date" DATETIME NOT NULL,
    "measured_packages" INTEGER NOT NULL,
    "remito_packages" INTEGER NOT NULL,
    CONSTRAINT "delivery_match_measurement_data_id_fkey" FOREIGN KEY ("measurement_data_id") REFERENCES "MeasurementData" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "delivery_match_remito_id_fkey" FOREIGN KEY ("remito_id") REFERENCES "Remito" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "delivery_match_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "delivery_error" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivery_date" DATETIME NOT NULL,
    "client_id" INTEGER,
    "client_name" TEXT,
    "measurement_data_id" INTEGER,
    "measurement_data_error_id" INTEGER,
    "remito_id" INTEGER,
    "remito_error_id" INTEGER,
    "measured_packages" INTEGER,
    "remito_packages" INTEGER,
    "errors" JSONB NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Package" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "length" REAL NOT NULL,
    "width" REAL NOT NULL,
    "height" REAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "volume" REAL NOT NULL,
    "measurement_data_id" INTEGER NOT NULL,
    CONSTRAINT "Package_measurement_data_id_fkey" FOREIGN KEY ("measurement_data_id") REFERENCES "MeasurementData" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Package" ("height", "id", "length", "quantity", "volume", "width") SELECT "height", "id", "length", "quantity", "volume", "width" FROM "Package";
DROP TABLE "Package";
ALTER TABLE "new_Package" RENAME TO "Package";
CREATE INDEX "Package_measurement_data_id_idx" ON "Package"("measurement_data_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "MeasurementData_client_id_idx" ON "MeasurementData"("client_id");

-- CreateIndex
CREATE INDEX "MeasurementData_period_id_idx" ON "MeasurementData"("period_id");

-- CreateIndex
CREATE INDEX "MeasurementData_date_idx" ON "MeasurementData"("date");

-- CreateIndex
CREATE INDEX "MeasurementDataError_client_id_idx" ON "MeasurementDataError"("client_id");

-- CreateIndex
CREATE INDEX "MeasurementDataError_date_idx" ON "MeasurementDataError"("date");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_match_measurement_data_id_key" ON "delivery_match"("measurement_data_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_match_remito_id_key" ON "delivery_match"("remito_id");

-- CreateIndex
CREATE INDEX "delivery_match_client_id_idx" ON "delivery_match"("client_id");

-- CreateIndex
CREATE INDEX "delivery_match_delivery_date_idx" ON "delivery_match"("delivery_date");

-- CreateIndex
CREATE INDEX "delivery_error_delivery_date_idx" ON "delivery_error"("delivery_date");

-- CreateIndex
CREATE INDEX "delivery_error_client_id_idx" ON "delivery_error"("client_id");
