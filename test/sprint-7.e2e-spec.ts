import { createHmac, randomUUID } from 'crypto';

import {
  DomainEventStatus,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  OrderStatus,
  OutboxEventStatus,
  PaymentStatus,
  UserRole,
} from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

import { PrismaService } from '../src/database/prisma/prisma.service';
import { EventBus } from '../src/modules/events/event-bus';
import { EventDeliveryService } from '../src/modules/events/event-delivery.service';
import { EventTypes } from '../src/modules/events/event-types';
import { OutboxRepository } from '../src/modules/events/outbox.repository';
import { OutboxService } from '../src/modules/events/outbox.service';
import { OutboxWorker } from '../src/modules/events/outbox.worker';
import { NotificationEventProcessor } from '../src/modules/notifications/notification-event.processor';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { FakeProvider } from '../src/modules/payments/providers/fake.provider';

import { authHeader, httpRequest, registerUser, uniqueEmail } from './helpers/auth.helper';
import type { AuthResponse } from './helpers/auth.helper';
import { addToCart, setProductInventory } from './helpers/cart.helper';
import { cleanupMarketplace } from './helpers/db.helper';
import { createTestApp } from './helpers/app.helper';
import { createProduct, publishProduct } from './helpers/products.helper';

describe('Sprint 7 notifications and events (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeProvider: FakeProvider;
  let notificationsService: NotificationsService;
  let outboxService: OutboxService;
  let outboxRepository: OutboxRepository;
  let outboxWorker: OutboxWorker;
  let eventBus: EventBus;
  let eventDeliveryService: EventDeliveryService;
  let notificationProcessor: NotificationEventProcessor;
  const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-payment-webhook-secret';

  beforeAll(async () => {
    process.env.PAYMENT_PROVIDER = 'FAKE';
    process.env.PAYMENT_WEBHOOK_SECRET = webhookSecret;

    app = await createTestApp();
    prisma = app.get(PrismaService);
    fakeProvider = app.get(FakeProvider);
    notificationsService = app.get(NotificationsService);
    outboxService = app.get(OutboxService);
    outboxRepository = app.get(OutboxRepository);
    outboxWorker = app.get(OutboxWorker);
    eventBus = app.get(EventBus);
    eventDeliveryService = app.get(EventDeliveryService);
    notificationProcessor = app.get(NotificationEventProcessor);
  });

  afterAll(async () => {
    await cleanupMarketplace(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanupMarketplace(prisma);
    fakeProvider.simulateTransientFailures(0);
  });

  async function registerCustomer(): Promise<AuthResponse> {
    return registerUser(app, uniqueEmail('customer-s7'), 'password123', UserRole.CUSTOMER);
  }

  async function seedPendingOrder(customer: AuthResponse, total = 200) {
    const vendor = await registerUser(
      app,
      uniqueEmail('vendor-s7'),
      'password123',
      UserRole.VENDOR,
    );
    const product = await createProduct(app, vendor.token, {
      title: 'Sprint Phone',
      description: 'A phone for sprint 7 tests',
      price: total / 2,
    });

    await setProductInventory(app, vendor.token, product.id, 10);
    await publishProduct(app, vendor.token, product.id);
    await addToCart(app, customer.token, { productId: product.id, quantity: 2 });

    return prisma.order.create({
      data: {
        userId: customer.user.id,
        status: OrderStatus.PENDING,
        subTotal: total,
        total,
        orderItems: {
          create: [
            {
              productId: product.id,
              productTitleSnapshot: 'Sprint Phone',
              productPriceSnapshot: total / 2,
              quantity: 2,
            },
          ],
        },
      },
    });
  }

  function postWebhook(payload: Record<string, unknown>) {
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', webhookSecret).update(body).digest('hex');

    return httpRequest(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-payment-provider', 'FAKE')
      .set('x-webhook-signature', signature)
      .send(payload);
  }

  async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 8000): Promise<T> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const value = await read();

      if (value) {
        return value;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error('Timed out waiting for async event processing');
  }

  describe('notifications', () => {
    it('creates, lists, paginates, and marks notifications read for the owner', async () => {
      const customer = await registerCustomer();
      const orderId = randomUUID();

      const created = await notificationsService.createFromDomainEvent({
        id: `order-paid-${orderId}`,
        type: EventTypes.ORDER_PAID,
        occurredAt: new Date().toISOString(),
        payload: { orderId, userId: customer.user.id, amount: 200 },
      });

      expect(created).toMatchObject({
        userId: customer.user.id,
        type: NotificationType.ORDER_PAID,
        channel: NotificationChannel.IN_APP,
        status: NotificationStatus.SENT,
      });

      await notificationsService.createFromDomainEvent({
        id: `order-cancelled-${orderId}`,
        type: EventTypes.ORDER_CANCELLED,
        occurredAt: new Date().toISOString(),
        payload: { orderId, userId: customer.user.id },
      });
      await notificationsService.createFromDomainEvent({
        id: `payment-failed-${orderId}`,
        type: EventTypes.PAYMENT_FAILED,
        occurredAt: new Date().toISOString(),
        payload: { orderId, userId: customer.user.id, reason: 'card declined' },
      });

      const page = await httpRequest(app)
        .get('/notifications')
        .query({ page: 1, perPage: 2 })
        .set(authHeader(customer.token))
        .expect(200);

      expect(page.body.data).toHaveLength(2);
      expect(page.body.meta).toMatchObject({ page: 1, perPage: 2, total: 3, totalPages: 2 });

      const notificationId = created?.id;

      const readResponse = await httpRequest(app)
        .patch(`/notifications/${notificationId}/read`)
        .set(authHeader(customer.token))
        .expect(200);

      expect(readResponse.body.readAt).toEqual(expect.any(String));

      const readAllResponse = await httpRequest(app)
        .patch('/notifications/read-all')
        .set(authHeader(customer.token))
        .expect(200);

      expect(readAllResponse.body.updatedCount).toBe(2);

      const unread = await httpRequest(app)
        .get('/notifications/unread-count')
        .set(authHeader(customer.token))
        .expect(200);

      expect(unread.body.count).toBe(0);
    });

    it('rejects anonymous callers and hides another user notification', async () => {
      const owner = await registerCustomer();
      const other = await registerCustomer();
      const notification = await notificationsService.createFromDomainEvent({
        id: `order-paid-${randomUUID()}`,
        type: EventTypes.ORDER_PAID,
        occurredAt: new Date().toISOString(),
        payload: { orderId: randomUUID(), userId: owner.user.id, amount: 50 },
      });

      await httpRequest(app).get('/notifications').expect(401);

      await httpRequest(app)
        .patch(`/notifications/${notification?.id}/read`)
        .set(authHeader(other.token))
        .expect(404);
    });
  });

  describe('preferences', () => {
    it('does not deliver a notification the user disabled', async () => {
      const customer = await registerCustomer();

      await httpRequest(app)
        .put('/notification-preferences')
        .set(authHeader(customer.token))
        .send({
          preferences: [
            {
              notificationType: NotificationType.ORDER_PAID,
              channel: NotificationChannel.IN_APP,
              enabled: false,
            },
          ],
        })
        .expect(200);

      const delivered = await notificationsService.createFromDomainEvent({
        id: `order-paid-${randomUUID()}`,
        type: EventTypes.ORDER_PAID,
        occurredAt: new Date().toISOString(),
        payload: { orderId: randomUUID(), userId: customer.user.id, amount: 80 },
      });

      expect(delivered).toBeNull();
      expect(await prisma.notification.count({ where: { userId: customer.user.id } })).toBe(0);
    });

    it('delivers a notification the user left enabled', async () => {
      const customer = await registerCustomer();

      const preferences = await httpRequest(app)
        .get('/notification-preferences')
        .set(authHeader(customer.token))
        .expect(200);

      const orderPaidInApp = (
        preferences.body.preferences as Array<{
          notificationType: NotificationType;
          channel: NotificationChannel;
          enabled: boolean;
        }>
      ).find(
        (preference) =>
          preference.notificationType === NotificationType.ORDER_PAID &&
          preference.channel === NotificationChannel.IN_APP,
      );

      expect(orderPaidInApp?.enabled).toBe(true);

      const delivered = await notificationsService.createFromDomainEvent({
        id: `order-paid-${randomUUID()}`,
        type: EventTypes.ORDER_PAID,
        occurredAt: new Date().toISOString(),
        payload: { orderId: randomUUID(), userId: customer.user.id, amount: 90 },
      });

      expect(delivered?.status).toBe(NotificationStatus.SENT);
    });
  });

  describe('business events', () => {
    it('writes an order.paid outbox event when a payment succeeds and processes it', async () => {
      const customer = await registerCustomer();
      const order = await seedPendingOrder(customer, 200);

      const createResponse = await httpRequest(app)
        .post('/payments')
        .set(authHeader(customer.token))
        .send({ orderId: order.id })
        .expect(201);

      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: createResponse.body.paymentId as string },
      });

      await postWebhook({
        eventId: `evt_${randomUUID()}`,
        type: 'payment.succeeded',
        providerPaymentId: payment.providerPaymentId,
        amount: 200,
      }).expect(200);

      const outbox = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: `order-paid-${payment.id}` },
      });

      expect(outbox.eventType).toBe(EventTypes.ORDER_PAID);
      expect(outbox.aggregateId).toBe(order.id);

      const processed = await waitFor(async () => {
        const row = await prisma.outboxEvent.findUnique({ where: { id: outbox.id } });
        return row?.status === OutboxEventStatus.PROCESSED ? row : null;
      });

      expect(processed.processedAt).toBeTruthy();

      const notification = await waitFor(() =>
        prisma.notification.findFirst({
          where: { userId: customer.user.id, type: NotificationType.ORDER_PAID },
        }),
      );

      expect(notification.status).toBe(NotificationStatus.SENT);
    });

    it('writes a payment.failed outbox event when a payment fails', async () => {
      const customer = await registerCustomer();
      const order = await seedPendingOrder(customer, 150);

      const createResponse = await httpRequest(app)
        .post('/payments')
        .set(authHeader(customer.token))
        .send({ orderId: order.id })
        .expect(201);

      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: createResponse.body.paymentId as string },
      });

      await postWebhook({
        eventId: `evt_${randomUUID()}`,
        type: 'payment.failed',
        providerPaymentId: payment.providerPaymentId,
        amount: 150,
      }).expect(200);

      const updatedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      const outbox = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: `payment-failed-${payment.id}` },
      });

      expect(updatedPayment.status).toBe(PaymentStatus.FAILED);
      expect(outbox.eventType).toBe(EventTypes.PAYMENT_FAILED);
    });

    it('writes an order.cancelled outbox event when the customer cancels', async () => {
      const customer = await registerCustomer();
      const order = await seedPendingOrder(customer, 120);

      await httpRequest(app)
        .patch(`/orders/${order.id}/cancel`)
        .set(authHeader(customer.token))
        .expect(200);

      const outbox = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: `order-cancelled-${order.id}` },
      });

      expect(outbox.eventType).toBe(EventTypes.ORDER_CANCELLED);
      expect(outbox.aggregateId).toBe(order.id);
    });
  });

  describe('outbox reliability', () => {
    beforeAll(async () => {
      outboxWorker.onModuleDestroy();
      await notificationProcessor.onModuleDestroy();
    });

    it('rolls back the outbox row when the business transaction crashes', async () => {
      const customer = await registerCustomer();
      const order = await seedPendingOrder(customer, 100);
      const outboxId = `order-paid-rollback-${order.id}`;

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.PAID },
          });
          await outboxService.enqueue(tx, {
            id: outboxId,
            eventType: EventTypes.ORDER_PAID,
            aggregateType: 'order',
            aggregateId: order.id,
            payload: { orderId: order.id, userId: customer.user.id, amount: 100 },
          });
          throw new Error('crash before commit');
        }),
      ).rejects.toThrow('crash before commit');

      const storedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

      expect(storedOrder.status).toBe(OrderStatus.PENDING);
      expect(await prisma.outboxEvent.findUnique({ where: { id: outboxId } })).toBeNull();
    });

    it('keeps a committed outbox row pending until the worker publishes it', async () => {
      const customer = await registerCustomer();
      const order = await seedPendingOrder(customer, 110);
      const outboxId = `order-paid-crash-${order.id}`;

      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.PAID },
        });
        await outboxService.enqueue(tx, {
          id: outboxId,
          eventType: EventTypes.ORDER_PAID,
          aggregateType: 'order',
          aggregateId: order.id,
          payload: { orderId: order.id, userId: customer.user.id, amount: 110 },
        });
      });

      const pending = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: outboxId } });

      expect(pending.status).toBe(OutboxEventStatus.PENDING);
      expect(await prisma.domainEventRecord.findUnique({ where: { id: outboxId } })).toBeNull();

      await outboxWorker.publishNext();

      const processed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: outboxId } });
      const domainEvent = await prisma.domainEventRecord.findUniqueOrThrow({
        where: { id: outboxId },
      });

      expect(processed.status).toBe(OutboxEventStatus.PROCESSED);
      expect(domainEvent.type).toBe(EventTypes.ORDER_PAID);
    });

    it('retries a failed publish and parks it as dead after the last attempt', async () => {
      const outboxId = `order-paid-retry-${randomUUID()}`;
      const failingWorker = new OutboxWorker(outboxRepository, {
        publish: () => Promise.reject(new Error('downstream unavailable')),
      } as unknown as EventBus);

      await prisma.outboxEvent.create({
        data: {
          id: outboxId,
          eventType: EventTypes.ORDER_PAID,
          aggregateType: 'order',
          aggregateId: randomUUID(),
          payload: { orderId: randomUUID(), userId: randomUUID(), amount: 10 },
        },
      });

      await failingWorker.publishNext();

      const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: outboxId } });

      expect(failed.status).toBe(OutboxEventStatus.FAILED);
      expect(failed.attempts).toBe(1);
      expect(failed.lastError).toBe('downstream unavailable');

      await prisma.outboxEvent.update({
        where: { id: outboxId },
        data: { availableAt: new Date(Date.now() + 60_000) },
      });

      expect(await failingWorker.publishNext()).toBeNull();

      for (let attempt = failed.attempts; attempt < 5; attempt += 1) {
        await prisma.outboxEvent.update({
          where: { id: outboxId },
          data: { availableAt: new Date(0) },
        });
        await failingWorker.publishNext();
      }

      const dead = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: outboxId } });

      expect(dead.status).toBe(OutboxEventStatus.DEAD);
      expect(dead.attempts).toBe(5);
    });

    it('does not let two workers publish the same outbox event', async () => {
      const outboxId = `order-paid-race-${randomUUID()}`;

      await prisma.outboxEvent.create({
        data: {
          id: outboxId,
          eventType: EventTypes.ORDER_PAID,
          aggregateType: 'order',
          aggregateId: randomUUID(),
          payload: { orderId: randomUUID(), userId: randomUUID(), amount: 15 },
          availableAt: new Date(),
        },
      });

      const [first, second] = await Promise.all([
        outboxWorker.publishNext(),
        outboxWorker.publishNext(),
      ]);
      const published = [first, second].filter((event) => event?.id === outboxId);

      expect(published).toHaveLength(1);

      const stored = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: outboxId } });
      const domainEvents = await prisma.domainEventRecord.count({ where: { id: outboxId } });

      expect(stored.status).toBe(OutboxEventStatus.PROCESSED);
      expect(stored.attempts).toBe(1);
      expect(domainEvents).toBe(1);
    });

    it('claims a domain event once and records retry then dead outcomes', async () => {
      const eventId = `order-paid-delivery-${randomUUID()}`;
      const payload = { orderId: randomUUID(), userId: randomUUID(), amount: 20 };
      const job = {
        id: eventId,
        type: EventTypes.ORDER_PAID,
        occurredAt: new Date().toISOString(),
        payload,
      };

      await eventBus.publish({
        id: eventId,
        type: EventTypes.ORDER_PAID,
        occurredAt: new Date(),
        payload,
      });

      const firstClaim = await eventDeliveryService.beginAttempt(eventId);
      const secondClaim = await eventDeliveryService.beginAttempt(eventId);

      expect(firstClaim?.status).toBe(DomainEventStatus.PROCESSING);
      expect(secondClaim).toBeNull();

      const retried = await eventDeliveryService.recordFailure(job, new Error('handler failed'));

      expect(retried.status).toBe(DomainEventStatus.FAILED);

      await prisma.domainEventRecord.update({
        where: { id: eventId },
        data: { attemptCount: 5, status: DomainEventStatus.PROCESSING },
      });

      const dead = await eventDeliveryService.recordFailure(job, new Error('handler failed'));
      const stored = await prisma.domainEventRecord.findUniqueOrThrow({ where: { id: eventId } });

      expect(dead.status).toBe(DomainEventStatus.DEAD);
      expect(stored.status).toBe(DomainEventStatus.DEAD);
      expect(stored.lastError).toBe('handler failed');
    });
  });
});
