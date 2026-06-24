/*
  Warnings:

  - You are about to drop the column `created_at` on the `DeliveryError` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DeliveryError" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_message" TEXT,
    "client_name" TEXT,
    "client_id" INTEGER,
    "packages" JSONB,
    "errors" JSONB
);
INSERT INTO "new_DeliveryError" ("client_id", "client_name", "errors", "id", "packages", "raw_message") SELECT "client_id", "client_name", "errors", "id", "packages", "raw_message" FROM "DeliveryError";
DROP TABLE "DeliveryError";
ALTER TABLE "new_DeliveryError" RENAME TO "DeliveryError";
CREATE INDEX "DeliveryError_client_id_idx" ON "DeliveryError"("client_id");
CREATE INDEX "DeliveryError_date_idx" ON "DeliveryError"("date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
