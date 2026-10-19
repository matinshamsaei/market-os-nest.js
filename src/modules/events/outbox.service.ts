import { Injectable } from '@nestjs/common';

import { OutboxEvent, Prisma } from '@prisma/client';

import { EventType } from './event-types';

export type NewOutboxEvent = {
  id: string;
  eventType: EventType;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
  availableAt?: Date;
};

@Injectable()
export class OutboxService {
  enqueue(transaction: Prisma.TransactionClient, event: NewOutboxEvent): Promise<OutboxEvent> {
    return transaction.outboxEvent
      .create({
        data: {
          id: event.id,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload,
          availableAt: event.availableAt ?? new Date(),
        },
      })
      .catch(async (error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await transaction.outboxEvent.findUnique({ where: { id: event.id } });

          if (existing) {
            return existing;
          }
        }

        throw error;
      });
  }
}
