import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { TransactionsService } from '../src/transactions/transactions.service';
import { PaymentMethod, StatusCharge, TransactionType } from 'src/generated/prisma/client';
import { randomUUID } from 'crypto';

jest.mock('uuid', () => ({
  v4: () => randomUUID(),
}));

describe('Bulk Payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const testData = {
    personId: '',
    financialAccountId: '',
    charges: [] as string[],
  };

  let transactionsService: any;

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
        name: 'Bulk Test Person',
        lastName: 'Test',
        documentNumber: `BULK-${randomUUID()}`,
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

    // Create 10 mock charges for testing
    for (let i = 0; i < 10; i++) {
      const charge = await prisma.charge.create({
        data: {
          description: `Bulk Test Charge ${i}`,
          amount: 50.0,
          pendingAmount: 50.0,
          status: StatusCharge.PENDING,
          dueDate: new Date(),
        },
      });
      testData.charges.push(charge.id);
    }
  });

  afterAll(async () => {
    // Teardown
    try {
      const schedulerRegistry = app.get(require('@nestjs/schedule').SchedulerRegistry);
      schedulerRegistry.getCronJobs().forEach((job: any) => job.stop());
      schedulerRegistry.getIntervals().forEach((interval: any) => clearInterval(schedulerRegistry.getInterval(interval)));
      schedulerRegistry.getTimeouts().forEach((timeout: any) => clearTimeout(schedulerRegistry.getTimeout(timeout)));
    } catch (e) {}

    await prisma.transaction.deleteMany({
      where: { payerPersonId: testData.personId },
    });
    const payments = await prisma.payment.findMany({
      where: { chargeId: { in: testData.charges } },
    });
    await prisma.transaction.deleteMany({
      where: { paymentId: { in: payments.map((p) => p.id) } },
    });
    await prisma.payment.deleteMany({
      where: { chargeId: { in: testData.charges } },
    });
    await prisma.charge.deleteMany({
      where: { id: { in: testData.charges } },
    });
    await prisma.person.delete({
      where: { id: testData.personId },
    });

    await app.close();
  });

  it('Caso 1: Un cargo -> 1 Payment -> 1 Transaction', async () => {
    const chargeId = testData.charges[0];
    const payload = {
      payerPersonId: testData.personId,
      financialAccountId: testData.financialAccountId,
      paymentMethod: PaymentMethod.CASH,
      totalAmount: 50.0,
      charges: [{ chargeId }],
    };

    const res = await transactionsService.createBulk(payload);
    expect(res.transactionsCount).toBe(1);
    expect(res.totalAmount).toBe(50.0);

    const txs = await prisma.transaction.findMany({ where: { payment: { chargeId } } });
    expect(txs.length).toBe(1);
    expect(txs[0].amount.toNumber()).toBe(50.0);

    const charge = await prisma.charge.findUnique({ where: { id: chargeId } });
    expect(charge.status).toBe(StatusCharge.PAID);
    expect(charge.pendingAmount.toNumber()).toBe(0);
  });

  it('Caso 2: Tres cargos -> 3 Payments -> 3 Transactions', async () => {
    const chargeIds = [testData.charges[1], testData.charges[2], testData.charges[3]];
    const payload = {
      payerPersonId: testData.personId,
      financialAccountId: testData.financialAccountId,
      paymentMethod: PaymentMethod.CASH,
      totalAmount: 150.0,
      charges: chargeIds.map(chargeId => ({ chargeId })),
    };

    const res = await transactionsService.createBulk(payload);
    expect(res.transactionsCount).toBe(3);
    expect(res.totalAmount).toBe(150.0);

    for (const chargeId of chargeIds) {
      const charge = await prisma.charge.findUnique({ where: { id: chargeId }, include: { payments: { include: { transactions: true } } } });
      expect(charge.status).toBe(StatusCharge.PAID);
      expect(charge.payments.length).toBe(1);
      expect(charge.payments[0].transactions.length).toBe(1);
    }
  });

  it('Caso 3: Cargo parcialmente pagado', async () => {
    // Simulamos un pago parcial pre-existente
    const chargeId = testData.charges[4];
    await prisma.charge.update({
      where: { id: chargeId },
      data: { pendingAmount: 20.0, status: StatusCharge.PARTIAL },
    });

    const payload = {
      payerPersonId: testData.personId,
      financialAccountId: testData.financialAccountId,
      paymentMethod: PaymentMethod.CASH,
      totalAmount: 20.0, // Solo cobra el remanente
      charges: [{ chargeId }],
    };

    const res = await transactionsService.createBulk(payload);
    expect(res.transactionsCount).toBe(1);
    expect(res.totalAmount).toBe(20.0);

    const charge = await prisma.charge.findUnique({ where: { id: chargeId } });
    expect(charge.status).toBe(StatusCharge.PAID);
    expect(charge.pendingAmount.toNumber()).toBe(0);
  });

  it('Caso 4: Cargo ya pagado rechaza la operacion', async () => {
    const chargeId = testData.charges[0]; // Ya se pagó en el Caso 1
    const payload = {
      payerPersonId: testData.personId,
      financialAccountId: testData.financialAccountId,
      paymentMethod: PaymentMethod.CASH,
      totalAmount: 50.0,
      charges: [{ chargeId }],
    };

    await expect(transactionsService.createBulk(payload)).rejects.toThrow(/ya se encuentra pagado/);
  });

  it('Caso 5: Uno de N cargos invalido hace rollback completo', async () => {
    const validChargeId = testData.charges[5];
    const invalidChargeId = testData.charges[0]; // Ya pagado
    
    const payload = {
      payerPersonId: testData.personId,
      financialAccountId: testData.financialAccountId,
      paymentMethod: PaymentMethod.CASH,
      totalAmount: 100.0, // Error: el total seria 50 + 0 = 50, pero declaramos 100
      charges: [{ chargeId: validChargeId }, { chargeId: invalidChargeId }],
    };

    await expect(transactionsService.createBulk(payload)).rejects.toThrow();

    // Verificamos que el cargo válido no fue pagado (rollback)
    const validCharge = await prisma.charge.findUnique({ where: { id: validChargeId } });
    expect(validCharge.status).toBe(StatusCharge.PENDING);
    expect(validCharge.pendingAmount.toNumber()).toBe(50.0);
  });

  it('Caso 6: Concurrencia (Simulada por mismatch de monto total)', async () => {
    const chargeId = testData.charges[6];
    
    // Alguien pagó 10.0 en el backend sin que el front se entere
    await prisma.charge.update({
      where: { id: chargeId },
      data: { pendingAmount: 40.0, status: StatusCharge.PARTIAL },
    });

    const payload = {
      payerPersonId: testData.personId,
      financialAccountId: testData.financialAccountId,
      paymentMethod: PaymentMethod.CASH,
      totalAmount: 50.0, // Front creía que seguía siendo 50.0
      charges: [{ chargeId }],
    };

    await expect(transactionsService.createBulk(payload)).rejects.toThrow(/no coincide con la suma/);
  });

  it('Caso 7: Regresion - create individual sigue funcionando', async () => {
    const chargeId = testData.charges[7];
    const payload = {
      payerPersonId: testData.personId,
      financialAccountId: testData.financialAccountId,
      paymentMethod: PaymentMethod.CASH,
      amount: 50.0,
      chargeId,
      type: TransactionType.INCOME,
    };

    const res = await transactionsService.create(payload);
    // Para depurar si falla
    console.log('Caso 7 Res:', res);
    expect(res).toBeDefined();

    const charge = await prisma.charge.findUnique({ where: { id: chargeId } });
    expect(charge.status).toBe(StatusCharge.PAID);
  });

  it('Caso 8: Reversion de un pago bulk (usa delete de transaction individual)', async () => {
    // Usaremos el cargo pagado en Caso 1
    const chargeId = testData.charges[0];
    
    // Obtenemos la transacción generada
    const tx = await prisma.transaction.findFirst({ where: { payment: { chargeId } } });
    
    // Llamamos al remove clásico
    await transactionsService.remove(tx.id);

    const charge = await prisma.charge.findUnique({ where: { id: chargeId } });
    expect(charge.status).toBe(StatusCharge.PENDING);
    expect(charge.pendingAmount.toNumber()).toBe(50.0);
  });
  it('Caso 9: Array con chargeId duplicados rechaza la operacion', async () => {
    const chargeId = testData.charges[8];
    const payload = {
      payerPersonId: testData.personId,
      financialAccountId: testData.financialAccountId,
      paymentMethod: PaymentMethod.CASH,
      totalAmount: 100.0,
      charges: [{ chargeId }, { chargeId }],
    };

    await expect(transactionsService.createBulk(payload)).rejects.toThrow(/duplicados/);

    // Verificar que no hubo cambios financieros
    const charge = await prisma.charge.findUnique({ where: { id: chargeId }, include: { payments: true } });
    expect(charge.status).toBe(StatusCharge.PENDING);
    expect(charge.pendingAmount.toNumber()).toBe(50.0);
    expect(charge.payments.length).toBe(0);
  });

  it('Caso 10: Concurrencia real (dos requests simultaneos)', async () => {
    const chargeId = testData.charges[9];
    const payload = {
      payerPersonId: testData.personId,
      financialAccountId: testData.financialAccountId,
      paymentMethod: PaymentMethod.CASH,
      totalAmount: 50.0,
      charges: [{ chargeId }],
    };

    // Ejecutar simultáneamente
    const req1 = transactionsService.createBulk(payload);
    const req2 = transactionsService.createBulk(payload);

    const results = await Promise.allSettled([req1, req2]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // Solo uno debe triunfar
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // El error debe ser el de total amount o cargo ya pagado
    if (rejected[0] && rejected[0].status === 'rejected') {
      const errorMsg = rejected[0].reason.message;
      expect(errorMsg).toMatch(/ya se encuentra pagado|no coincide/);
    }

    // Verificar que solo se cobró una vez
    const charge = await prisma.charge.findUnique({ where: { id: chargeId }, include: { payments: true } });
    expect(charge.status).toBe(StatusCharge.PAID);
    expect(charge.pendingAmount.toNumber()).toBe(0.0);
    expect(charge.payments.length).toBe(1);
  });

  it('Caso 11: Bulk multicuentas. Un cargo pagado con 2 métodos (splits)', async () => {
    // Reutilizaremos un cargo restaurado
    const chargeId = testData.charges[0];
    await prisma.transaction.deleteMany({
      where: { payment: { chargeId } },
    });
    await prisma.payment.deleteMany({
      where: { chargeId },
    });
    await prisma.charge.update({
      where: { id: chargeId },
      data: { pendingAmount: 50.0, status: StatusCharge.PENDING },
    });

    const payload = {
      payerPersonId: testData.personId,
      charges: [
        {
          chargeId,
          splitTransactions: [
            {
              amount: 20.0,
              paymentMethod: PaymentMethod.CASH,
              financialAccountId: testData.financialAccountId,
            },
            {
              amount: 30.0,
              paymentMethod: PaymentMethod.CASH,
              financialAccountId: testData.financialAccountId,
            },
          ],
        },
      ],
    };

    const res = await transactionsService.createBulk(payload);
    expect(res.transactionsCount).toBe(1);

    const charge = await prisma.charge.findUnique({ where: { id: chargeId }, include: { payments: { include: { transactions: true } } } });
    expect(charge.status).toBe(StatusCharge.PAID);
    expect(charge.pendingAmount.toNumber()).toBe(0);
    expect(charge.payments.length).toBe(1);
    expect(charge.payments[0].transactions.length).toBe(2);
    expect(charge.payments[0].transactions[0].amount.toNumber()).toBe(20.0);
    expect(charge.payments[0].transactions[1].amount.toNumber()).toBe(30.0);
  });

  it('Caso 12: Varios cargos con distribuciones independientes (mezcla default y custom)', async () => {
    const charge1Id = testData.charges[8];
    const charge2Id = testData.charges[9];

    // Restauramos saldo
    await prisma.transaction.deleteMany({
      where: {
        payment: { chargeId: { in: [charge1Id, charge2Id] } },
      },
    });
    await prisma.payment.deleteMany({
      where: { chargeId: { in: [charge1Id, charge2Id] } },
    });
    await prisma.charge.updateMany({
      where: { id: { in: [charge1Id, charge2Id] } },
      data: { pendingAmount: 50.0, status: StatusCharge.PENDING },
    });

    const payload = {
      payerPersonId: testData.personId,
      totalAmount: 100.0,
      paymentMethod: PaymentMethod.CASH, // Default global
      financialAccountId: testData.financialAccountId, // Default global
      charges: [
        {
          chargeId: charge1Id, // Sin splits -> usa global
        },
        {
          chargeId: charge2Id, // Con splits -> usa splits
          splitTransactions: [
            {
              amount: 25.0,
              paymentMethod: PaymentMethod.CASH,
              financialAccountId: testData.financialAccountId,
            },
            {
              amount: 25.0,
              paymentMethod: PaymentMethod.CASH,
              financialAccountId: testData.financialAccountId,
            },
          ],
        },
      ],
    };

    const res = await transactionsService.createBulk(payload);
    expect(res.transactionsCount).toBe(2);

    const charge1 = await prisma.charge.findUnique({ where: { id: charge1Id }, include: { payments: { include: { transactions: true } } } });
    expect(charge1.status).toBe(StatusCharge.PAID);
    expect(charge1.payments[0].transactions.length).toBe(1); // Usó global

    const charge2 = await prisma.charge.findUnique({ where: { id: charge2Id }, include: { payments: { include: { transactions: true } } } });
    expect(charge2.status).toBe(StatusCharge.PAID);
    expect(charge2.payments[0].transactions.length).toBe(2); // Usó splits
    expect(charge2.payments[0].transactions[0].paymentMethod).toBe(PaymentMethod.CASH);
    expect(charge2.payments[0].transactions[1].paymentMethod).toBe(PaymentMethod.CASH);
  });
});
