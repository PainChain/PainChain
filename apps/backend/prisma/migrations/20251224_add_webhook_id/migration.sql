-- AlterTable
ALTER TABLE "connections" ADD COLUMN "webhook_id" TEXT;

-- Create unique index
CREATE UNIQUE INDEX "connections_webhook_id_key" ON "connections"("webhook_id");

-- Backfill existing rows with random webhook IDs (8 characters)
UPDATE "connections"
SET "webhook_id" = lower(substring(md5(random()::text || id::text) from 1 for 8))
WHERE "webhook_id" IS NULL;

-- Make the column required (NOT NULL)
ALTER TABLE "connections" ALTER COLUMN "webhook_id" SET NOT NULL;
