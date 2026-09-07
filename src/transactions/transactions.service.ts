import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { PrismaService } from 'src/prisma.service';
import { TransactionsPaginationDto } from './dto/pagination.dto';
import { createPaginationResult } from 'src/common/helpers/pagination.helper';
import { CreateBulkTransactionDto } from './dto/create-bulk-transaction.dto';
import {
  Prisma,
  StatusCharge,
  CycleEnrollmentStatus,
  PaymentMethod,
  TransactionType,
} from 'src/generated/prisma/client';
import { PaymentStrategyFactory } from './strategies/payment-strategy.factory';
import { ReceiptResolverService } from 'src/payments/receipt-resolver.service';

import { TransactionsMapper } from './transactions.mapper';
import { FinancialAccountsService } from 'src/financial-accounts/financial-accounts.service';
import { syncCycleEnrollmentStatus } from 'src/common/helpers/sync-cycle-enrollment.helper';
import { syncPlayerMembershipStatus } from 'src/common/helpers/sync-player-membership.helper';
import { lockChargeForUpdate } from 'src/common/utils/charge-lock.util';

export const transactionSelect = {
  id: true,
  paymentId: true,
  receiptSeries: true,
  receiptNumber: true,
  amount: true,
  transactionDate: true,
  description: true,
  type: true,
  paymentMethod: true,
  reference: true,
  notes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  financialAccount: {
    select: { name: true },
  },
  payerPerson: {
    select: {
      id: true,
      name: true,
      lastName: true,
      secondLastName: true,
      documentNumber: true,
    },
  },
  payment: {
    select: {
      id: true,
      amount: true,
      receiptSeries: true,
      receiptNumber: true,
      charge: {
        select: {
          id: true,
          description: true,
          amount: true,
          pendingAmount: true,
          status: true,
          accountCharge: {
            select: {
              title: true,
              category: { select: { name: true } },
              person: {
                select: {
                  id: true,
                  name: true,
                  lastName: true,
                  secondLastName: true,
                  documentNumber: true,
                },
              },
            },
          },
          membershipCharges: {
            select: {
              playerMembership: {
                select: {
                  player: {
                    select: {
                      person: {
                        select: {
                          id: true,
                          name: true,
                          lastName: true,
                          secondLastName: true,
                          documentNumber: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          studentCharges: {
            select: {
              studentMembership: {
                select: {
                  student: {
                    select: {
                      person: {
                        select: {
                          id: true,
                          name: true,
                          lastName: true,
                          secondLastName: true,
                          documentNumber: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          sessionBooking: { select: { id: true } },
        },
      },
    },
  },
  attachments: {
    select: {
      id: true,
      originalName: true,
      url: true,
      mimeType: true,
      sizeBytes: true,
    },
  },
  thirdParty: {
    select: {
      id: true,
      name: true,
      documentNumber: true,
    },
  },
} satisfies Prisma.TransactionSelect;

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger('TransactionsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly financialAccountsService: FinancialAccountsService,
    private readonly receiptResolver: ReceiptResolverService,
  ) {}

  async createBulk(
    createBulkDto: CreateBulkTransactionDto,
    tx?: Prisma.TransactionClient,
  ) {
    if (!createBulkDto.charges || createBulkDto.charges.length === 0) {
      throw new BadRequestException(
        'Debe proveer al menos un cargo para procesar.',
      );
    }

    const uniqueChargeIds = new Set(
      createBulkDto.charges.map((c) => c.chargeId),
    );
    if (uniqueChargeIds.size !== createBulkDto.charges.length) {
      throw new BadRequestException(
        'La lista de cargos contiene elementos duplicados.',
      );
    }

    const execute = async (prisma: Prisma.TransactionClient) => {
      const results = [];
      let totalCalculated = 0;

      // Ordenar IDs para prevenir deadlocks en Postgres al hacer el row lock
      const sortedChargeIds = [...createBulkDto.charges]
        .map((c) => c.chargeId)
        .sort();

      for (const chargeId of sortedChargeIds) {
        const lockedCharge = await lockChargeForUpdate(prisma, chargeId);

        if (lockedCharge.status === StatusCharge.CANCELLED) {
          throw new BadRequestException(
            `El cargo con ID ${chargeId} se encuentra cancelado.`,
          );
        }

        const currentPending = Number(
          lockedCharge.pendingAmount.toNumber().toFixed(2),
        );

        if (currentPending <= 0) {
          throw new BadRequestException(
            `El cargo con ID ${chargeId} ya se encuentra pagado.`,
          );
        }

        totalCalculated += currentPending;
      }

      totalCalculated = Number(totalCalculated.toFixed(2));
      if (createBulkDto.totalAmount !== undefined) {
        const declaredTotal = Number(createBulkDto.totalAmount.toFixed(2));
        if (totalCalculated !== declaredTotal) {
          throw new BadRequestException(
            `El monto total declarado (${declaredTotal}) no coincide con la suma de los saldos pendientes de los cargos seleccionados (${totalCalculated}). Es posible que los saldos hayan cambiado.`,
          );
        }
      }

      for (const item of createBulkDto.charges) {
        const chargeState = await prisma.charge.findUnique({
          where: { id: item.chargeId },
        });
        const amountToPay = Number(
          chargeState.pendingAmount.toNumber().toFixed(2),
        );

        const createTxDto: CreateTransactionDto = {
          amount: amountToPay,
          chargeId: item.chargeId,
          type: TransactionType.INCOME,
          payerPersonId: createBulkDto.payerPersonId,
          reference: createBulkDto.reference,
          notes: createBulkDto.notes,
          transactionDate: createBulkDto.transactionDate,
        };

        if (item.splitTransactions && item.splitTransactions.length > 0) {
          createTxDto.splitTransactions = item.splitTransactions;
        } else {
          createTxDto.paymentMethod = createBulkDto.paymentMethod;
          createTxDto.financialAccountId = createBulkDto.financialAccountId;

          if (!createTxDto.paymentMethod || !createTxDto.financialAccountId) {
            throw new BadRequestException(
              `Falta la distribución de pago para el cargo ${item.chargeId} y no se proveyó una configuración global por defecto.`,
            );
          }
        }

        // Reutilizamos la lógica completa de creación individual
        // pasando explícitamente el mismo cliente transaccional de Prisma
        const result = await this.create(createTxDto, prisma);
        results.push(result);
      }

      return {
        message: 'Operación bulk ejecutada correctamente',
        transactionsCount: results.length,
        totalAmount: totalCalculated,
        receiptIds: results
          .map((r) => r.data?.transaction?.paymentId)
          .filter((id): id is string => typeof id === 'string'),
        details: results,
      };
    };

    return tx
      ? await execute(tx)
      : await this.prisma.$transaction(execute, { timeout: 20000 });
  }

  async create(
    createTransactionDto: CreateTransactionDto,
    tx?: Prisma.TransactionClient,
  ) {
    const {
      amount,
      paymentMethod,
      financialAccountId,
      attachmentIds,
      chargeId,
      splitTransactions,
      ...rest
    } = createTransactionDto;

    const isPayment = !!chargeId;
    const mainChargeId = chargeId;

    const transactionsToProcess = isPayment
      ? splitTransactions?.length > 0
        ? splitTransactions
        : [
            {
              amount,
              paymentMethod,
              financialAccountId,
              reference: rest.reference,
            },
          ]
      : [
          {
            amount,
            paymentMethod,
            financialAccountId,
            reference: rest.reference,
          },
        ];

    let totalPaymentAmount = amount;
    if (isPayment) {
      if (!totalPaymentAmount) {
        totalPaymentAmount = transactionsToProcess.reduce(
          (acc, curr) => acc + curr.amount,
          0,
        );
      } else {
        const sum = transactionsToProcess.reduce(
          (acc, curr) => acc + curr.amount,
          0,
        );
        if (Number(sum.toFixed(2)) !== Number(totalPaymentAmount.toFixed(2))) {
          throw new BadRequestException(
            `La suma de las transacciones divididas (${sum}) no coincide con el monto total del pago (${totalPaymentAmount}).`,
          );
        }
      }
    } else {
      if (!totalPaymentAmount) {
        throw new BadRequestException(
          'El monto total es requerido para transacciones independientes.',
        );
      }
    }

    const uniqueAccountIds = [
      ...new Set(transactionsToProcess.map((t) => t.financialAccountId)),
    ];
    const prismaClient = tx || this.prisma;
    const accounts = await prismaClient.financialAccount.findMany({
      where: { id: { in: uniqueAccountIds } },
      select: { id: true, name: true, allowedPaymentMethods: true },
    });

    for (const t of transactionsToProcess) {
      const account = accounts.find((a) => a.id === t.financialAccountId);
      if (!account) {
        throw new BadRequestException(`La cuenta financiera no existe.`);
      }
      if (
        !account.allowedPaymentMethods ||
        account.allowedPaymentMethods.length === 0
      ) {
        throw new BadRequestException(
          `La cuenta '${account.name}' no está configurada y no puede recibir pagos.`,
        );
      }
      if (!account.allowedPaymentMethods.includes(t.paymentMethod)) {
        throw new BadRequestException(
          `La cuenta '${account.name}' no permite pagos mediante ${t.paymentMethod}.`,
        );
      }
    }

    const processedTransactions = await Promise.all(
      transactionsToProcess.map(async (t) => {
        const strategy = PaymentStrategyFactory.getStrategy(t.paymentMethod);
        const result = await strategy.processPayment(t.amount);
        return {
          ...t,
          status: result.transactionStatus,
          providerResponse: result.providerResponse,
        };
      }),
    );

    // TODO: Si integration con S3 esta lista, mapear los archivos a URLs y agregarlos a receiptUrls
    const receiptUrls = [];

    // 3. Ejecutar todo en una transacción de BD
    const execute = async (prisma: Prisma.TransactionClient) => {
      let paymentSeries = 'GEN';
      let paymentSequenceNumber = null;
      let createdPayment = null;
      let charge = null;

      if (isPayment) {
        // El Charge debe bloquearse antes de leer/calcular pendingAmount.
        // Payments, reversos y Late Fees realizan Read-Modify-Write sobre
        // este mismo saldo. El lock evita Lost Updates bajo concurrencia.
        const lockedCharge = await lockChargeForUpdate(prisma, mainChargeId);

        charge = await prisma.charge.findUnique({
          where: { id: mainChargeId },
          include: {
            membershipCharges: {
              include: {
                playerMembership: {
                  include: { player: true },
                },
              },
            },
            studentCharges: {
              include: {
                studentMembership: {
                  include: { student: true },
                },
              },
            },
          },
        });

        if (charge) {
          charge.amount = new Prisma.Decimal(lockedCharge.amount.toString());
          charge.pendingAmount = new Prisma.Decimal(
            lockedCharge.pendingAmount.toString(),
          );
          charge.status = lockedCharge.status;
          charge.adjustmentAmount = lockedCharge.adjustmentAmount
            ? new Prisma.Decimal(lockedCharge.adjustmentAmount.toString())
            : null;
        }

        if (!charge)
          throw new NotFoundException(
            `Cargo con ID ${mainChargeId} no encontrado`,
          );

        if (charge.status === StatusCharge.CANCELLED) {
          throw new BadRequestException(
            `El cargo con ID ${mainChargeId} se encuentra cancelado y no puede recibir pagos.`,
          );
        }

        const currentPending = Number(
          charge.pendingAmount.toNumber().toFixed(2),
        );
        const applied = Number(totalPaymentAmount.toFixed(2));

        if (currentPending < applied) {
          throw new BadRequestException(
            `El monto aplicado (${applied}) supera el saldo pendiente (${currentPending}) del cargo ${charge.id}`,
          );
        }
        if (applied === 0 && currentPending > 0) {
          throw new BadRequestException(
            `Solo se permiten recibos de monto 0 si el cargo tiene un saldo pendiente de 0.`,
          );
        }

        const resolvedReceipt =
          await this.receiptResolver.resolveReceiptForCharge(charge.id, prisma);
        paymentSeries = resolvedReceipt.receiptSeries;
        paymentSequenceNumber = resolvedReceipt.receiptNumber;

        const paymentDateObj = rest.transactionDate
          ? new Date(rest.transactionDate)
          : new Date();

        createdPayment = await prisma.payment.create({
          data: {
            chargeId: charge.id,
            amount: applied,
            receiptSeries: paymentSeries,
            receiptNumber: paymentSequenceNumber,
            status: 'COMPLETED',
            paymentDate: paymentDateObj,
          },
        });

        // Payment created
      }

      let resolvedPayerPersonId = rest.payerPersonId;

      if (isPayment && charge) {
        if (charge.studentCharges?.length > 0) {
          resolvedPayerPersonId =
            charge.studentCharges[0].studentMembership?.student?.personId ||
            resolvedPayerPersonId;
        } else if (charge.membershipCharges?.length > 0) {
          resolvedPayerPersonId =
            charge.membershipCharges[0].playerMembership?.player?.personId ||
            resolvedPayerPersonId;
        }
      }

      const createdTransactions = [];

      for (const t of processedTransactions) {
        let txSeries = 'GEN';
        if (!createdPayment && rest.type === 'EXPENSE') {
          txSeries = 'EGR';
        }

        const nextFinNum = await this.receiptResolver.nextReceiptNumber(
          txSeries,
          prisma,
        );

        const transaction = await prisma.transaction.create({
          data: {
            ...rest,
            payerPersonId: resolvedPayerPersonId,
            transactionDate: rest.transactionDate
              ? new Date(rest.transactionDate).toISOString()
              : new Date().toISOString(),
            receiptSeries: txSeries,
            receiptNumber: nextFinNum,
            amount: t.amount,
            paymentMethod: t.paymentMethod,
            status: t.status,
            financialAccountId: t.financialAccountId,
            reference: t.reference,
            paymentId: createdPayment?.id || null,
          },
        });

        if (t.financialAccountId) {
          await this.financialAccountsService.applyMovement(
            t.financialAccountId,
            t.amount,
            rest.type,
            prisma,
          );
        }
        createdTransactions.push(transaction);
      }

      if (isPayment && charge) {
        const currentPending = Number(
          charge.pendingAmount.toNumber().toFixed(2),
        );
        const applied = Number(totalPaymentAmount.toFixed(2));
        const newPendingAmount = Number((currentPending - applied).toFixed(2));
        const chargeAmount = Number(charge.amount.toNumber().toFixed(2));
        const adjustmentAmount = Number(
          charge.adjustmentAmount?.toNumber() || 0,
        );
        const expectedTotal = chargeAmount + adjustmentAmount;

        let newStatus = charge.status;
        if (newPendingAmount <= 0) {
          newStatus = StatusCharge.PAID;
        } else if (newPendingAmount < expectedTotal) {
          newStatus = StatusCharge.PARTIAL;
        } else {
          newStatus = StatusCharge.PENDING;
        }

        await prisma.charge.update({
          where: { id: charge.id },
          data: {
            pendingAmount: newPendingAmount,
            status: newStatus,
          },
        });

        await syncCycleEnrollmentStatus(prisma, charge.id, newStatus);
        await syncPlayerMembershipStatus(prisma, charge.id, newStatus);
      }

      if (attachmentIds && attachmentIds.length > 0) {
        const attachments = await prisma.attachment.findMany({
          where: { id: { in: attachmentIds } },
        });

        const missingIds = attachmentIds.filter(
          (id) => !attachments.find((a) => a.id === id),
        );
        if (missingIds.length > 0) {
          throw new BadRequestException(
            `Archivos no encontrados: ${missingIds.join(', ')}`,
          );
        }

        // Verificar que estén PENDING
        const invalidAttachments = attachments.filter(
          (a) => a.status !== 'PENDING',
        );
        if (invalidAttachments.length > 0) {
          throw new BadRequestException(
            'Uno o más archivos adjuntos ya han sido enlazados previamente o son inválidos.',
          );
        }

        await prisma.attachment.updateMany({
          where: { id: { in: attachmentIds } },
          data: {
            transactionId: createdTransactions[0].id,
            status: 'LINKED',
          },
        });
      }

      const transactionResponse = await prisma.transaction.findUnique({
        where: { id: createdTransactions[0].id },
        select: transactionSelect,
      });

      return {
        transaction: transactionResponse,
        transactions: createdTransactions,
        payment: createdPayment,
        paymentData: null,
      };
    };

    const createdTransaction = tx
      ? await execute(tx)
      : await this.prisma.$transaction(execute, {
          maxWait: 5000,
          timeout: 10000,
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });

    return {
      message: 'Transacción registrada con éxito',
      data: {
        transaction: TransactionsMapper.toDomain(
          createdTransaction.transaction as any,
        ),
        paymentData: processedTransactions
          .map((pt) => pt.providerResponse)
          .filter(Boolean), // Datos del QR si aplica
      },
    };
  }

  async findAll(paginationDto: TransactionsPaginationDto) {
    const {
      page = 1,
      per_page = 10,
      search,
      sortField,
      orderBy,
      payerPersonId,
      chargeId,
      type,
      paymentMethods,
      financialAccountIds,
      startDate,
      endDate,
      origin,
      categoryId,
      createdById,
    } = paginationDto;

    const skip = (page - 1) * per_page;

    const where: Prisma.TransactionWhereInput = {
      ...(payerPersonId && { payerPersonId }),
      ...(type && { type }),
      ...(paymentMethods?.length && { paymentMethod: { in: paymentMethods } }),
      ...(financialAccountIds?.length && {
        financialAccountId: { in: financialAccountIds },
      }),
      ...(createdById && { createdById }),
      ...((startDate || endDate) && {
        transactionDate: {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) }),
        },
      }),
      ...(chargeId && {
        payment: { chargeId },
      }),
      ...(categoryId && {
        payment: { charge: { accountCharge: { categoryId } } },
      }),
      ...(origin === 'ACCOUNT_CHARGE' && {
        payment: { charge: { accountCharge: { isNot: null } } },
      }),
      ...(origin === 'MEMBERSHIP' && {
        payment: { charge: { membershipCharges: { some: {} } } },
      }),
      ...(origin === 'STUDENT' && {
        payment: { charge: { studentCharges: { some: {} } } },
      }),
      ...(origin === 'BOOKING' && {
        payment: { charge: { sessionBooking: { isNot: null } } },
      }),
      ...(search && {
        AND: search.trim().split(/\s+/).filter(Boolean).map(word => {
          const isNumeric = !isNaN(Number(word));
          // Verificar si tiene formato de recibo (ej: ESC-MAT-7 o GEN-0007)
          const receiptMatch = word.match(/^(.*?)-(\d+)$/);

          const orConditions: Prisma.TransactionWhereInput[] = [
            { description: { contains: word, mode: 'insensitive' } },
            { reference: { contains: word, mode: 'insensitive' } },
            { receiptSeries: { contains: word, mode: 'insensitive' } },
            { payment: { receiptSeries: { contains: word, mode: 'insensitive' } } },
            { payerPerson: { name: { contains: word, mode: 'insensitive' } } },
            { payerPerson: { lastName: { contains: word, mode: 'insensitive' } } },
            { payerPerson: { secondLastName: { contains: word, mode: 'insensitive' } } },
          ];

          if (isNumeric) {
            orConditions.push({ receiptNumber: { equals: parseInt(word, 10) } });
            orConditions.push({ payment: { receiptNumber: { equals: parseInt(word, 10) } } });
          }

          if (receiptMatch) {
            orConditions.push({
              receiptSeries: { contains: receiptMatch[1], mode: 'insensitive' },
              receiptNumber: { equals: parseInt(receiptMatch[2], 10) },
            });
            orConditions.push({
              payment: {
                receiptSeries: { contains: receiptMatch[1], mode: 'insensitive' },
                receiptNumber: { equals: parseInt(receiptMatch[2], 10) },
              }
            });
          }

          return { OR: orConditions };
        })
      }),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: per_page,
        orderBy: [
          { [sortField || 'transactionDate']: orderBy || 'desc' },
          { createdAt: 'desc' },
        ],
        select: transactionSelect,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const mappedItems = items.map((item) =>
      TransactionsMapper.toDomain(item as any),
    );

    return createPaginationResult(mappedItems, totalItems, page, per_page);
  }

  async findOne(id: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      select: transactionSelect,
    });

    if (!transaction) {
      throw new NotFoundException(`Transacción con ID ${id} no encontrada`);
    }

    return TransactionsMapper.toDomain(transaction as any);
  }

  async update(id: string, updateTransactionDto: UpdateTransactionDto) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      throw new NotFoundException(`Transacción con ID ${id} no encontrada`);
    }

    // Proteger campos inmutables del Ledger
    const { amount, type, financialAccountId, ...safeUpdateData } =
      updateTransactionDto as any;

    if (
      amount !== undefined ||
      type !== undefined ||
      financialAccountId !== undefined
    ) {
      // Idealmente podríamos lanzar un error, pero para no romper el frontend si envía el DTO completo,
      // simplemente ignoramos estos campos financieros clave.
    }

    return await this.prisma.transaction.update({
      where: { id },
      data: safeUpdateData,
      select: transactionSelect,
    });
  }

  async remove(id: string) {
    // Busca la transacción con sus pagos aplicados a cargos
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        payment: true,
      },
    });

    if (!transaction) {
      throw new NotFoundException(`Transacción con ID ${id} no encontrada`);
    }

    if (transaction.status === 'CANCELLED') {
      throw new BadRequestException('La transacción ya se encuentra anulada');
    }

    // Usar transacción de Prisma para asegurar consistencia
    return await this.prisma.$transaction(async (prisma) => {
      // Revertir cargos
      if (transaction.payment) {
        // El Charge debe bloquearse antes de leer/calcular pendingAmount.
        // Payments, reversos y Late Fees realizan Read-Modify-Write sobre
        // este mismo saldo. El lock evita Lost Updates bajo concurrencia.
        const lockedCharge = await lockChargeForUpdate(
          prisma,
          transaction.payment.chargeId,
        );

        const charge = await prisma.charge.findUnique({
          where: { id: transaction.payment.chargeId },
        });
        if (charge) {
          charge.amount = new Prisma.Decimal(lockedCharge.amount.toString());
          charge.pendingAmount = new Prisma.Decimal(
            lockedCharge.pendingAmount.toString(),
          );
          charge.status = lockedCharge.status;
          charge.adjustmentAmount = lockedCharge.adjustmentAmount
            ? new Prisma.Decimal(lockedCharge.adjustmentAmount.toString())
            : null;

          const currentPending = Number(
            charge.pendingAmount.toNumber().toFixed(2),
          );
          const applied = Number(transaction.amount.toNumber().toFixed(2));
          const chargeAmount = Number(charge.amount.toNumber().toFixed(2));
          const adjustmentAmount = Number(
            charge.adjustmentAmount?.toNumber() || 0,
          );

          const expectedTotal = chargeAmount + adjustmentAmount;

          const newPendingAmount = Number(
            (currentPending + applied).toFixed(2),
          );
          let newStatus = charge.status;

          // Si el pending es igual o mayor al expectedTotal, vuelve a PENDING
          if (newPendingAmount >= expectedTotal) {
            newStatus = StatusCharge.PENDING;
          } else if (newPendingAmount > 0) {
            newStatus = StatusCharge.PARTIAL; // Si era PAID, ahora debe ser PARTIAL
          }

          await prisma.charge.update({
            where: { id: transaction.payment.chargeId },
            data: {
              pendingAmount: newPendingAmount,
              status: newStatus,
            },
          });

          await syncCycleEnrollmentStatus(
            prisma,
            transaction.payment.chargeId,
            newStatus,
          );
          await syncPlayerMembershipStatus(
            prisma,
            transaction.payment.chargeId,
            newStatus,
          );
        }

        // Anular payment si esta es la única transacción
        const otherTx = await prisma.transaction.count({
          where: {
            paymentId: transaction.paymentId,
            id: { not: transaction.id },
          },
        });
        if (otherTx === 0) {
          await prisma.payment.update({
            where: { id: transaction.paymentId },
            data: { status: 'CANCELLED' },
          });
        }
      }

      // Revertir el saldo de la caja / banco asociada
      if (
        transaction.financialAccountId &&
        transaction.status === 'COMPLETED'
      ) {
        await this.financialAccountsService.applyMovement(
          transaction.financialAccountId,
          -Number(transaction.amount),
          transaction.type,
          prisma,
        );
      }

      // Anular transacción
      const deletedTransaction = await prisma.transaction.update({
        where: { id },
        data: { status: 'CANCELLED' },
        select: transactionSelect,
      });

      return deletedTransaction;
    });
  }



  getPaymentMethods() {
    return {
      data: Object.values(PaymentMethod),
    };
  }
}
