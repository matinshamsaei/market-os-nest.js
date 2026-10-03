import type { PrismaService } from '../../src/database/prisma/prisma.service';

/**
 * Enables DELETE on wallet_transactions for this DB transaction only (test cleanup).
 * Production code must never call this — ledger rows are immutable.
 */
export async function cleanupUsers(prisma: PrismaService): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.allow_wallet_ledger_mutation', 'on', true)`);
    await tx.walletTransaction.deleteMany();
    await tx.wallet.deleteMany();
    await tx.user.deleteMany();
  });
}

export async function cleanupMarketplace(prisma: PrismaService): Promise<void> {
  await prisma.processedPaymentWebhook.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.product.deleteMany();
  await cleanupUsers(prisma);
}
