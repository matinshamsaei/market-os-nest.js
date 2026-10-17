-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "eventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "notifications_eventId_key" ON "notifications"("eventId");
