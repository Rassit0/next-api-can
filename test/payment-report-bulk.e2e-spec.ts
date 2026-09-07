import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { PaymentMethod, StatusCharge, TransactionType } from 'src/generated/prisma/client';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { TransactionsService } from '../src/transactions/transactions.service';
import { envs } from '../src/config/envs';

jest.mock('uuid', () => ({
  v4: () => randomUUID(),
}));

describe('Bulk Payment Report (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication;
  let prisma: PrismaService;
  let transactionsService: TransactionsService;

  let jwtToken: string;
  let unauthorizedToken: string;
  
  const testData = {
    personId: '',
    financialAccountId: '',
    paymentIds: [] as string[],
    chargeIds: [] as string[],
    transactionIds: [] as string[],
    userIds: [] as string[],
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    transactionsService = app.get(TransactionsService);

    // Setup Test Data
    const person = await prisma.person.create({
      data: {
        name: 'Bulk Report Test',
        lastName: 'Person',
        documentNumber: `BULK-REP-${randomUUID()}`,
        documentType: 'CI',
      },
    });
    testData.personId = person.id;

    const account = await prisma.financialAccount.findFirst({
      where: { allowedPaymentMethods: { has: PaymentMethod.CASH }, isActive: true },
    });
    if (!account) {
      throw new Error('No valid financial account found for tests');
    }
    testData.financialAccountId = account.id;

    // Create 3 charges and pay them to generate receipts
    for (let i = 0; i < 3; i++) {
      const charge = await prisma.charge.create({
        data: {
          description: `Bulk Report Charge ${i}`,
          amount: 50.0,
          pendingAmount: 50.0,
          status: StatusCharge.PENDING,
          dueDate: new Date(),
        },
      });
      testData.chargeIds.push(charge.id);

      const res = await transactionsService.create({
        payerPersonId: person.id,
        financialAccountId: account.id,
        paymentMethod: PaymentMethod.CASH,
        amount: 50.0,
        chargeId: charge.id,
        type: TransactionType.INCOME,
      });
      
      const txs = await prisma.transaction.findMany({ where: { payment: { chargeId: charge.id } } });
      testData.transactionIds.push(...txs.map(t => t.id));

      const payment = await prisma.payment.findFirst({ where: { chargeId: charge.id } });
      if (payment) {
        testData.paymentIds.push(payment.id);
      }
    }

    const permRead = await prisma.permission.findFirst({ where: { name: 'READ_TRANSACTIONS' } });
    const permCreate = await prisma.permission.findFirst({ where: { name: 'CREATE_TRANSACTIONS' } });
    const permDash = await prisma.permission.findFirst({ where: { name: 'READ_DASHBOARD' } });

    // Mock Users for tokens (simple users, inject roles via JWT)
    const adminUser = await prisma.user.create({
      data: {
        email: `admin-bulk-report-${randomUUID()}@test.com`,
        password: 'hash',
        person: {
          create: {
            name: 'Admin',
            lastName: 'User',
            documentNumber: randomUUID(),
          }
        },
        role: {
          create: {
            name: `Role-Admin-${randomUUID()}`,
            permissions: {
              create: [
                ...(permRead ? [{ permissionId: permRead.id }] : []),
                ...(permCreate ? [{ permissionId: permCreate.id }] : []),
              ]
            }
          }
        }
      },
    });
    testData.userIds.push(adminUser.id);

    const basicUser = await prisma.user.create({
      data: {
        email: `basic-bulk-report-${randomUUID()}@test.com`,
        password: 'hash',
        person: {
          create: {
            name: 'Basic',
            lastName: 'User',
            documentNumber: randomUUID(),
          }
        },
        role: {
          create: {
            name: `Role-Basic-${randomUUID()}`,
            permissions: {
              create: [
                ...(permDash ? [{ permissionId: permDash.id }] : []),
              ]
            }
          }
        }
      },
    });
    testData.userIds.push(basicUser.id);

    jwtToken = jwt.sign(
      { id: adminUser.id, roleId: adminUser.roleId, email: adminUser.email },
      envs.jwtSecret
    );

    unauthorizedToken = jwt.sign(
      { id: basicUser.id, roleId: basicUser.roleId, email: basicUser.email },
      envs.jwtSecret
    );
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { id: { in: testData.transactionIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: testData.paymentIds } } });
    await prisma.charge.deleteMany({ where: { id: { in: testData.chargeIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testData.userIds } } });
    await prisma.person.deleteMany({ where: { id: testData.personId } });
    await app.close();
  });

  it('1. Un recibo genera PDF', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-report/bulk')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ paymentIds: [testData.paymentIds[0]] })
      .expect(201);

    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.body).toBeInstanceOf(Buffer);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('2. Dos recibos generan PDF consolidado', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-report/bulk')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ paymentIds: [testData.paymentIds[0], testData.paymentIds[1]] })
      .expect(201);

    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.body).toBeInstanceOf(Buffer);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('3. Múltiples recibos generan PDF consolidado', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-report/bulk')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ paymentIds: testData.paymentIds })
      .expect(201);

    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.body).toBeInstanceOf(Buffer);
  });

  it('4. Duplicados se ignoran (retorna PDF en lugar de error)', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-report/bulk')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ paymentIds: [testData.paymentIds[0], testData.paymentIds[0], testData.paymentIds[1]] })
      .expect(201);

    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.body).toBeInstanceOf(Buffer);
  });

  it('5. ID inexistente rechaza operación completa', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-report/bulk')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ paymentIds: [testData.paymentIds[0], randomUUID()] })
      .expect(404);

    expect(response.body.message).toMatch(/no existe|No se encontr|not found/i);
  });

  it('6. Array vacío devuelve BadRequest por validación DTO', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-report/bulk')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ paymentIds: [] })
      .expect(400);

    expect(response.body.message).toContain('El arreglo de IDs de pagos no puede estar vacío.');
  });

  it('6.1 No enviar array devuelve BadRequest', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-report/bulk')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({})
      .expect(400);

    expect(response.body.message).toContain('paymentIds must be an array');
  });

  it('6.2 Array con IDs inválidos devuelve BadRequest', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-report/bulk')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ paymentIds: ['not-a-uuid'] })
      .expect(400);

    expect(response.body.message).toContain('Cada ID de pago debe ser un UUID válido.');
  });

  it('7. Orden: genera PDF correctamente independientemente del orden', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-report/bulk')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ paymentIds: [testData.paymentIds[2], testData.paymentIds[0]] })
      .expect(201);

    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.body).toBeInstanceOf(Buffer);
  });

  it('9. Autorización RBAC funciona: usuario sin permisos recibe Forbidden', async () => {
    await request(app.getHttpServer())
      .post('/payment-report/bulk')
      .set('Authorization', `Bearer ${unauthorizedToken}`)
      .send({ paymentIds: [testData.paymentIds[0]] })
      .expect(403);
  });

  it('10. Regresión individual: GET funciona correctamente', async () => {
    const response = await request(app.getHttpServer())
      .get(`/payment-report/payment/${testData.paymentIds[0]}`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.body).toBeInstanceOf(Buffer);
    expect(response.body.length).toBeGreaterThan(0);
  });
});
