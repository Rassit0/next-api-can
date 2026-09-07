import { Transaction, Charge, Prisma } from 'src/generated/prisma/client';

export type TransactionWithRelations = Prisma.TransactionGetPayload<{
  select: typeof import('./transactions.service').transactionSelect;
}>;

export interface MappedTransaction {
  id: string;
  paymentId: string | null;
  type: string;
  amount: number;
  concept: string;
  category: string | null;
  origin: string;
  paymentMethod: string;
  transactionDate: Date;
  status: string;
  receiptSeries: string;
  receiptNumber: number;
  reference: string | null;
  financialAccountName: string | null;
  thirdParty: {
    id: string;
    name: string;
    documentNumber: string | null;
  } | null;
  payerPerson: {
    id: string;
    name: string;
    lastName: string | null;
    documentNumber: string | null;
  } | null;
  attachments: {
    id: string;
    originalName: string;
    url: string | null;
    mimeType: string;
    sizeBytes: number;
  }[];
  createdAt: Date;
}

export class TransactionsMapper {
  static toDomain(transaction: TransactionWithRelations): MappedTransaction {
    // Definir valores por defecto
    let concept = transaction.description || 'Movimiento sin concepto';
    let category = null;
    let origin = 'UNKNOWN';

    // Resolver contexto a partir del cargo principal pagado (si lo hay)
    if (transaction.payment && transaction.payment.charge) {
      // Tomamos el cargo asociado al pago
      const mainCharge = transaction.payment.charge as any;

      if (mainCharge.accountCharge) {
        origin = 'ACCOUNT_CHARGE';
        concept = mainCharge.accountCharge.title || mainCharge.description || concept;
        category = mainCharge.accountCharge.category?.name || null;
      } else if (mainCharge.membershipCharges && mainCharge.membershipCharges.length > 0) {
        origin = 'MEMBERSHIP';
        concept = mainCharge.description || 'Pago de Membresía';
        category = 'Membresías'; // Categoría por defecto para membresías
      } else if (mainCharge.studentCharges && mainCharge.studentCharges.length > 0) {
        origin = 'STUDENT';
        concept = mainCharge.description || 'Pago de Colegiatura';
        category = 'Academia';
      } else if (mainCharge.sessionBooking) {
        origin = 'BOOKING';
        concept = mainCharge.description || 'Reserva de Cancha';
        category = 'Reservas';
      } else {
        origin = 'GENERIC_CHARGE';
        concept = mainCharge.description || concept;
      }
    }

      let mappedThirdParty = transaction.thirdParty || null;
      if (!mappedThirdParty && transaction.payment?.charge?.accountCharge?.person) {
        const p = transaction.payment.charge.accountCharge.person;
        mappedThirdParty = {
          id: p.id,
          name: `${p.lastName || ''} ${(p as any).secondLastName || ''} ${p.name}`.replace(/\s+/g, ' ').trim(),
          documentNumber: p.documentNumber || null,
        };
      } else if (!mappedThirdParty && transaction.payment?.charge?.membershipCharges?.[0]?.playerMembership?.player?.person) {
        const p = transaction.payment.charge.membershipCharges[0].playerMembership.player.person;
        mappedThirdParty = {
          id: p.id,
          name: `${p.lastName || ''} ${(p as any).secondLastName || ''} ${p.name}`.replace(/\s+/g, ' ').trim(),
          documentNumber: p.documentNumber || null,
        };
      } else if (!mappedThirdParty && transaction.payment?.charge?.studentCharges?.[0]?.studentMembership?.student?.person) {
        const p = transaction.payment.charge.studentCharges[0].studentMembership.student.person;
        mappedThirdParty = {
          id: p.id,
          name: `${p.lastName || ''} ${(p as any).secondLastName || ''} ${p.name}`.replace(/\s+/g, ' ').trim(),
          documentNumber: p.documentNumber || null,
        };
      }

      return {
        id: transaction.id,
        paymentId: transaction.paymentId || null,
        type: transaction.type,
        amount: Number(transaction.amount),
        concept,
        category,
        origin,
        paymentMethod: transaction.paymentMethod,
        transactionDate: transaction.transactionDate,
        status: transaction.status,
        receiptSeries: transaction.payment?.receiptSeries || transaction.receiptSeries,
        receiptNumber: transaction.payment?.receiptNumber || transaction.receiptNumber,
        reference: transaction.reference,
        financialAccountName: (transaction as any).financialAccount?.name || null,
        thirdParty: mappedThirdParty,
        payerPerson: (transaction as any).payerPerson || null,
        attachments: transaction.attachments || [],
        createdAt: transaction.createdAt,
      };
  }
}
