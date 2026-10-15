import { EventType } from './event-types';

export interface DomainEvent<TType extends EventType, TPayload = unknown> {
  id: string;
  type: TType;
  occurredAt: Date;
  payload: TPayload;
}

export type EventHandler<TType extends EventType = EventType, TPayload = unknown> = (
  event: DomainEvent<TType, TPayload>,
) => Promise<void>;

export interface EventPublisher {
  subscribe<TType extends EventType, TPayload>(
    type: TType,
    handler: EventHandler<TType, TPayload>,
  ): void;

  publish<TType extends EventType, TPayload>(event: DomainEvent<TType, TPayload>): Promise<void>;
}
