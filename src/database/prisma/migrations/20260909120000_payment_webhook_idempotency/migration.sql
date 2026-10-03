-- AlterTable
ALTER TABLE "payments" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "payments" ADD COLUMN "lastError" TEXT;

-- CreateTable
CREATE TABLE "processed_payment_webhooks" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProviderType" NOT NULL,
    "eventId" TEXT NOT NULL,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_payment_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "processed_payment_webhooks_provider_eventId_key" ON "processed_payment_webhooks"("provider", "eventId");

-- CreateIndex
CREATE INDEX "processed_payment_webhooks_paymentId_idx" ON "processed_payment_webhooks"("paymentId");

-- AddForeignKey
ALTER TABLE "processed_payment_webhooks" ADD CONSTRAINT "processed_payment_webhooks_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
