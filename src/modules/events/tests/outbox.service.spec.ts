import { Prisma } from '@prisma/client';

import { EventTypes } from '../event-types';
import { OutboxService } from '../outbox.service';

describe('OutboxService', () => {
  const service = new OutboxService();

  it('inserts a pending outbox row on the same transaction as the business change', async () => {
    const created = { id: 'order-paid-payment-1' };
    const transaction = {
      outboxEvent: {
        create: jest.fn().mockResolvedValue(created),
      },
    };

    await expect(
      service.enqueue(transaction as unknown as Prisma.TransactionClient, {
        id: 'order-paid-payment-1',
        eventType: EventTypes.ORDER_PAID,
        aggregateType: 'order',
        aggregateId: 'order-1',
        payload: { orderId: 'order-1', userId: 'customer-1', amount: 200 },
      }),
    ).resolves.toEqual(created);

    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'order-paid-payment-1',
        eventType: EventTypes.ORDER_PAID,
        aggregateType: 'order',
        aggregateId: 'order-1',
      }),
    });
  });
});
