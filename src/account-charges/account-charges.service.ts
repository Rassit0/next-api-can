import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateAccountChargeDto } from './dto/create-account-charge.dto';
import { UpdateAccountChargeDto } from './dto/update-account-charge.dto';
import { PrismaService } from 'src/prisma.service';
import { ChargesService } from 'src/charges/charges.service';
import {
  Prisma,
  StatusCharge,
  TransactionType,
} from 'src/generated/prisma/client';
import { createPaginationResult } from 'src/common/helpers/pagination.helper';
import { TransactionsService } from 'src/transactions/transactions.service';
import { AccountChargesPaginationDto } from './dto/pagination.dto';


@Injectable()
export class AccountChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chargesService: ChargesService,
    private readonly transactionsService: TransactionsService,
  ) {}

  async create(
    createAccountChargeDto: CreateAccountChargeDto,
    userId?: string,
  ) {
    const {
      amount,
      dueDate,
      direction,
      description,
      title,
      immediatePayment,
      ...accountData
    } = createAccountChargeDto;

    const category = await this.prisma.accountCategory.findUnique({
      where: { id: accountData.categoryId },
    });

    if (!category) {
      throw new BadRequestException('La categoría seleccionada no existe');
    }
    if (!category.isActive) {
      throw new BadRequestException('La categoría seleccionada no está activa');
    }
    if (category.type !== direction) {
      throw new BadRequestException('La categoría no corresponde con el tipo de transacción');
    }

    if (accountData.personId) {
      const person = await this.prisma.person.findUnique({
        where: { id: accountData.personId },
      });
      if (!person) {
        throw new BadRequestException('La persona especificada no existe');
      }
    }

    const newAccountCharge = await this.prisma.$transaction(async (tx) => {
      // 1. Delegar al ChargeService para la lógica financiera
      const chargeResult = await this.chargesService.create(
        {
          amount,
          dueDate,
          direction,
          description: description || title,
          status: StatusCharge.PENDING,
        },
        tx,
      );

      // 2. Crear el envoltorio AccountCharge
      const createdAccountCharge = await tx.accountCharge.create({
        data: {
          ...accountData,
          title,
          chargeId: chargeResult.data.id,
          createdById: userId,
          updatedById: userId,
        },
        include: {
          charge: true,
          category: true,
          person: {
            select: { id: true, name: true, lastName: true, email: true },
          },
        },
      });

      let immediateTransaction = null;
      if (immediatePayment) {
        immediateTransaction = await this.transactionsService.create(
          {
            amount,
            type:
              direction === 'RECEIVABLE'
                ? TransactionType.INCOME
                : TransactionType.EXPENSE,
            paymentMethod: immediatePayment.paymentMethod,
            financialAccountId: immediatePayment.financialAccountId,
            transactionDate: immediatePayment.transactionDate 
              ? immediatePayment.transactionDate.toISOString() 
              : new Date().toISOString(),
            description: description || title,
            chargeId: chargeResult.data.id,
            attachmentIds: immediatePayment.attachmentIds,
            payerPersonId: immediatePayment.payerPersonId,
          },
          tx,
        );
      }

      return {
        ...createdAccountCharge,
        immediateTransaction,
      };
    });

    return {
      message: 'Cuenta registrada exitosamente',
      data: newAccountCharge as any,
    };
  }

  async findAll(paginationDto: AccountChargesPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'desc',
      sortField = 'createdAt',
      direction,
      status,
      categoryId,
      personId,
      externalEntity,
    } = paginationDto;

    const skip = (page - 1) * per_page;

    const where: Prisma.AccountChargeWhereInput = {};

    if (categoryId) where.categoryId = categoryId;
    if (personId) where.personId = personId;
    if (externalEntity)
      where.externalEntity = { contains: externalEntity, mode: 'insensitive' };

    // Filtros delegados a Charge
    if (direction || status) {
      where.charge = {};
      if (direction) where.charge.direction = direction;
      if (status) {
        if (Array.isArray(status)) {
          where.charge.status = { in: status };
        } else {
          where.charge.status = status;
        }
      }
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { referenceNumber: { contains: search, mode: 'insensitive' } },
        { externalEntity: { contains: search, mode: 'insensitive' } },
        {
          person: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const [total, data] = await Promise.all([
      this.prisma.accountCharge.count({ where }),
      this.prisma.accountCharge.findMany({
        where,
        skip,
        take: per_page,
        orderBy: { [sortField]: orderBy },
        include: {
          charge: true,
          category: true,
          person: { select: { id: true, name: true, lastName: true } },
        },
      }),
    ]);

    return createPaginationResult(data, total, page, per_page);
  }

  async findOne(id: string) {
    const accountCharge = await this.prisma.accountCharge.findUnique({
      where: { id },
      include: {
        charge: { include: { payments: true } },
        category: true,
        person: true,
      },
    });

    if (!accountCharge) {
      throw new NotFoundException(`Cuenta con id ${id} no encontrada`);
    }

    return { data: accountCharge };
  }

  async update(
    id: string,
    updateAccountChargeDto: UpdateAccountChargeDto,
    userId?: string,
  ) {
    const { data: existing } = await this.findOne(id);

    // Validar inmutabilidad si ya hay transacciones (pagos parciales/totales)
    if (existing.charge.payments.length > 0) {
      throw new BadRequestException(
        'No se puede modificar una cuenta que ya tiene pagos asociados. Debe cancelarla y crear una nueva.',
      );
    }

    const { dueDate, description, title, ...accountData } =
      updateAccountChargeDto;

    // Actualizar el Charge base si hay campos pertinentes
    if (dueDate || description !== undefined) {
      await this.prisma.charge.update({
        where: { id: existing.chargeId },
        data: {
          dueDate,
          description: description !== undefined ? description : undefined,
        },
      });
    }

    // Actualizar el AccountCharge
    const updated = await this.prisma.accountCharge.update({
      where: { id },
      data: {
        ...accountData,
        title: title !== undefined ? title : undefined,
        updatedById: userId,
      },
      include: { charge: true, category: true, person: true },
    });

    return {
      message: 'Cuenta actualizada exitosamente',
      data: updated,
    };
  }

  async remove(id: string, userId?: string) {
    const { data: existing } = await this.findOne(id);

    // Cancelación lógica a través del motor financiero
    await this.prisma.charge.update({
      where: { id: existing.chargeId },
      data: {
        status: StatusCharge.CANCELLED,
        updatedAt: new Date(),
      },
    });

    return { message: 'Cuenta cancelada lógicamente (Estado: CANCELLED)' };
  }


}
