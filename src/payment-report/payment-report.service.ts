import { Injectable, NotFoundException, InternalServerErrorException, Logger, BadRequestException } from '@nestjs/common';
import { PrinterService } from 'src/printer/printer.service';
import { transactionByIdReport, bulkPaymentReport, consolidatedReceiptReport } from 'src/reports';
import { convertAmountToWords } from 'src/helpers/numbers-to-words.helper';
import { PrismaService } from 'src/prisma.service';
import { I18nService, I18nContext } from 'nestjs-i18n';
import { Prisma } from 'src/generated/prisma/client';

@Injectable()
export class PaymentReportService {
  private readonly logger = new Logger(PaymentReportService.name);

  constructor(
    private readonly printerService: PrinterService,
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async buildPaymentReceiptData(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        createdBy: { include: { person: true } },
        transactions: {
          include: {
            financialAccount: true,
            payerPerson: true,
          }
        },
        charge: {
          include: {
            membershipCharges: {
              include: {
                playerMembership: {
                  include: { player: { include: { person: true } } },
                },
              },
            },
            studentCharges: {
              include: {
                studentMembership: {
                  include: { student: { include: { person: true } } },
                },
              },
            },
            accountCharge: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Payment with id ${paymentId} not found`);
    }

    const transactionTotal = payment.transactions.reduce(
      (acc, tx) => acc.add(tx.amount),
      new Prisma.Decimal(0)
    );

    if (!payment.amount.equals(transactionTotal)) {
      this.logger.error(
        `[Fail-Safe] Inconsistencia financiera en Payment ${payment.id}. ` +
        `Payment Amount: ${payment.amount}, Transaction Total: ${transactionTotal}, ` +
        `Tx Count: ${payment.transactions.length}, Tx IDs: ${payment.transactions.map(t => t.id).join(', ')}`
      );
      throw new InternalServerErrorException(
        `Existe una inconsistencia financiera en el Payment ${payment.id}. El monto del Payment no coincide con la suma de sus distribuciones.`
      );
    }

    const year = payment.paymentDate.getFullYear();
    const paddedNumber = payment.receiptNumber.toString().padStart(7, '0');
    const receiptNumber = `${paddedNumber}/${year}`;

    const numericAmount = payment.amount.toNumber();
    const amountLiteral = convertAmountToWords(numericAmount);

    const firstTx = payment.transactions[0];
    const payerName = firstTx?.payerPerson
      ? `${firstTx.payerPerson.name} ${firstTx.payerPerson.lastName}`
      : 'No especificado';
    const payerDocument = firstTx?.payerPerson
      ? firstTx.payerPerson.documentNumber
      : 'S/N';
    const payerId = firstTx?.payerPerson?.id;

    const receiverPerson = payment.createdBy?.person;
    const receiverName = receiverPerson
      ? `${receiverPerson.name} ${receiverPerson.lastName}`
      : 'Usuario del Sistema';
    const receiverDocument = receiverPerson
      ? receiverPerson.documentNumber
      : 'S/N';

    let beneficiaryName: string | undefined;
    let beneficiaryId: string | undefined;
    const charge = payment.charge;
    if (charge?.membershipCharges && charge.membershipCharges.length > 0) {
      const person = charge.membershipCharges[0].playerMembership.player.person;
      beneficiaryName = `${person.name} ${person.lastName} ${person.secondLastName || ''}`.trim();
      beneficiaryId = person.id;
    } else if (charge?.studentCharges && charge.studentCharges.length > 0) {
      const person = charge.studentCharges[0].studentMembership.student.person;
      beneficiaryName = `${person.name} ${person.lastName} ${person.secondLastName || ''}`.trim();
      beneficiaryId = person.id;
    } else if (charge?.accountCharge?.personId) {
      beneficiaryId = charge.accountCharge.personId;
    }

    const lang = I18nContext.current()?.lang || 'es';
    
    const distributions = payment.transactions.map(tx => {
       const translatedMethod = this.i18n.translate(`fields.paymentMethods.${tx.paymentMethod}`, { lang });
       return {
         amount: tx.amount.toNumber().toFixed(2),
         paymentMethod: translatedMethod,
         financialAccountName: tx.financialAccount?.name || 'Cuenta',
       };
    });

    const isPartialPayment = charge ? numericAmount < charge.amount.toNumber() : false;

    const getCategoryName = (category?: string) => {
      switch (category) {
        case 'REGISTRATION': return 'Matrícula';
        case 'LATE_FEE': return 'Mora / Recargo';
        case 'NORMAL': return 'Mensualidad / Cuota';
        default: return 'Cargo';
      }
    };

    const paymentMethodString = distributions.map(d => `${d.paymentMethod} - ${d.financialAccountName}: ${d.amount} Bs.`).join('\n');

    return {
      receiptSeries: payment.receiptSeries,
      receiptNumber,
      date: payment.paymentDate,
      payerName,
      payerDocument,
      beneficiaryName,
      amountLiteral,
      amountNumeric: numericAmount.toFixed(2),
      concept: charge?.description || firstTx?.description || (charge?.chargeCategory ? getCategoryName(charge.chargeCategory) : 'Sin concepto'),
      paymentMethod: paymentMethodString,
      receiverName,
      receiverDocument,
      validationUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify/payment/${payment.id}`,
      type: firstTx?.type || 'INCOME',
      isPartialPayment,
      beneficiaryId,
      payerId,
    };
  }

  async getPaymentByIdReport(paymentId: string, isSingle: boolean = false) {
    const data = await this.buildPaymentReceiptData(paymentId);

    // -- ANTIGUO CODIGO INDIVIDUAL (Conservado por solicitud) --
    // const docDefinition = transactionByIdReport({ data: data as any, isSingle });
    // -----------------------------------------------------------

    // Ahora utilizamos el formato de multiples pagos (consolidado) para recibos individuales
    const docDefinition = consolidatedReceiptReport({ data: [data] as any });
    const doc = this.printerService.createPdf(docDefinition);
    return doc;
  }

  async getBulkPaymentReport(paymentIds: string[]) {
    // 1. Eliminar duplicados
    const uniqueIds = Array.from(new Set(paymentIds));

    if (uniqueIds.length === 0) {
      throw new BadRequestException('Debe proveer al menos un ID de pago.');
    }

    // Si solo hay un pago seleccionado, es mejor imprimir el recibo individual
    if (uniqueIds.length === 1) {
      return this.getPaymentByIdReport(uniqueIds[0], false);
    }

    // 2. Obtener datos de cada recibo de forma secuencial (o Promise.all)
    // Usamos Promise.all porque getReceiptData ya lanza NotFoundException
    // si un ID no existe, cumpliendo con la regla de fallar rápido.
    const receiptsData = await Promise.all(
      uniqueIds.map(id => this.buildPaymentReceiptData(id))
    );

    // 3. Validar que todos los recibos pertenezcan al mismo pagador
    const payerIds = new Set(
      receiptsData
        .map((receipt) => receipt.payerId)
        .filter(Boolean),
    );

    if (payerIds.size > 1) {
      throw new BadRequestException(
        'Todos los recibos seleccionados deben pertenecer al mismo pagador.',
      );
    }

    // Invocar el nuevo template consolidated-receipt.report
    const docDefinition = consolidatedReceiptReport({ data: receiptsData as any });
    const doc = this.printerService.createPdf(docDefinition);
    return doc;
  }

  async getTransactionByIdReport(transactionId: string, isSingle: boolean = false) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        payerPerson: true,
        financialAccount: true,
        createdBy: { include: { person: true } },
        payment: {
          include: {
            charge: {
              include: {
                membershipCharges: {
                  include: {
                    playerMembership: { include: { player: { include: { person: true } } } },
                  },
                },
                studentCharges: {
                  include: {
                    studentMembership: { include: { student: { include: { person: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!transaction) throw new NotFoundException(`Transaction with id ${transactionId} not found`);

    const year = transaction.transactionDate.getFullYear();
    const actualReceiptNumber = transaction.payment?.receiptNumber || transaction.receiptNumber;
    const paddedNumber = actualReceiptNumber.toString().padStart(7, '0');
    const receiptNumber = `${paddedNumber}/${year}`;

    const numericAmount = transaction.amount.toNumber();
    const amountLiteral = convertAmountToWords(numericAmount);

    const payerName = transaction.payerPerson ? `${transaction.payerPerson.name} ${transaction.payerPerson.lastName}` : 'No especificado';
    const payerDocument = transaction.payerPerson ? transaction.payerPerson.documentNumber : 'S/N';

    const receiverPerson = transaction.createdBy?.person;
    const receiverName = receiverPerson ? `${receiverPerson.name} ${receiverPerson.lastName}` : 'Usuario del Sistema';
    const receiverDocument = receiverPerson ? receiverPerson.documentNumber : 'S/N';

    let beneficiaryName: string | undefined;
    if (transaction.payment?.charge) {
      const charge = transaction.payment.charge;
      if (charge.membershipCharges && charge.membershipCharges.length > 0) {
        const person = charge.membershipCharges[0].playerMembership.player.person;
        beneficiaryName = `${person.name} ${person.lastName} ${person.secondLastName || ''}`.trim();
      } else if (charge.studentCharges && charge.studentCharges.length > 0) {
        const person = charge.studentCharges[0].studentMembership.student.person;
        beneficiaryName = `${person.name} ${person.lastName} ${person.secondLastName || ''}`.trim();
      }
    }

    const lang = I18nContext.current()?.lang || 'es';
    const translatedPaymentMethod = this.i18n.translate(`fields.paymentMethods.${transaction.paymentMethod}`, { lang });

    const distributions = [{
         amount: numericAmount.toFixed(2),
         paymentMethod: translatedPaymentMethod,
         financialAccountName: transaction.financialAccount?.name || 'Cuenta',
    }];

    const getCategoryName = (category?: string) => {
      switch (category) {
        case 'REGISTRATION': return 'Matrícula';
        case 'LATE_FEE': return 'Mora / Recargo';
        case 'NORMAL': return 'Mensualidad / Cuota';
        default: return 'Cargo';
      }
    };

    const charge = transaction.payment?.charge;
    const paymentMethodString = distributions.map(d => `${d.paymentMethod} - ${d.financialAccountName}: ${d.amount} Bs.`).join('\n');

    const data = {
      receiptSeries: transaction.payment?.receiptSeries || transaction.receiptSeries,
      receiptNumber,
      date: transaction.transactionDate,
      payerName,
      payerDocument,
      beneficiaryName,
      amountLiteral,
      amountNumeric: numericAmount.toFixed(2),
      concept: charge?.description || transaction.description || (charge?.chargeCategory ? getCategoryName(charge.chargeCategory) : 'Sin concepto'),
      paymentMethod: paymentMethodString,
      receiverName,
      receiverDocument,
      validationUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify/${transaction.id}`,
      type: transaction.type,
    };

    const docDefinition = transactionByIdReport({ data: data as any, isSingle });
    const doc = this.printerService.createPdf(docDefinition);
    return doc;
  }
}
