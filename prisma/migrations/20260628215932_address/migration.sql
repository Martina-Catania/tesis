-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Remito" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" DATETIME NOT NULL,
    "raw_text" TEXT NOT NULL,
    "client_name" TEXT,
    "address" TEXT,
    "packages" INTEGER,
    "client_id" INTEGER,
    "address_id" INTEGER,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Remito_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Remito_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "Address" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Remito" ("address", "client_id", "client_name", "confirmed", "created_at", "date", "id", "packages", "raw_text") SELECT "address", "client_id", "client_name", "confirmed", "created_at", "date", "id", "packages", "raw_text" FROM "Remito";
DROP TABLE "Remito";
ALTER TABLE "new_Remito" RENAME TO "Remito";
CREATE INDEX "Remito_client_id_idx" ON "Remito"("client_id");
CREATE INDEX "Remito_address_id_idx" ON "Remito"("address_id");
CREATE INDEX "Remito_date_idx" ON "Remito"("date");
CREATE INDEX "Remito_confirmed_idx" ON "Remito"("confirmed");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
