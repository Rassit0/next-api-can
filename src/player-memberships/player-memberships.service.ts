import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreatePlayerMembershipDto } from './dto/create-player-membership.dto';
import { UpdatePlayerMembershipDto } from './dto/update-player-membership.dto';
import { PrismaService } from 'src/prisma.service';
import {
  PlayerMembershipStatus,
  Prisma,
  StatusTeamSeason,
  StatusCharge,
  TeamSeasonCategoryStatus,
} from 'src/generated/prisma/client';
import { PlayerMembershipsPaginationDto } from './dto/pagination.dto';

export const playerMembershipSelect = {
  id: true,
  playerId: true,
  player: {
    select: {
      person: {
        select: {
          name: true,
          lastName: true,
          secondLastName: true,
          email: true,
          phone: true,
          birthDate: true,
          documentNumber: true,
          documentType: true,
        },
      },
    },
  },
  teamSeasonId: true,
  teamSeason: {
    select: {
      team: {
        select: {
          id: true,
          name: true,
          clubId: true,
          club: {
            select: {
              disciplineId: true,
            },
          },
        },
      },
      season: {
        select: {
          name: true,
        },
      },
    },
  },
  teamSeasonCategoryId: true,
  teamSeasonCategories: {
    select: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  paymentPlanId: true,
  paymentPlan: true,
  startedAt: true,
  endedAt: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  membershipCharges: {
    where: {
      charge: {
        status: {
          not: 'CANCELLED',
        },
      },
    },
    select: {
      charge: {
        select: {
          pendingAmount: true,
          amount: true,
          adjustmentAmount: true,
        },
      },
    },
  },
} satisfies Prisma.PlayerMembershipSelect;

type PlayerMembershipWithCharges = Prisma.PlayerMembershipGetPayload<{
  select: typeof playerMembershipSelect;
}>;

const mapMembershipWithTotal = (membership: PlayerMembershipWithCharges) => {
  const totalPendingAmount = Number(
    (
      membership.membershipCharges?.reduce(
        (sum, current) => sum + Number(current.charge.pendingAmount),
        0,
      ) || 0
    ).toFixed(2),
  );

  const totalPaidAmount = Number(
    (
      membership.membershipCharges?.reduce(
        (sum, current) =>
          sum +
          (Number(current.charge.amount) +
            Number(current.charge.adjustmentAmount || 0) -
            Number(current.charge.pendingAmount)),
        0,
      ) || 0
    ).toFixed(2),
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { membershipCharges, ...rest } = membership;

  return {
    ...rest,
    totalPendingAmount,
    totalPaidAmount,
  };
};

type PlayerWithPerson = Prisma.PlayerGetPayload<{
  include: {
    person: true;
  };
}>;

type TeamMembershipOfferingWithCategory = Prisma.TeamSeasonCategoryGetPayload<{
  include: {
    category: {
      select: {
        minAge: true;
        maxAge: true;
      };
    };
    teamSeason: {
      include: {
        season: {
          select: {
            startDate: true;
            endDate: true;
          };
        };
      };
    };
  };
}> & {
  minBirthYear: number | null;
  maxBirthYear: number | null;
  validateAge: boolean;
};

import { MembershipChargesService } from 'src/membership-charges/membership-charges.service';
import { PaginationDto } from 'src/common/dto/pagination';
import { CreatePlayerMembershipPauseDto } from './dto/create-player-membership-pause.dto';
import { PlayersOptionsPaginationDto } from './dto/players-options-pagination.dto';

@Injectable()
export class PlayerMembershipsService {
  private readonly logger = new Logger('PlayerMembershipsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly membershipChargesService: MembershipChargesService,
  ) {}

  async create(createDto: CreatePlayerMembershipDto) {
    const offering = await this.getTeamMembershipOffering(
      createDto.teamSeasonCategoryId,
    );

    await this.validatePaymentPlan(
      createDto.paymentPlanId,
      offering.teamSeasonId,
    );

    const player = await this.getPlayer(createDto.playerId);

    this.validateMembershipStartDate(
      new Date(createDto.startedAt),
      offering.teamSeason.season.startDate,
      offering.teamSeason.season.endDate,
    );

    await this.validateOfferingCapacity(offering.id, offering.maxMembers);

    await this.validateDuplicateMembership(
      createDto.playerId,
      offering.teamSeasonId,
    );

    this.validatePlayerEligibility(player, offering);

    if (
      createDto.membershipDiscounts &&
      createDto.membershipDiscounts.length > 0
    ) {
      this.validateDiscountDates(
        createDto.membershipDiscounts,
        offering.teamSeason.season.startDate,
        offering.teamSeason.season.endDate,
      );
    }

    const {
      membershipDiscounts,
      chargeRegistrationOnMigration,
      chargeCurrentMonthOnMigration,
      ...createData
    } = createDto;

    const membership = await this.prisma.playerMembership.create({
      data: {
        ...createData,
        teamSeasonId: offering.teamSeasonId,
        ...(membershipDiscounts &&
          membershipDiscounts.length > 0 && {
            membershipDiscounts: {
              create: membershipDiscounts.map((d) => ({
                ...d,
                startDate: new Date(d.startDate),
                endDate: d.endDate ? new Date(d.endDate) : null,
              })),
            },
          }),
        histories: {
          create: {
            previousStatus: null,
            newStatus:
              createData.status ?? PlayerMembershipStatus.PENDING_ACTIVE,
            reason: createData.notes ?? 'Creación de membresía',
          },
        },
      },
      select: playerMembershipSelect,
    });

    // Generar cargos inmediatamente después de crear la membresía
    const generatedChargeIds = await this.membershipChargesService.generateChargesForNewMembership(
      membership.id,
      {
        chargeRegistrationOnMigration: createDto.chargeRegistrationOnMigration,
        chargeCurrentMonthOnMigration: createDto.chargeCurrentMonthOnMigration,
      },
    );

    return {
      message: 'Membresía creada exitosamente',
      data: mapMembershipWithTotal(membership),
      generatedChargeIds,
    };
  }

  private calculateAge(birthDate: Date, referenceDate: Date): number {
    return referenceDate.getFullYear() - birthDate.getFullYear();
  }

  private validatePlayerAge(
    birthDate: Date,
    referenceDate: Date,
    minAge?: number,
    maxAge?: number | null,
  ) {
    const playerAge = this.calculateAge(birthDate, referenceDate);

    if (maxAge && playerAge > maxAge) {
      throw new BadRequestException(
        'El jugador es demasiado mayor para esta categoría',
      );
    }

    if (minAge && playerAge < minAge) {
      throw new BadRequestException(
        'El jugador es demasiado joven para esta categoría',
      );
    }
  }

  private validateDiscountDates(
    discounts: any[],
    seasonStartDate: Date,
    seasonEndDate: Date,
  ) {
    for (const d of discounts) {
      const dStart = new Date(d.startDate);
      if (dStart < seasonStartDate || dStart > seasonEndDate) {
        throw new BadRequestException(
          `La fecha de inicio del descuento (${dStart.toLocaleDateString()}) debe estar dentro de la temporada (${seasonStartDate.toLocaleDateString()} - ${seasonEndDate.toLocaleDateString()})`,
        );
      }
      if (d.endDate) {
        const dEnd = new Date(d.endDate);
        if (dEnd < dStart) {
          throw new BadRequestException(
            'La fecha de fin del descuento no puede ser menor a la fecha de inicio',
          );
        }
        if (dEnd > seasonEndDate) {
          throw new BadRequestException(
            `La fecha de fin del descuento (${dEnd.toLocaleDateString()}) no puede exceder el fin de la temporada (${seasonEndDate.toLocaleDateString()})`,
          );
        }
      }
    }
  }

  async findAll(paginationDto: PlayerMembershipsPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'asc',
      sortField = 'lastName',
      playerId,
      teamSeasonCategoryId,
      teamSeasonId,
      paymentPlanId,
      status,
    } = paginationDto;
    // Calcular el offset para la paginación
    const skip = (page - 1) * per_page;

    const where: Prisma.PlayerMembershipWhereInput = {};

    if (playerId) {
      where.playerId = playerId;
    }

    if (teamSeasonCategoryId) {
      where.teamSeasonCategoryId = teamSeasonCategoryId;
    }

    if (teamSeasonId) {
      where.teamSeasonId = teamSeasonId;
    }

    if (paymentPlanId) {
      where.paymentPlanId = paymentPlanId;
    }

    if (status) {
      where.status = status;
    }

    if (search) {
      const searchTerms = search.trim().split(/\s+/);
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          search,
        );

      where.OR = [];

      if (isUuid) {
        where.OR.push({ id: search });
      }

      where.OR.push({
        player: {
          person: {
            AND: searchTerms.map((term) => ({
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
                { secondLastName: { contains: term, mode: 'insensitive' } },
                { documentNumber: { contains: term, mode: 'insensitive' } },
              ],
            })),
          },
        },
      });
    }

    // `globalWhere` se usa para obtener el "Summary" global, ignorando filtros de búsqueda o de estado.
    const globalWhere: Prisma.PlayerMembershipWhereInput = {};
    if (playerId) globalWhere.playerId = playerId;
    if (teamSeasonCategoryId)
      globalWhere.teamSeasonCategoryId = teamSeasonCategoryId;
    if (paymentPlanId) globalWhere.paymentPlanId = paymentPlanId;

    // Ejecutamos las consultas en paralelo para máxima velocidad
    const [
      playerMemberships,
      totalItems,
      allCharges,
      activeMembersCount,
      suspendedMembersCount,
      pendingActiveMembersCount,
      teamSeasonData,
    ] = await Promise.all([
      this.prisma.playerMembership.findMany({
        where,
        take: per_page,
        skip,
        orderBy:
          sortField === 'lastName' || sortField === 'name'
            ? [
                { player: { person: { lastName: orderBy } } },
                { player: { person: { name: orderBy } } },
              ]
            : { [sortField]: orderBy },
        select: playerMembershipSelect,
      }),
      this.prisma.playerMembership.count({ where }),
      this.prisma.membershipCharge.findMany({
        where: {
          playerMembership: globalWhere,
          charge: {
            status: {
              not: 'CANCELLED',
            },
          },
        },
        select: {
          charge: {
            select: {
              amount: true,
              pendingAmount: true,
              adjustmentAmount: true,
            },
          },
        },
      }),
      this.prisma.playerMembership.count({
        where: { ...globalWhere, status: 'ACTIVE' },
      }),
      this.prisma.playerMembership.count({
        where: { ...globalWhere, status: 'SUSPENDED' },
      }),
      this.prisma.playerMembership.count({
        where: { ...globalWhere, status: 'PENDING_ACTIVE' },
      }),
      teamSeasonCategoryId
        ? this.prisma.teamSeasonCategory.findUnique({
            where: { id: teamSeasonCategoryId },
            select: { maxMembers: true },
          })
        : Promise.resolve(null),
    ]);

    // Calcular totales globales (facturado, recaudado y pendiente) para esta búsqueda
    const globalTotalBilled = Number(
      allCharges
        .reduce((sum, mc) => sum + (Number(mc.charge.amount) || 0), 0)
        .toFixed(2),
    );
    const globalTotalPending = Number(
      allCharges
        .reduce((sum, mc) => sum + (Number(mc.charge.pendingAmount) || 0), 0)
        .toFixed(2),
    );
    const globalTotalPaid = Number(
      allCharges
        .reduce(
          (sum, mc) =>
            sum +
            (Number(mc.charge.amount) -
              (Number(mc.charge.pendingAmount) || 0) -
              (Number(mc.charge.adjustmentAmount) || 0)),
          0,
        )
        .toFixed(2),
    );

    // Lógica de metadatos
    const totalPages = Math.ceil(totalItems / per_page);

    // Si el usuario pide un page que no existe, Prisma ya puso [] en 'disciplines'.
    // Calculamos la página actual basándonos en el page solicitado.
    const currentPage = page;

    return {
      message: 'Membresías de jugador a equipo obtenidas exitosamente',
      data: playerMemberships.map(mapMembershipWithTotal), // Será [] si la página no existe o no hay registros
      summary: {
        totalBilled: globalTotalBilled,
        totalPaid: globalTotalPaid,
        totalPending: globalTotalPending,
        activeMembers: activeMembersCount,
        suspendedMembers: suspendedMembersCount,
        pendingMembers: pendingActiveMembersCount,
        occupiedSlotsCount:
          activeMembersCount +
          suspendedMembersCount +
          pendingActiveMembersCount,
        maxMembers: teamSeasonData?.maxMembers || null,
      },
      meta: {
        totalItems, // Ej: 25
        itemsPerPage: per_page, // Ej: 10
        totalPages, // Ej: 3
        currentPage, // Ej: 10 (si el usuario pidió el page 90)
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        nextPage: page < totalPages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null,
      },
    };
  }

  async findOne(id: string) {
    const playerMembership = await this.prisma.playerMembership.findUnique({
      where: { id },
      select: playerMembershipSelect,
    });
    if (!playerMembership) {
      throw new NotFoundException(
        'La membresía de jugador a equipo no fue encontrada',
      );
    }
    return {
      data: mapMembershipWithTotal(playerMembership),
      message: 'Membresía de jugador a equipo obtenida exitosamente',
    };
  }

  async update(id: string, updateDto: UpdatePlayerMembershipDto) {
    const membership = await this.prisma.playerMembership.findUnique({
      where: { id },
    });

    if (!membership) {
      throw new NotFoundException(
        'La membresía de jugador a equipo no fue encontrada',
      );
    }

    const playerId = updateDto.playerId ?? membership.playerId;

    const offeringId =
      updateDto.teamSeasonCategoryId ?? membership.teamSeasonCategoryId;

    const offering = await this.getTeamMembershipOffering(offeringId);

    if (updateDto.paymentPlanId) {
      await this.validatePaymentPlan(
        updateDto.paymentPlanId,
        offering.teamSeasonId,
      );
    }

    const player = await this.getPlayer(playerId);

    this.validateMembershipStartDate(
      updateDto.startedAt
        ? new Date(updateDto.startedAt)
        : membership.startedAt,
      offering.teamSeason.season.startDate,
      offering.teamSeason.season.endDate,
    );

    this.validatePlayerEligibility(player, offering);

    const isChangingOffering =
      updateDto.teamSeasonCategoryId &&
      updateDto.teamSeasonCategoryId !== membership.teamSeasonCategoryId;

    if (isChangingOffering) {
      await this.validateOfferingCapacity(offering.id, offering.maxMembers);

      await this.validateDuplicateMembership(
        playerId,
        offering.teamSeasonId,
        id,
      );
    }

    const { membershipDiscounts, ...updateData } = updateDto;

    const updatedMembership = await this.prisma.playerMembership.update({
      where: { id },
      data: {
        ...updateData,
        ...(updateData.teamSeasonCategoryId && {
          teamSeasonId: offering.teamSeasonId,
        }),
      },
      select: playerMembershipSelect,
    });

    // Si se modificó el plan de pago, recalculamos los cargos pendientes
    if (
      updateDto.paymentPlanId &&
      updateDto.paymentPlanId !== membership.paymentPlanId
    ) {
      // Usamos .catch para que no bloquee la respuesta si hay un error en la regeneración
      this.membershipChargesService
        .recalculatePendingFutureCharges(id)
        .catch((e) => {
          this.logger.error(
            `Error al recalcular cargos tras cambio de plan en membresía ${id}`,
            e.stack,
          );
        });
    }

    return {
      message: 'Membresía de jugador a equipo actualizada exitosamente',
      data: mapMembershipWithTotal(updatedMembership),
    };
  }

  async finish(id: string, reason: string) {
    const membership = await this.getMembership(id);

    if (membership.status === PlayerMembershipStatus.FINISHED) {
      throw new BadRequestException('La membresía ya se encuentra finalizada');
    }

    if (membership.status === PlayerMembershipStatus.SUSPENDED) {
      throw new BadRequestException(
        'La membresía se encuentra suspendida y no puede ser finalizada',
      );
    }

    if (membership.status === PlayerMembershipStatus.WITHDRAWN) {
      throw new BadRequestException(
        'La membresía se encuentra retirada y no puede ser suspendida',
      );
    }

    const finishedMembership = await this.prisma.playerMembership.update({
      where: { id },
      data: {
        status: PlayerMembershipStatus.FINISHED,
        endedAt: new Date(),
        notes: reason,
        histories: {
          create: {
            previousStatus: membership.status,
            newStatus: PlayerMembershipStatus.FINISHED,
            reason,
          },
        },
      },
      select: playerMembershipSelect,
    });

    return {
      message: 'Membresía finalizada exitosamente',
      data: mapMembershipWithTotal(finishedMembership),
    };
  }

  async suspend(id: string, reason: string) {
    const membership = await this.getMembership(id);

    if (membership.status === PlayerMembershipStatus.FINISHED) {
      throw new BadRequestException(
        'La membresía se encuentra finalizada y no puede ser suspendida',
      );
    }

    if (membership.status === PlayerMembershipStatus.SUSPENDED) {
      throw new BadRequestException('La membresía ya se encuentra suspendida');
    }

    if (membership.status === PlayerMembershipStatus.WITHDRAWN) {
      throw new BadRequestException(
        'La membresía se encuentra retirada y no puede ser suspendida',
      );
    }

    const finishedMembership = await this.prisma.playerMembership.update({
      where: { id },
      data: {
        status: PlayerMembershipStatus.SUSPENDED,
        notes: reason,
        histories: {
          create: {
            previousStatus: membership.status,
            newStatus: PlayerMembershipStatus.SUSPENDED,
            reason,
          },
        },
      },
      select: playerMembershipSelect,
    });

    return {
      message: 'Membresía suspendida exitosamente',
      data: mapMembershipWithTotal(finishedMembership),
    };
  }

  async withdraw(id: string, reason: string) {
    const membership = await this.getMembership(id);

    if (membership.status === PlayerMembershipStatus.FINISHED) {
      throw new BadRequestException(
        'La membresía se encuentra finalizada y no puede ser retirada',
      );
    }

    if (membership.status === PlayerMembershipStatus.WITHDRAWN) {
      throw new BadRequestException('La membresía ya se encuentra retirada');
    }

    const finishedMembership = await this.prisma.playerMembership.update({
      where: { id },
      data: {
        status: PlayerMembershipStatus.WITHDRAWN,
        endedAt: new Date(),
        notes: reason,
        histories: {
          create: {
            previousStatus: membership.status,
            newStatus: PlayerMembershipStatus.WITHDRAWN,
            reason,
          },
        },
      },
      select: playerMembershipSelect,
    });

    // Cancelar cargos futuros pendientes
    const pendingCharges = await this.prisma.membershipCharge.findMany({
      where: {
        playerMembershipId: id,
        charge: { status: StatusCharge.PENDING },
      },
      select: {
        chargeId: true,
        charge: {
          select: { description: true },
        },
      },
    });

    if (pendingCharges.length > 0) {
      const cancelReason = reason
        ? `(Cancelado por retiro: ${reason})`
        : '(Cancelado por retiro de membresía)';

      const updatePromises = pendingCharges.map((pc) => {
        const newDescription = pc.charge.description
          ? `${pc.charge.description} ${cancelReason}`
          : cancelReason;

        return this.prisma.charge.update({
          where: { id: pc.chargeId },
          data: {
            status: StatusCharge.CANCELLED,
            description: newDescription,
          },
        });
      });

      await Promise.all(updatePromises);
    }

    return {
      message: 'Membresía retirada exitosamente',
      data: mapMembershipWithTotal(finishedMembership),
    };
  }

  async reactivate(id: string, reason: string) {
    const membership = await this.getMembership(id);

    if (membership.status !== PlayerMembershipStatus.SUSPENDED) {
      throw new BadRequestException(
        'Solo una membresía suspendida puede reactivarse',
      );
    }

    const updatedMembership = await this.prisma.playerMembership.update({
      where: { id },
      data: {
        status: PlayerMembershipStatus.ACTIVE,
        notes: reason,
        histories: {
          create: {
            previousStatus: membership.status,
            newStatus: PlayerMembershipStatus.ACTIVE,
            reason,
          },
        },
      },
      select: playerMembershipSelect,
    });

    return {
      message: 'Membresía reactivada exitosamente',
      data: mapMembershipWithTotal(updatedMembership),
    };
  }

  async activate(id: string, reason?: string) {
    const membership = await this.getMembership(id);

    if (membership.status !== PlayerMembershipStatus.PENDING_ACTIVE) {
      throw new BadRequestException(
        'Solo una membresía pendiente puede ser activada',
      );
    }

    const offering = await this.getTeamMembershipOffering(
      membership.teamSeasonCategoryId,
    );

    await this.validateOfferingCapacity(offering.id, offering.maxMembers);

    const updatedMembership = await this.prisma.playerMembership.update({
      where: { id },
      data: {
        status: PlayerMembershipStatus.ACTIVE,
        notes: reason,
        histories: {
          create: {
            previousStatus: membership.status,
            newStatus: PlayerMembershipStatus.ACTIVE,
            reason,
          },
        },
      },
      select: playerMembershipSelect,
    });

    return {
      message: 'Membresía activada exitosamente',
      data: mapMembershipWithTotal(updatedMembership),
    };
  }

  async remove(id: string) {
    const membership = await this.prisma.playerMembership.findUnique({
      where: { id },
      include: {
        membershipCharges: {
          include: {
            charge: {
              include: {
                payments: true,
                childCharges: true,
              },
            },
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'La membresía de jugador a equipo no fue encontrada',
      );
    }

    // Validar que no hayan cargos pagados, parcialmente pagados, o transacciones de pago vinculadas.
    const hasTransactionsOrPaid = membership.membershipCharges.some(
      (mc) =>
        (mc.charge.status !== StatusCharge.PENDING &&
          mc.charge.status !== StatusCharge.CANCELLED) ||
        Number(mc.charge.amount) - Number(mc.charge.adjustmentAmount) >
          Number(mc.charge.pendingAmount) ||
        mc.charge.payments.length > 0 ||
        mc.charge.childCharges.length > 0,
    );

    if (hasTransactionsOrPaid) {
      throw new BadRequestException(
        'No se puede eliminar la membresía porque cuenta con pagos registrados, transacciones o cargos anidados. En su lugar, utilice la opción de Finalizar o Retirar.',
      );
    }

    // Si llegamos aquí, es 100% seguro eliminar la membresía y limpiar el historial y los cargos.
    const chargeIds = membership.membershipCharges.map((mc) => mc.chargeId);

    await this.prisma.$transaction([
      // 1. Borrar historial de pausas
      this.prisma.playerMembershipPause.deleteMany({
        where: { playerMembershipId: id },
      }),
      // 2. Borrar historial de estados de membresía
      this.prisma.playerMembershipHistory.deleteMany({
        where: { playerMembershipId: id },
      }),
      // 3. Borrar descuentos asociados
      this.prisma.membershipDiscount.deleteMany({
        where: { playerMembershipId: id },
      }),
      // 4. Borrar la tabla pivote de cargos
      this.prisma.membershipCharge.deleteMany({
        where: { playerMembershipId: id },
      }),
      // 5. Borrar los cargos reales vinculados a la membresía (ya no tendrán referencias)
      this.prisma.charge.deleteMany({
        where: { id: { in: chargeIds } },
      }),
      // 6. Finalmente, borrar la membresía
      this.prisma.playerMembership.delete({
        where: { id },
      }),
    ]);

    return {
      message: 'Membresía eliminada de forma permanente y segura',
      data: null,
    };
  }

  private async getMembership(id: string) {
    const membership = await this.prisma.playerMembership.findUnique({
      where: { id },
    });

    if (!membership) {
      throw new NotFoundException(
        'La membresía de jugador a equipo no fue encontrada',
      );
    }
    return membership;
  }

  private async validatePaymentPlan(
    paymentPlanId: string,
    teamSeasonId: string,
  ) {
    const paymentPlan = await this.prisma.paymentPlan.findUnique({
      where: { id: paymentPlanId },
    });

    if (!paymentPlan) {
      throw new BadRequestException('El plan de pago no fue encontrado');
    }

    if (paymentPlan.teamSeasonId !== teamSeasonId) {
      throw new BadRequestException(
        'El plan de pago no pertenece a la oferta seleccionada',
      );
    }
  }

  private async getPlayer(playerId: string) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: {
        person: true,
      },
    });

    if (!player) {
      throw new NotFoundException('El jugador no fue encontrado');
    }

    return player;
  }

  private async getTeamMembershipOffering(teamSeasonCategoryId: string) {
    const offering = await this.prisma.teamSeasonCategory.findUnique({
      where: { id: teamSeasonCategoryId },
      include: {
        category: {
          select: {
            minAge: true,
            maxAge: true,
          },
        },
        teamSeason: {
          include: {
            season: {
              select: {
                startDate: true,
                endDate: true,
              },
            },
          },
        },
      },
    });

    if (!offering) {
      throw new NotFoundException(
        'La oferta de membresía de equipo no fue encontrada',
      );
    }

    if (offering.status === TeamSeasonCategoryStatus.FINISHED) {
      throw new BadRequestException(
        'No se puede crear una membresía en una categoría finalizada.',
      );
    }

    return offering;
  }

  private async validateOfferingCapacity(
    offeringId: string,
    maxMembers: number | null,
  ) {
    if (maxMembers === null) return;

    const activeMembers = await this.prisma.playerMembership.count({
      where: {
        teamSeasonCategoryId: offeringId,
        status: {
          in: [PlayerMembershipStatus.ACTIVE, PlayerMembershipStatus.SUSPENDED],
        },
      },
    });

    if (activeMembers >= maxMembers) {
      throw new BadRequestException(
        'La oferta ya alcanzó el número máximo de miembros',
      );
    }
  }

  private async validateDuplicateMembership(
    playerId: string,
    teamSeasonId: string,
    currentMembershipId?: string,
  ) {
    const existingMembership = await this.prisma.playerMembership.findFirst({
      where: {
        playerId,
        teamSeasonId,
        status: {
          in: [
            PlayerMembershipStatus.ACTIVE,
            PlayerMembershipStatus.PENDING_ACTIVE,
            PlayerMembershipStatus.SUSPENDED,
          ],
        },
        ...(currentMembershipId && {
          NOT: {
            id: currentMembershipId,
          },
        }),
      },
    });

    if (existingMembership) {
      throw new BadRequestException(
        'El jugador ya se encuentra registrado y activo (o suspendido) en esta oferta',
      );
    }
  }

  private validatePlayerEligibility(
    player: PlayerWithPerson,
    offering: TeamMembershipOfferingWithCategory,
  ) {
    if (!player.isActive) {
      throw new BadRequestException('El jugador se encuentra inactivo');
    }

    if (offering.validateAge !== false) {
      if (!player.person.birthDate) {
        throw new BadRequestException(
          'La fecha de nacimiento del jugador no fue encontrada',
        );
      }

      if (offering.minBirthYear || offering.maxBirthYear) {
        const birthYear = player.person.birthDate.getFullYear();
        if (offering.maxBirthYear && birthYear > offering.maxBirthYear) {
          throw new BadRequestException(
            `El año de nacimiento del jugador (${birthYear}) supera el año máximo permitido (${offering.maxBirthYear}) para esta temporada.`,
          );
        }
        if (offering.minBirthYear && birthYear < offering.minBirthYear) {
          throw new BadRequestException(
            `El año de nacimiento del jugador (${birthYear}) es inferior al año mínimo permitido (${offering.minBirthYear}) para esta temporada.`,
          );
        }
      } else {
        this.validatePlayerAge(
          player.person.birthDate,
          offering.teamSeason.season.startDate,
          offering.category.minAge,
          offering.category.maxAge,
        );
      }
    }

    if (
      offering.gender !== 'MIXED' &&
      offering.gender !== player.person.gender
    ) {
      throw new BadRequestException(
        'El género del jugador no es compatible con el equipo',
      );
    }
  }

  private validateMembershipStartDate(
    startedAt: Date,
    seasonStartDate: Date,
    seasonEndDate: Date,
  ) {
    const sStart = new Date(seasonStartDate);
    sStart.setUTCHours(0, 0, 0, 0);

    const sEnd = new Date(seasonEndDate);
    sEnd.setUTCHours(23, 59, 59, 999);

    if (startedAt < sStart || startedAt > sEnd) {
      const sent = startedAt.toISOString().split('T')[0];
      const start = seasonStartDate.toISOString().split('T')[0];
      const end = seasonEndDate.toISOString().split('T')[0];
      throw new BadRequestException(
        `La fecha de inicio enviada (${sent}) está fuera del rango permitido. Debe estar entre el ${start} y el ${end} (Fechas de la Temporada).`,
      );
    }
  }

  async getTeamSeasonCategories(teamSeasonId: string) {
    const categories = await this.prisma.teamSeasonCategory.findMany({
      where: { teamSeasonId },
      include: {
        category: true,
      },
      orderBy: {
        category: { name: 'asc' },
      },
    });

    return {
      message: 'Categorías obtenidas correctamente',
      data: categories,
    };
  }

  async getPlayersOptions(paginationDto: PlayersOptionsPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'asc',
      gender,
    } = paginationDto;
    const skip = (page - 1) * per_page;

    const searchTerms = search ? search.trim().split(/\s+/) : [];

    const where: Prisma.PlayerWhereInput = {
      ...(searchTerms.length > 0
        ? {
            AND: searchTerms.map((term) => ({
              OR: [
                { person: { name: { contains: term, mode: 'insensitive' } } },
                {
                  person: { lastName: { contains: term, mode: 'insensitive' } },
                },
                {
                  person: {
                    secondLastName: { contains: term, mode: 'insensitive' },
                  },
                },
                {
                  person: {
                    documentNumber: { contains: term, mode: 'insensitive' },
                  },
                },
              ],
            })),
          }
        : {}),
      isActive: true,
      ...(gender && { person: { gender } }),
    };

    const [persons, totalItems] = await Promise.all([
      this.prisma.player.findMany({
        where,
        take: per_page,
        skip,
        orderBy: [
          { person: { lastName: orderBy } },
          { person: { secondLastName: orderBy } },
          { person: { name: orderBy } },
        ],
        select: {
          id: true,
          isActive: true,
          person: {
            select: {
              id: true,
              name: true,
              lastName: true,
              secondLastName: true,
              documentNumber: true,
              gender: true,
              birthDate: true,
              imageUrl: true,
            },
          },
        },
      }),
      this.prisma.player.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / per_page);
    const currentPage = totalItems === 0 ? 0 : page;

    return {
      message: 'Jugadores obtenidos exitosamente',
      data: persons.map((player) => ({
        ...player,
        person: {
          ...player.person,
          fullName: `${player.person.lastName || ''} ${player.person.secondLastName || ''} ${player.person.name}`.replace(/\s+/g, ' ').trim(),
        },
      })),
      meta: {
        totalItems,
        itemsPerPage: per_page,
        totalPages,
        currentPage,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        nextPage: page < totalPages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null,
      },
    };
  }

  async getTeamSeasonsOptions(paginationDto: PaginationDto) {
    const { per_page = 10, page = 1, search, orderBy = 'asc' } = paginationDto;
    const skip = (page - 1) * per_page;

    const where: Prisma.TeamSeasonWhereInput = {
      ...(search
        ? {
            OR: [
              { description: { contains: search, mode: 'insensitive' } },
              {
                season: { name: { contains: search, mode: 'insensitive' } },
              },
            ],
          }
        : {}),
      status: StatusTeamSeason.ACTIVE,
      // Solo temporados que no han finalizado
      season: {
        endDate: {
          gte: new Date(),
        },
      },
    };

    const [teamSeasons, totalItems] = await Promise.all([
      this.prisma.teamSeason.findMany({
        where,
        take: per_page,
        skip,
        orderBy: { season: { name: orderBy } },
        select: {
          id: true,
          status: true,
          description: true,
          season: {
            select: {
              id: true,
              name: true,
              startDate: true,
              endDate: true,
            },
          },
          imageUrl: true,
        },
      }),
      this.prisma.teamSeason.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / per_page);
    const currentPage = totalItems === 0 ? 0 : page;

    return {
      message: 'Temporadas obtenidas exitosamente',
      data: teamSeasons.map((teamSeason) => ({
        ...teamSeason,
        season: {
          ...teamSeason.season,
          fullName:
            `${teamSeason.season.name} ${teamSeason.season.startDate} ${teamSeason.season.endDate || ''}`.trim(),
        },
      })),
      meta: {
        totalItems,
        itemsPerPage: per_page,
        totalPages,
        currentPage,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        nextPage: page < totalPages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null,
      },
    };
  }

  // MÉTODOS DE PAUSA
  async getPauses(membershipId: string) {
    const pauses = await this.prisma.playerMembershipPause.findMany({
      where: { playerMembershipId: membershipId },
      orderBy: { startDate: 'desc' },
    });
    return { message: 'Pausas obtenidas exitosamente', data: pauses };
  }

  async createPause(membershipId: string, dto: CreatePlayerMembershipPauseDto) {
    const membership = await this.prisma.playerMembership.findUnique({
      where: { id: membershipId },
      include: {
        teamSeason: { include: { season: true } },
        pauses: true,
      },
    });
    if (!membership) {
      throw new NotFoundException(`Membresía ${membershipId} no encontrada`);
    }

    if (
      membership.status === PlayerMembershipStatus.FINISHED ||
      membership.status === PlayerMembershipStatus.WITHDRAWN
    ) {
      throw new BadRequestException(
        'No se pueden agregar pausas a una membresía finalizada o retirada',
      );
    }
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException(
        'La fecha de inicio debe ser anterior o igual a la de fin',
      );
    }

    const seasonStart = new Date(membership.teamSeason.season.startDate);
    seasonStart.setUTCHours(0, 0, 0, 0);
    const seasonEnd = new Date(membership.teamSeason.season.endDate);
    seasonEnd.setUTCHours(23, 59, 59, 999);

    const pauseStart = new Date(dto.startDate);
    pauseStart.setUTCHours(0, 0, 0, 0);
    const pauseEnd = new Date(dto.endDate);
    pauseEnd.setUTCHours(23, 59, 59, 999);

    if (pauseStart < seasonStart || pauseEnd > seasonEnd) {
      const sStart = seasonStart.toISOString().split('T')[0];
      const sEnd = seasonEnd.toISOString().split('T')[0];
      throw new BadRequestException(
        `Las fechas de la pausa deben estar dentro de la duración de la temporada (${sStart} al ${sEnd})`,
      );
    }

    const overlappingPause = membership.pauses.find((p) => {
      const existingStart = new Date(p.startDate);
      existingStart.setUTCHours(0, 0, 0, 0);
      const existingEnd = new Date(p.endDate);
      existingEnd.setUTCHours(23, 59, 59, 999);
      return pauseStart <= existingEnd && pauseEnd >= existingStart;
    });

    if (overlappingPause) {
      const pStart = new Date(overlappingPause.startDate)
        .toISOString()
        .split('T')[0];
      const pEnd = new Date(overlappingPause.endDate)
        .toISOString()
        .split('T')[0];
      throw new BadRequestException(
        `El rango de fechas se superpone con una pausa existente (${pStart} al ${pEnd})`,
      );
    }

    const pause = await this.prisma.playerMembershipPause.create({
      data: {
        playerMembershipId: membershipId,
        startDate: dto.startDate,
        endDate: dto.endDate,
        reason: dto.reason,
      },
    });

    // Si la pausa empieza hoy o en el pasado y termina en el futuro (o es para hoy mismo), pausar la membresía si está activa
    const todayZero = new Date();
    todayZero.setUTCHours(0, 0, 0, 0);

    if (
      pauseStart <= todayZero &&
      pauseEnd >= todayZero &&
      membership.status === 'ACTIVE'
    ) {
      await this.prisma.playerMembership.update({
        where: { id: membershipId },
        data: {
          status: 'SUSPENDED',
          notes: dto.reason || 'Pausa iniciada automáticamente',
          histories: {
            create: {
              previousStatus: membership.status,
              newStatus: 'SUSPENDED',
              reason: 'Creación de pausa activa',
            },
          },
        },
      });
    }

    return { message: 'Pausa creada exitosamente', data: pause };
  }

  async removePause(membershipId: string, pauseId: string) {
    const pause = await this.prisma.playerMembershipPause.findUnique({
      where: { id: pauseId },
    });
    if (!pause || pause.playerMembershipId !== membershipId) {
      throw new NotFoundException(`Pausa ${pauseId} no encontrada`);
    }

    await this.prisma.playerMembershipPause.delete({
      where: { id: pauseId },
    });

    return { message: 'Pausa eliminada exitosamente' };
  }

  async getTeamSeasonContext(teamSeasonCategoryId: string) {
    const teamSeason = await this.prisma.teamSeasonCategory.findUnique({
      where: { id: teamSeasonCategoryId },
      select: {
        id: true,
        gender: true,
        teamSeason: {
          select: {
            season: {
              select: {
                id: true,
                name: true,
                startDate: true,
                endDate: true,
              },
            },
            team: {
              select: {
                name: true,
                shortName: true,
              },
            },
            description: true,
          },
        },
        category: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!teamSeason) {
      throw new NotFoundException('La temporada no fue encontrada');
    }

    return {
      data: teamSeason,
      message: 'Temporada obtenida exitosamente',
    };
  }
}
