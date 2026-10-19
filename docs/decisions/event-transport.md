# Event transport decision

MarketOS should keep the Postgres transactional outbox and the in-process worker. Kafka and RabbitMQ are not justified for the current system.

## Current shape

One NestJS application owns orders, payments, and notifications. Business transactions write an `outbox_events` row in the same database transaction as the order or payment change. A worker claims rows with `FOR UPDATE SKIP LOCKED`, publishes them onto the existing Redis queue, and notifications are delivered from that queue. Failed publishes stay in Postgres with an attempt count, a next-available time, and a dead state after five attempts.

## Evaluation

**Traffic and volume.** Checkout, payment webhooks, and cancellations are the only producers. Each action writes one outbox row. That is request-scale traffic, not a stream that needs partitioning.

**Ordering.** A payment success and a later cancellation for the same order must stay in creation order. The worker claims by `createdAt`. One database is the order source. A broker would add a partition key and a second ordering story without a second writer.

**Delivery.** The outbox row commits with the business change, so a crash after "order paid" cannot drop the event. The worker retries with backoff and parks poison events as `DEAD`. Consumers are idempotent on the event id. That is at-least-once delivery with a visible failure state.

**Operations.** Postgres and Redis are already required. A broker adds a cluster, disk, upgrades, and a new outage mode. The team would operate that cluster for a single consumer.

**Scaling.** More API instances can run the worker. `SKIP LOCKED` stops them from publishing the same row. Horizontal scale of the app is enough until event throughput or consumer count changes.

**Consumer independence.** Today the notification module is the consumer, and it lives in this codebase. A broker pays off when another service must subscribe without sharing this database. That service does not exist.

## When to revisit

Introduce a broker when a second deployable service must consume these events, or when outbox throughput or retention becomes an operational problem. Until then the outbox is the production mechanism, and a broker would be an extra moving part.
