import { Injectable } from '@nestjs/common';

import { DomainEvent, EventHandler, EventPublisher } from './event-publisher';
import { EventType } from './event-types';

@Injectable()
export class EventBus implements EventPublisher {
  private readonly handlers = new Map<EventType, EventHandler[]>();

  subscribe<TType extends EventType, TPayload>(
    type: TType,
    handler: EventHandler<TType, TPayload>,
  ): void {
    const handlers = this.handlers.get(type) ?? [];
    handlers.push(handler as EventHandler);
    this.handlers.set(type, handlers);
  }

  async publish<TType extends EventType, TPayload>(
    event: DomainEvent<TType, TPayload>,
  ): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];

    for (const handler of handlers) {
      await handler(event as DomainEvent<EventType, TPayload>);
    }
  }
}
