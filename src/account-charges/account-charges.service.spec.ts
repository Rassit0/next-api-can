import { Test, TestingModule } from '@nestjs/testing';
import { AccountChargesService } from './account-charges.service';
import { PrismaService } from '../prisma.service';
import { ChargesService } from '../charges/charges.service';
import { TransactionsService } from '../transactions/transactions.service';
import { BadRequestException } from '@nestjs/common';
import { StatusCharge, TransactionType, ChargeDirection, PaymentMethod } from '../generated/prisma/client';
import { CreateAccountChargeDto } from './dto/create-account-charge.dto';

describe('AccountChargesService', () => {
  let service: AccountChargesService;
  let prisma: PrismaService;
  let transactionsService: TransactionsService;
  let chargesService: ChargesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountChargesService,
        {
          provide: PrismaService,
          useValue: {
            accountCategory: {
              findUnique: jest.fn(),
            },
            charge: {
              create: jest.fn(),
            },
            accountCharge: {
              create: jest.fn(),
            },
            person: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
            },
            $transaction: jest.fn((callback) => callback(prisma)),
          },
        },
        {
          provide: ChargesService,
          useValue: {
            generateReferenceNumber: jest.fn().mockResolvedValue('REF-123'),
            create: jest.fn().mockResolvedValue({ data: { id: 'charge-1' } }),
          },
        },
        {
          provide: TransactionsService,
          useValue: {
            create: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AccountChargesService>(AccountChargesService);
    prisma = module.get<PrismaService>(PrismaService);
    transactionsService = module.get<TransactionsService>(TransactionsService);
    chargesService = module.get<ChargesService>(ChargesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const defaultCreateDto: CreateAccountChargeDto = {
      title: 'Test Charge',
      amount: 100,
      direction: 'RECEIVABLE',
      dueDate: new Date(),
      categoryId: 'cat-1',
    };

    it('1. Debe fallar si la categoría no existe o está inactiva', async () => {
      jest.spyOn(prisma.accountCategory, 'findUnique').mockResolvedValue(null);

      await expect(service.create(defaultCreateDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(defaultCreateDto)).rejects.toThrow(
        'La categoría seleccionada no existe',
      );

      jest.spyOn(prisma.accountCategory, 'findUnique').mockResolvedValue({
        id: 'cat-1',
        isActive: false,
        name: 'Inactiva',
      } as any);

      await expect(service.create(defaultCreateDto)).rejects.toThrow(
        'La categoría seleccionada no está activa',
      );
    });

    it('2. Debe fallar si la dirección de la categoría no coincide (PAYABLE en INCOME)', async () => {
      jest.spyOn(prisma.accountCategory, 'findUnique').mockResolvedValue({
        id: 'cat-1',
        isActive: true,
        type: 'PAYABLE',
      } as any);

      await expect(service.create(defaultCreateDto)).rejects.toThrow(
        'La categoría no corresponde con el tipo de transacción',
      );
    });

    it('3. Beneficiario opcional (personId) debe validarse', async () => {
      jest.spyOn(prisma.accountCategory, 'findUnique').mockResolvedValue({
        id: 'cat-1',
        isActive: true,
        type: 'RECEIVABLE',
      } as any);

      jest.spyOn(prisma.person, 'findUnique').mockResolvedValue(null);

      await expect(
        service.create({ ...defaultCreateDto, personId: 'p-1' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({ ...defaultCreateDto, personId: 'p-1' }),
      ).rejects.toThrow('La persona especificada no existe');
    });

    it('4. Cargo manual sin pago (no isImmediate) no genera Transaction ni Payment', async () => {
      jest.spyOn(prisma.accountCategory, 'findUnique').mockResolvedValue({
        id: 'cat-1',
        isActive: true,
        type: 'RECEIVABLE',
      } as any);

      const chargeCreateSpy = jest.spyOn(chargesService, 'create');
      
      const accountChargeCreateSpy = jest
        .spyOn(prisma.accountCharge, 'create')
        .mockResolvedValue({ id: 'acc-charge-1', chargeId: 'charge-1' } as any);

      await service.create(defaultCreateDto);

      expect(chargeCreateSpy).toHaveBeenCalled();
      expect(accountChargeCreateSpy).toHaveBeenCalled();
      expect(transactionsService.create).not.toHaveBeenCalled();
    });

    it('5. Cargo directo (isImmediate) llama a TransactionsService con payerPersonId y AccountCharge tiene personId', async () => {
      jest.spyOn(prisma.accountCategory, 'findUnique').mockResolvedValue({
        id: 'cat-1',
        isActive: true,
        type: 'RECEIVABLE',
      } as any);

      jest.spyOn(prisma.person, 'findUnique').mockResolvedValue({ id: 'beneficiary-1' } as any);

      const chargeCreateSpy = jest
        .spyOn(prisma.charge, 'create')
        .mockResolvedValue({ id: 'charge-1' } as any);
      
      const accountChargeCreateSpy = jest
        .spyOn(prisma.accountCharge, 'create')
        .mockResolvedValue({ id: 'acc-charge-1', chargeId: 'charge-1' } as any);

      await service.create({
        ...defaultCreateDto,
        personId: 'beneficiary-1',
        immediatePayment: {
          paymentMethod: PaymentMethod.CASH,
          financialAccountId: 'acc-1',
          payerPersonId: 'payer-1',
        },
      });

      expect(accountChargeCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            personId: 'beneficiary-1',
          }),
        }),
      );

      expect(transactionsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payerPersonId: 'payer-1',
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('6. Cargo directo con Beneficiario NULL', async () => {
      jest.spyOn(prisma.accountCategory, 'findUnique').mockResolvedValue({
        id: 'cat-1',
        isActive: true,
        type: 'RECEIVABLE',
      } as any);

      const chargeCreateSpy = jest
        .spyOn(prisma.charge, 'create')
        .mockResolvedValue({ id: 'charge-1' } as any);
      
      const accountChargeCreateSpy = jest
        .spyOn(prisma.accountCharge, 'create')
        .mockResolvedValue({ id: 'acc-charge-1', chargeId: 'charge-1' } as any);

      await service.create({
        ...defaultCreateDto,
        personId: undefined,
        immediatePayment: {
          paymentMethod: PaymentMethod.CASH,
          financialAccountId: 'acc-1',
          payerPersonId: 'payer-1',
        },
      });

      expect(accountChargeCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            personId: undefined, // Beneficiario nulo
          }),
        }),
      );

      expect(transactionsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payerPersonId: 'payer-1',
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('7. Validar rollback forzado (Error simulado en transactionService)', async () => {
      jest.spyOn(prisma.accountCategory, 'findUnique').mockResolvedValue({
        id: 'cat-1',
        isActive: true,
        type: 'RECEIVABLE',
      } as any);

      jest.spyOn(prisma.charge, 'create').mockResolvedValue({ id: 'charge-1' } as any);
      jest.spyOn(prisma.accountCharge, 'create').mockResolvedValue({ id: 'acc-charge-1' } as any);

      jest.spyOn(transactionsService, 'create').mockRejectedValue(new Error('Rollback provocado'));

      await expect(
        service.create({
          ...defaultCreateDto,
          immediatePayment: {
            paymentMethod: PaymentMethod.CASH,
            financialAccountId: 'acc-1',
          },
        })
      ).rejects.toThrow('Rollback provocado');
    });
  });


});
