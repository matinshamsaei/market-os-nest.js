import { createHmac } from 'crypto';

import { OrderStatus, PaymentProviderType, PaymentStatus, UserRole } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

import { PrismaService } from '../src/database/prisma/prisma.service';
import { FakeProvider } from '../src/modules/payments/providers/fake.provider';
import { PaymentsService } from '../src/modules/payments/payments.service';

import { authHeader, httpRequest, registerUser, uniqueEmail } from './helpers/auth.helper';
import type { AuthResponse, ErrorResponse } from './helpers/auth.helper';
import { createProduct, publishProduct } from './helpers/products.helper';
import { addToCart, setProductInventory } from './helpers/cart.helper';
import { cleanupMarketplace } from './helpers/db.helper';
import { createTestApp } from './helpers/app.helper';

describe('Payments gateway (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeProvider: FakeProvider;
  let paymentsService: PaymentsService;
  const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-payment-webhook-secret';

  beforeAll(async () => {
    process.env.PAYMENT_PROVIDER = 'FAKE';
    process.env.PAYMENT_WEBHOOK_SECRET = webhookSecret;
    process.env.PAYMENT_RECONCILE_MAX_AGE_MINUTES = '0';

    app = await createTestApp();
    prisma = app.get(PrismaService);
    fakeProvider = app.get(FakeProvider);
    paymentsService = app.get(PaymentsService);
  });

  afterAll(async () => {
    await cleanupMarketplace(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanupMarketplace(prisma);
    fakeProvider.simulateTransientFailures(0);
  });

  async function seedPublishedProduct(stock: number, price = 100) {
    const vendor = await registerUser(
      app,
      uniqueEmail('vendor-payments'),
      'password123',
      UserRole.VENDOR,
    );
    const product = await createProduct(app, vendor.token, {
      title: 'Payment Phone',
      description: 'A phone for payment tests',
      price,
    });

    await setProductInventory(app, vendor.token, product.id, stock);
    await publishProduct(app, vendor.token, product.id);

    return { vendor, product };
  }

  async function registerCustomer(): Promise<AuthResponse> {
    return registerUser(app, uniqueEmail('customer-payments'), 'password123', UserRole.CUSTOMER);
  }

  async function registerAdmin(): Promise<AuthResponse> {
    return registerUser(app, uniqueEmail('admin-payments'), 'password123', UserRole.ADMIN);
  }

  async function createPendingOrder(customer: AuthResponse, total = 200) {
    const { product } = await seedPublishedProduct(10, total / 2);
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
              productTitleSnapshot: 'Payment Phone',
              productPriceSnapshot: total / 2,
              quantity: 2,
            },
          ],
        },
      },
    });
  }

  function signBody(body: string): string {
    return createHmac('sha256', webhookSecret).update(body).digest('hex');
  }

  function postWebhook(payload: Record<string, unknown>, signature?: string) {
    const body = JSON.stringify(payload);
    const request = httpRequest(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-payment-provider', 'FAKE')
      .send(payload);

    if (signature !== undefined) {
      request.set('x-webhook-signature', signature === 'auto' ? signBody(body) : signature);
    }

    return request;
  }

  it('creates a payment and completes it through a success webhook', async () => {
    const customer = await registerCustomer();
    const order = await createPendingOrder(customer, 200);

    const createResponse = await httpRequest(app)
      .post('/payments')
      .set(authHeader(customer.token))
      .send({ orderId: order.id })
      .expect(201);

    expect(createResponse.body).toMatchObject({
      paymentId: expect.any(String),
      paymentUrl: expect.stringContaining('fake-payment.example.com'),
    });

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: createResponse.body.paymentId as string },
    });

    await postWebhook(
      {
        eventId: 'evt_success_1',
        type: 'payment.succeeded',
        providerPaymentId: payment.providerPaymentId,
        amount: 200,
      },
      'auto',
    ).expect(200);

    const updatedPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    expect(updatedPayment.status).toBe(PaymentStatus.SUCCEEDED);
    expect(updatedOrder.status).toBe(OrderStatus.PAID);
  });

  it('marks payment failed on failure webhook', async () => {
    const customer = await registerCustomer();
    const order = await createPendingOrder(customer, 150);

    const createResponse = await httpRequest(app)
      .post('/payments')
      .set(authHeader(customer.token))
      .send({ orderId: order.id })
      .expect(201);

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: createResponse.body.paymentId as string },
    });

    await postWebhook(
      {
        eventId: 'evt_fail_1',
        type: 'payment.failed',
        providerPaymentId: payment.providerPaymentId,
        amount: 150,
      },
      'auto',
    ).expect(200);

    const updatedPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    expect(updatedPayment.status).toBe(PaymentStatus.FAILED);
    expect(updatedOrder.status).toBe(OrderStatus.PENDING);
  });

  it('ignores duplicate webhook events', async () => {
    const customer = await registerCustomer();
    const order = await createPendingOrder(customer, 180);

    const createResponse = await httpRequest(app)
      .post('/payments')
      .set(authHeader(customer.token))
      .send({ orderId: order.id })
      .expect(201);

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: createResponse.body.paymentId as string },
    });

    const payload = {
      eventId: 'evt_dup_1',
      type: 'payment.succeeded',
      providerPaymentId: payment.providerPaymentId,
      amount: 180,
    };

    await postWebhook(payload, 'auto').expect(200);
    await postWebhook(payload, 'auto').expect(200);

    const events = await prisma.processedPaymentWebhook.findMany({
      where: {
        provider: PaymentProviderType.FAKE,
        eventId: 'evt_dup_1',
      },
    });

    expect(events).toHaveLength(1);
  });

  it('rejects invalid webhook signatures', async () => {
    const customer = await registerCustomer();
    const order = await createPendingOrder(customer, 120);

    const createResponse = await httpRequest(app)
      .post('/payments')
      .set(authHeader(customer.token))
      .send({ orderId: order.id })
      .expect(201);

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: createResponse.body.paymentId as string },
    });

    const response = await postWebhook(
      {
        eventId: 'evt_bad_sig',
        type: 'payment.succeeded',
        providerPaymentId: payment.providerPaymentId,
        amount: 120,
      },
      'invalid-signature',
    ).expect(401);

    const body = response.body as ErrorResponse;
    expect(body.message).toBe('Invalid webhook signature');
  });

  it('retries transient create failures then succeeds', async () => {
    const customer = await registerCustomer();
    const order = await createPendingOrder(customer, 220);
    fakeProvider.simulateTransientFailures(2);

    const createResponse = await httpRequest(app)
      .post('/payments')
      .set(authHeader(customer.token))
      .send({ orderId: order.id })
      .expect(201);

    expect(createResponse.body.paymentId).toEqual(expect.any(String));

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: createResponse.body.paymentId as string },
    });
    expect(payment.status).toBe(PaymentStatus.PROCESSING);
  });

  it('allows admin to list and retry failed payments', async () => {
    const customer = await registerCustomer();
    const admin = await registerAdmin();
    const order = await createPendingOrder(customer, 250);
    fakeProvider.simulateTransientFailures(5);

    await httpRequest(app)
      .post('/payments')
      .set(authHeader(customer.token))
      .send({ orderId: order.id })
      .expect(500);

    const failed = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.id, status: PaymentStatus.FAILED },
    });

    const listed = await httpRequest(app)
      .get('/payments/failed')
      .set(authHeader(admin.token))
      .expect(200);

    expect(listed.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: failed.id })]),
    );

    fakeProvider.simulateTransientFailures(0);

    const retry = await httpRequest(app)
      .post(`/payments/${failed.id}/retry`)
      .set(authHeader(admin.token))
      .expect(201);

    expect(retry.body).toMatchObject({
      paymentId: expect.any(String),
      paymentUrl: expect.any(String),
    });
  });

  it('repairs missed webhooks during reconciliation', async () => {
    const customer = await registerCustomer();
    const order = await createPendingOrder(customer, 300);

    const createResponse = await httpRequest(app)
      .post('/payments')
      .set(authHeader(customer.token))
      .send({ orderId: order.id })
      .expect(201);

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: createResponse.body.paymentId as string },
    });

    fakeProvider.setPaymentStatus(payment.providerPaymentId, 'SUCCEEDED');

    await prisma.payment.update({
      where: { id: payment.id },
      data: { updatedAt: new Date(Date.now() - 60_000) },
    });

    const result = await paymentsService.reconcileStalePayments();
    expect(result.repaired).toBeGreaterThanOrEqual(1);

    const updatedPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    expect(updatedPayment.status).toBe(PaymentStatus.SUCCEEDED);
    expect(updatedOrder.status).toBe(OrderStatus.PAID);
  });
});
