-- CreateTable
CREATE TABLE "Remito" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" DATETIME NOT NULL,
    "raw_text" TEXT NOT NULL,
    "client_name" TEXT,
    "address" TEXT,
    "packages" INTEGER,
    "client_id" INTEGER,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Remito_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RemitoError" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" DATETIME NOT NULL,
    "raw_text" TEXT,
    "client_name" TEXT,
    "address" TEXT,
    "packages" INTEGER,
    "errors" JSONB NOT NULL
);

-- CreateIndex
CREATE INDEX "Remito_client_id_idx" ON "Remito"("client_id");

-- CreateIndex
CREATE INDEX "Remito_date_idx" ON "Remito"("date");

-- CreateIndex
CREATE INDEX "Remito_confirmed_idx" ON "Remito"("confirmed");

-- CreateIndex
CREATE INDEX "RemitoError_date_idx" ON "RemitoError"("date");
