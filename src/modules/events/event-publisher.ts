import { EventType } from './event-types';

export interface DomainEvent<TType extends EventType, TPayload = unknown> {
  id: string;
  type: TType;
  occurredAt: Date;
  payload: TPayload;
}

export interface DomainEventJob<TPayload = unknown> {
  id: string;
  type: EventType;
  occurredAt: string;
  payload: TPayload;
}

export interface EventPublisher {
  publish<TType extends EventType, TPayload>(event: DomainEvent<TType, TPayload>): Promise<void>;
}
