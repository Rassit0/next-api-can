import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateTeamSeasonDto } from './dto/create-team-season.dto';
import { UpdateTeamSeasonDto } from './dto/update-team-season.dto';
import { PrismaService } from 'src/prisma.service';
import {
  PlayerMembershipStatus,
  Prisma,
  SeasonBillingType,
  StatusTeamSeason,
  SeasonStatus,
  StatusCharge,
  TeamSeasonCategoryStatus,
} from 'src/generated/prisma/client';
import { FinalizeTeamSeasonDto } from './dto/finalize-team-season.dto';
import { CancelTeamSeasonDto } from './dto/cancel-team-season.dto';
import { TeamCategorySeasonsPaginationDto } from './dto/pagination.dto';

export const teamCategorySelect: Prisma.TeamSeasonSelect = {
  id: true,
  team: {
    select: {
      id: true,
      name: true,
      club: {
        select: {
          disciplineId: true,
          discipline: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },
  season: {
    select: {
      id: true,
      name: true,
      description: true,
      startDate: true,
      endDate: true,
    },
  },
  description: true,
  status: true,
  isRegistrationOpen: true,
  billingConfig: true,
  categories: {
    select: {
      id: true,
      categoryId: true,
      category: {
        select: {
          id: true,
          name: true,
          minAge: true,
          maxAge: true,
        },
      },
      gender: true,
      minBirthYear: true,
      maxBirthYear: true,
      minMembers: true,
      maxMembers: true,
      validateAge: true,
      isActive: true,
      _count: {
        select: {
          player_membership: {
            where: {
              OR: [
                { status: PlayerMembershipStatus.SUSPENDED },
                { status: PlayerMembershipStatus.ACTIVE },
              ],
            },
          },
        },
      },
    },
  },
  _count: {
    select: {
      playerMemberships: {
        where: {
          OR: [
            {
              status: PlayerMembershipStatus.SUSPENDED,
            },
            {
              status: PlayerMembershipStatus.ACTIVE,
            },
          ],
        },
      },
    },
  },
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class TeamSeasonService {
  private readonly logger = new Logger('TeamCategoriesService');

  constructor(private readonly prisma: PrismaService) {}

  async create(createTeamCategoryDto: CreateTeamSeasonDto) {
    const { categories, billingConfig, ...teamSeasonData } = createTeamCategoryDto;

    const season = await this.prisma.season.findUnique({
      where: { id: teamSeasonData.seasonId },
    });

    if (!season) {
      throw new NotFoundException('La temporada no fue encontrada');
    }

    if (
      season.status === SeasonStatus.FINISHED ||
      season.status === SeasonStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'No se puede asignar un equipo a una temporada inactiva o finalizada',
      );
    }

    // Validar categorías
    if (!categories || categories.length === 0) {
      throw new BadRequestException('Debe especificar al menos una categoría');
    }

    const categoryIds = categories.map((c) => c.categoryId);
    const uniqueCategoryKeys = new Set(categories.map((c) => `${c.categoryId}-${c.gender}`));
    if (uniqueCategoryKeys.size !== categories.length) {
      throw new BadRequestException('No se pueden incluir categorías duplicadas con el mismo género');
    }

    const fetchedCategories = await this.prisma.category.findMany({
      where: { id: { in: categoryIds } },
    });

    if (fetchedCategories.length !== new Set(categoryIds).size) {
      throw new NotFoundException('Una o más categorías no fueron encontradas');
    }

    for (const catDto of categories) {
      const category = fetchedCategories.find((c) => c.id === catDto.categoryId);
      if (season.disciplineId !== category.disciplineId) {
        throw new BadRequestException(
          `La temporada y la categoria ${category.name} no pertenecen a la misma disciplina`,
        );
      }

      if (
        catDto.minBirthYear &&
        catDto.maxBirthYear &&
        catDto.minBirthYear > catDto.maxBirthYear
      ) {
        throw new BadRequestException(
          `En la categoría ${category.name}, el año mínimo de nacimiento no puede ser mayor al año máximo permitido`,
        );
      }
    }

    if (billingConfig) {
      if (billingConfig.billingType !== SeasonBillingType.SINGLE_ONLY) {
        if (!billingConfig.recurringFee) {
          throw new BadRequestException(
            'La cuota mensual es requerida si el plan no es de pago único exclusivo',
          );
        }
        if (!billingConfig.registrationFee) {
          throw new BadRequestException(
            'La matrícula es requerida si el plan no es de pago único exclusivo',
          );
        }
      }

      if (
        billingConfig.billingType === SeasonBillingType.SINGLE_ONLY ||
        billingConfig.billingType === SeasonBillingType.BOTH
      ) {
        if (!billingConfig.seasonFee) {
          throw new BadRequestException(
            'La cuota de temporada es requerida si el plan permite pago único',
          );
        }
      }

      if (
        !billingConfig.billingFrequency ||
        billingConfig.billingFrequency === 'MONTHLY'
      ) {
        if (
          billingConfig.billingDay < 1 ||
          billingConfig.billingDay > 28
        ) {
          throw new BadRequestException(
            'El día de facturación mensual debe estar entre 1 y 28',
          );
        }
        const diffTime = season.endDate.getTime() - season.startDate.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Si la temporada dura menos de 28 días, el día de facturación podría no ocurrir nunca
        if (diffDays < 28) {
          let isValidDay = false;
          const current = new Date(season.startDate);
          while (current <= season.endDate) {
            if (current.getUTCDate() === billingConfig.billingDay) {
              isValidDay = true;
              break;
            }
            current.setUTCDate(current.getUTCDate() + 1);
          }
          if (!isValidDay) {
            throw new BadRequestException(
              'El día de facturación seleccionado no ocurre dentro de las fechas de esta temporada.',
            );
          }
        }
      } else if (billingConfig.billingFrequency === 'WEEKLY') {
        if (
          billingConfig.billingDay < 1 ||
          billingConfig.billingDay > 7
        ) {
          throw new BadRequestException(
            'El día de facturación semanal debe estar entre 1 y 7',
          );
        }
      } else if (billingConfig.billingFrequency === 'BIWEEKLY') {
        if (
          billingConfig.billingDay < 1 ||
          billingConfig.billingDay > 14
        ) {
          throw new BadRequestException(
            'El día de facturación quincenal debe estar entre 1 y 14',
          );
        }
      }
    }

    const newTeamSeason = await this.prisma.$transaction(async (tx) => {
      return tx.teamSeason.create({
        data: {
          ...teamSeasonData,
          ...(billingConfig ? { billingConfig: { create: billingConfig } } : {}),
          categories: {
            create: categories.map((c) => ({
              categoryId: c.categoryId,
              gender: c.gender,
              minBirthYear: c.minBirthYear,
              maxBirthYear: c.maxBirthYear,
              minMembers: c.minMembers,
              maxMembers: c.maxMembers,
              validateAge: c.validateAge ?? true,
              isActive: c.isActive ?? true,
            })),
          },
        },
        select: teamCategorySelect,
      });
    });

    return {
      message: 'Temporada asignada a equipo exitosamente',
      data: newTeamSeason,
    };
  }

  async findAll(paginationDto: TeamCategorySeasonsPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'asc',
      sortField = 'createdAt',
      gender,
      teamId,
    } = paginationDto;
    // Calcular el offset para la paginación
    const skip = (page - 1) * per_page;

    const where: Prisma.TeamSeasonWhereInput = search
      ? {
          OR: [
            { team: { name: { contains: search, mode: 'insensitive' } } },
            {
              categories: {
                some: {
                  category: { name: { contains: search, mode: 'insensitive' } },
                },
              },
            },
          ],
        }
      : {};

    if (teamId) {
      where.teamId = teamId;
    }

    if (gender) {
      where.categories = {
        some: { gender },
      };
    }

    // Ejecutamos ambas consultas en paralelo para máxima velocidad
    const [teamCategorieSeasons, totalItems] = await Promise.all([
      this.prisma.teamSeason.findMany({
        where,
        take: per_page,
        skip,
        orderBy: { [sortField]: orderBy },
        select: teamCategorySelect,
      }),
      this.prisma.teamSeason.count({ where }),
    ]);

    // Lógica de metadatos
    const totalPages = Math.ceil(totalItems / per_page);

    // Si el usuario pide un page que no existe, Prisma ya puso [] en 'disciplines'.
    // Calculamos la página actual basándonos en el page solicitado.
    const currentPage = totalItems === 0 ? 0 : Math.floor(page / per_page) + 1;

    return {
      message: 'Temporadas de equipo obtenidas exitosamente',
      data: teamCategorieSeasons, // Será [] si la página no existe o no hay registros
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
    const teamSeason = await this.prisma.teamSeason.findUnique({
      where: { id },
      select: teamCategorySelect,
    });

    if (!teamSeason) {
      throw new NotFoundException(
        'La categoria de equipo en temporada no fue encontrada',
      );
    }

    return {
      data: teamSeason,
      message: 'Temporada de equipo obtenida exitosamente',
    };
  }

  async getSummary(id: string) {
    const [
      teamSeason,
      chargesAggr,
      activeMembers,
      suspendedMembers,
      pendingMembers,
    ] = await Promise.all([
      this.prisma.teamSeason.findUnique({
        where: { id },
        select: { id: true, categories: { select: { maxMembers: true } } },
      }),
      this.prisma.charge.aggregate({
        where: {
          membershipCharges: {
            some: { playerMembership: { teamSeasonId: id } },
          },
        },
        _sum: { amount: true, pendingAmount: true },
      }),
      this.prisma.playerMembership.count({
        where: { teamSeasonId: id, status: 'ACTIVE' },
      }),
      this.prisma.playerMembership.count({
        where: { teamSeasonId: id, status: 'SUSPENDED' },
      }),
      this.prisma.playerMembership.count({
        where: { teamSeasonId: id, status: 'PENDING_ACTIVE' },
      }),
    ]);

    if (!teamSeason) {
      throw new NotFoundException(
        'La categoria de equipo en temporada no fue encontrada',
      );
    }

    const totalBilled = Number(chargesAggr._sum.amount || 0);
    const totalPending = Number(chargesAggr._sum.pendingAmount || 0);
    const totalPaid = totalBilled - totalPending;

    const maxMembers = teamSeason.categories.reduce((sum, cat) => sum + cat.maxMembers, 0);

    return {
      data: {
        totalBilled,
        totalPaid,
        totalPending,
        activeMembers,
        suspendedMembers,
        pendingMembers,
        occupiedSlotsCount: activeMembers + suspendedMembers + pendingMembers,
        maxMembers,
      },
      message: 'Resumen de la temporada de equipo obtenido exitosamente',
    };
  }

  async update(id: string, updateTeamSeasonDto: UpdateTeamSeasonDto) {
    const { categories, ...rest } = updateTeamSeasonDto;
    
    const teamSeason = await this.prisma.teamSeason.findUnique({
      where: { id },
      select: teamCategorySelect,
    });
    
    if (!teamSeason) {
      throw new NotFoundException(
        'La categoria de equipo en temporada no fue encontrada',
      );
    }

    if (
      teamSeason.status === StatusTeamSeason.FINISHED ||
      teamSeason.status === StatusTeamSeason.CANCELLED
    ) {
      throw new BadRequestException(
        'No se puede editar una temporada de equipo que ya finalizó o fue cancelada',
      );
    }

    if (categories !== undefined) {
      if (teamSeason.status !== StatusTeamSeason.DRAFT) {
        throw new BadRequestException(
          'Las categorías solo pueden ser modificadas cuando la temporada está en estado DRAFT',
        );
      }

      if (categories.length === 0) {
        throw new BadRequestException('Debe especificar al menos una categoría');
      }

      const uniqueCategoryKeys = new Set(
        categories.map((c) => `${c.categoryId}-${c.gender}`),
      );
      if (uniqueCategoryKeys.size !== categories.length) {
        throw new BadRequestException(
          'No se pueden incluir categorías duplicadas con el mismo género',
        );
      }
    }

    if (teamSeason.status === StatusTeamSeason.ACTIVE) {
      const billing = updateTeamSeasonDto.billingConfig;
      if (billing && teamSeason.billingConfig) {
        if (
          (billing.billingType !== undefined &&
            billing.billingType !== teamSeason.billingConfig.billingType) ||
          (billing.billingFrequency !== undefined &&
            billing.billingFrequency !==
              teamSeason.billingConfig.billingFrequency) ||
          (billing.billingDay !== undefined &&
            billing.billingDay !== teamSeason.billingConfig.billingDay) ||
          (billing.prorateRegistrationFee !== undefined &&
            billing.prorateRegistrationFee !==
              teamSeason.billingConfig.prorateRegistrationFee) ||
          (billing.prorateFirstRecurringFee !== undefined &&
            billing.prorateFirstRecurringFee !==
              teamSeason.billingConfig.prorateFirstRecurringFee) ||
          (billing.prorateLastRecurringFee !== undefined &&
            billing.prorateLastRecurringFee !==
              teamSeason.billingConfig.prorateLastRecurringFee) ||
          (billing.prorateSeasonFee !== undefined &&
            billing.prorateSeasonFee !==
              teamSeason.billingConfig.prorateSeasonFee)
        ) {
          throw new BadRequestException(
            'No se puede modificar la configuración base del motor de cobros (tipo, frecuencia, día y prorrateos) en una temporada activa. Solo se permite actualizar montos para nuevas inscripciones.',
          );
        }
      }
    }

    if (rest.billingConfig) {
      const currentBillingConfig = teamSeason.billingConfig;
      const targetBillingType =
        rest.billingConfig.billingType ?? currentBillingConfig?.billingType;

      if (targetBillingType !== SeasonBillingType.SINGLE_ONLY) {
        const finalRecurringFee =
          rest.billingConfig.recurringFee !== undefined
            ? rest.billingConfig.recurringFee
            : currentBillingConfig?.recurringFee;

        const finalRegistrationFee =
          rest.billingConfig.registrationFee !== undefined
            ? rest.billingConfig.registrationFee
            : currentBillingConfig?.registrationFee;

        if (!finalRecurringFee) {
          throw new BadRequestException(
            'La cuota mensual es requerida si el plan no es de pago único exclusivo',
          );
        }
        if (!finalRegistrationFee) {
          throw new BadRequestException(
            'La matrícula es requerida si el plan no es de pago único exclusivo',
          );
        }
      }

      if (
        targetBillingType === SeasonBillingType.SINGLE_ONLY ||
        targetBillingType === SeasonBillingType.BOTH
      ) {
        const finalSeasonFee =
          rest.billingConfig.seasonFee !== undefined
            ? rest.billingConfig.seasonFee
            : currentBillingConfig?.seasonFee;

        if (!finalSeasonFee) {
          throw new BadRequestException(
            'La cuota de temporada es requerida si el plan permite pago único',
          );
        }
      }
    }

    const { billingConfig, ...teamSeasonData } = rest;

    const updatedTeamCategory = await this.prisma.teamSeason.update({
      where: { id },
      data: {
        ...teamSeasonData,
        ...(billingConfig
          ? {
              billingConfig: {
                upsert: {
                  create: billingConfig,
                  update: billingConfig,
                },
              },
            }
          : {}),
        ...(categories !== undefined
          ? {
              categories: {
                deleteMany: {},
                create: categories.map((c) => ({
                  categoryId: c.categoryId,
                  gender: c.gender,
                  validateAge: c.validateAge ?? true,
                  minBirthYear: c.minBirthYear,
                  maxBirthYear: c.maxBirthYear,
                  minMembers: c.minMembers,
                  maxMembers: c.maxMembers,
                  isActive: c.isActive ?? true,
                })),
              },
            }
          : {}),
      },
      select: teamCategorySelect,
    });
    return {
      message: 'Temporada de equipo actualizada exitosamente',
      data: updatedTeamCategory,
    };
  }

  async getSeasonsOptions() {
    const seasons = await this.prisma.season.findMany({
      where: {
        status: SeasonStatus.ACTIVE,
      },
      select: {
        id: true,
        name: true,
      },
    });

    return {
      data: seasons,
      message: 'Temporadas obtenidas exitosamente',
    };
  }

  async getCategoriesByDisciplineOptions(disciplineId: string) {
    const categories = await this.prisma.category.findMany({
      where: { disciplineId },
      select: {
        id: true,
        name: true,
        minAge: true,
        maxAge: true,
      },
    });

    return {
      data: categories,
      message: 'Categorias obtenidas exitosamente',
    };
  }
  async getSeasonsByDisciplineOptions(disciplineId: string) {
    const seasons = await this.prisma.season.findMany({
      where: {
        disciplineId,
        status: SeasonStatus.ACTIVE,
      },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
      },
    });

    return {
      data: seasons,
      message: 'Temporadas obtenidas exitosamente',
    };
  }

  async remove(id: string) {
    const teamSeason = await this.prisma.teamSeason.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        playerMemberships: true,
      },
    });
    if (!teamSeason) {
      throw new NotFoundException(
        'La categoria de equipo en temporada no fue encontrada',
      );
    }
    if (teamSeason.status !== StatusTeamSeason.DRAFT) {
      throw new BadRequestException(
        'La temporada de equipo no puede ser eliminada',
      );
    }
    if (teamSeason.playerMemberships?.length > 0) {
      throw new BadRequestException(
        'La temporada no puede ser eliminada porque tiene registros asociados',
      );
    }
    await this.prisma.teamSeason.delete({
      where: { id },
    });
    return {
      message: 'Temporada de equipo eliminada exitosamente',
      data: teamSeason,
    };
  }

  async finish(id: string, finalizeTeamSeasonDto: FinalizeTeamSeasonDto) {
    const teamSeason = await this.prisma.teamSeason.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!teamSeason) {
      throw new NotFoundException('La temporada de equipo no fue encontrada');
    }

    if (teamSeason.status === StatusTeamSeason.ACTIVE) {
      const updatedTeamSeason = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.teamSeason.update({
          where: { id },
          data: {
            status: StatusTeamSeason.FINISHED,
            statusNotes: finalizeTeamSeasonDto.reason,
          },
          select: teamCategorySelect,
        });

        // Actualizar membresías activas o suspendidas a FINISHED
        await tx.playerMembership.updateMany({
          where: {
            teamSeasonId: id,
            status: {
              in: [
                PlayerMembershipStatus.ACTIVE,
                PlayerMembershipStatus.SUSPENDED,
                PlayerMembershipStatus.PENDING_ACTIVE,
              ],
            },
          },
          data: { status: PlayerMembershipStatus.FINISHED },
        });

        return updated;
      });

      return {
        message: 'Temporada de equipo finalizada exitosamente',
        data: updatedTeamSeason,
      };
    } else {
      throw new BadRequestException(
        'Solo una temporada de equipo activa puede ser finalizada',
      );
    }
  }

  async cancel(id: string, cancelTeamSeasonDto: CancelTeamSeasonDto) {
    const teamSeason = await this.prisma.teamSeason.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!teamSeason) {
      throw new NotFoundException('La temporada de equipo no fue encontrada');
    }

    if (
      teamSeason.status === StatusTeamSeason.ACTIVE ||
      teamSeason.status === StatusTeamSeason.DRAFT
    ) {
      const updatedTeamSeason = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.teamSeason.update({
          where: { id },
          data: {
            status: StatusTeamSeason.CANCELLED,
            statusNotes: cancelTeamSeasonDto.reason,
          },
          select: teamCategorySelect,
        });

        if (teamSeason.status === StatusTeamSeason.ACTIVE) {
          const memberships = await tx.playerMembership.findMany({
            where: {
              teamSeasonId: id,
              status: {
                in: [
                  PlayerMembershipStatus.ACTIVE,
                  PlayerMembershipStatus.SUSPENDED,
                  PlayerMembershipStatus.PENDING_ACTIVE,
                ],
              },
            },
            select: { id: true },
          });

          const membershipIds = memberships.map((m) => m.id);

          if (membershipIds.length > 0) {
            // Encontrar todos los cargos pendientes de estas membresías
            const membershipCharges = await tx.membershipCharge.findMany({
              where: {
                playerMembershipId: { in: membershipIds },
                charge: { status: StatusCharge.PENDING },
              },
              select: { chargeId: true },
            });

            const chargeIds = membershipCharges.map((mc) => mc.chargeId);

            if (chargeIds.length > 0) {
              // Cancelar cargos pendientes
              await tx.charge.updateMany({
                where: { id: { in: chargeIds } },
                data: { status: StatusCharge.CANCELLED },
              });
            }

            // Cambiar estado de las membresías a WITHDRAWN
            await tx.playerMembership.updateMany({
              where: { id: { in: membershipIds } },
              data: { status: PlayerMembershipStatus.WITHDRAWN },
            });
          }
        }

        return updated;
      });

      return {
        message: 'Temporada de equipo cancelada exitosamente',
        data: updatedTeamSeason,
      };
    } else {
      throw new BadRequestException(
        'Esta temporada de equipo no puede ser cancelada',
      );
    }
  }

  async toggleBillingEngine(id: string, isEngineActive: boolean) {
    const teamSeason = await this.prisma.teamSeason.findUnique({
      where: { id },
      include: { billingConfig: true },
    });
    if (!teamSeason || !teamSeason.billingConfig) {
      throw new NotFoundException(
        'La configuración de cobros para esta temporada no fue encontrada',
      );
    }

    const updated = await this.prisma.teamSeasonBillingConfig.update({
      where: { teamSeasonId: id },
      data: { isEngineActive },
    });

    return {
      message: `Motor de cobros ${isEngineActive ? 'activado' : 'pausado'} exitosamente`,
      data: updated,
    };
  }

  async getPauses(teamSeasonId: string) {
    const pauses = await this.prisma.teamSeasonPause.findMany({
      where: { teamSeasonId },
      orderBy: { startDate: 'desc' },
    });
    return { data: pauses, message: 'Pausas obtenidas' };
  }

  async addPause(
    teamSeasonId: string,
    createPauseDto: { startDate: string; endDate: string; reason?: string },
  ) {
    const teamSeason = await this.prisma.teamSeason.findUnique({
      where: { id: teamSeasonId },
      include: { season: true },
    });

    if (!teamSeason) throw new BadRequestException('Team season not found');

    const startDate = new Date(createPauseDto.startDate);
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(createPauseDto.endDate);
    endDate.setUTCHours(23, 59, 59, 999);

    if (startDate > endDate) {
      throw new BadRequestException(
        'La fecha de inicio debe ser anterior o igual a la de fin',
      );
    }

    if (
      startDate < teamSeason.season.startDate ||
      endDate > teamSeason.season.endDate
    ) {
      throw new BadRequestException(
        `Las fechas de la pausa deben estar dentro del rango de la temporada (${teamSeason.season.startDate.toISOString().split('T')[0]} - ${teamSeason.season.endDate.toISOString().split('T')[0]})`,
      );
    }

    const overlapping = await this.prisma.teamSeasonPause.findFirst({
      where: {
        teamSeasonId,
        OR: [{ startDate: { lte: endDate }, endDate: { gte: startDate } }],
      },
    });

    if (overlapping) {
      throw new BadRequestException(
        `Ya existe una pausa para este equipo en estas fechas (${overlapping.startDate.toISOString().split('T')[0]} - ${overlapping.endDate.toISOString().split('T')[0]})`,
      );
    }

    const pause = await this.prisma.teamSeasonPause.create({
      data: {
        teamSeasonId,
        startDate,
        endDate,
        reason: createPauseDto.reason,
      },
    });

    return { message: 'Pausa agregada correctamente', data: pause };
  }

  async removePause(id: string) {
    const pause = await this.prisma.teamSeasonPause.findUnique({
      where: { id },
    });
    if (!pause) throw new BadRequestException('Pausa no encontrada');
    await this.prisma.teamSeasonPause.delete({
      where: { id },
    });
    
    return { message: 'Pausa eliminada correctamente' };
  }

  async findPublic(isHistorical?: boolean) {
    const status = isHistorical
      ? StatusTeamSeason.FINISHED
      : StatusTeamSeason.ACTIVE;

    const teamSeasons = await this.prisma.teamSeason.findMany({
      where: {
        status,
        ...(isHistorical ? {} : { isRegistrationOpen: true }),
      },
      select: {
        id: true,
        description: true,
        team: {
          select: {
            name: true,
            club: { select: { name: true } },
          },
        },
        billingConfig: {
          select: {
            registrationFee: true,
            recurringFee: true,
            seasonFee: true,
            billingType: true,
          },
        },
        categories: {
          where: { 
            isActive: true,
            ...(isHistorical ? {} : { status: TeamSeasonCategoryStatus.ACTIVE }),
          },
          select: {
            id: true,
            gender: true,
            minBirthYear: true,
            maxBirthYear: true,
            maxMembers: true,
            category: {
              select: {
                name: true,
                minAge: true,
                maxAge: true,
                discipline: { select: { name: true } },
              },
            },
            _count: {
              select: {
                player_membership: {
                  where: {
                    status: { in: ['ACTIVE', 'SUSPENDED'] },
                  },
                },
              },
            },
          },
        },
      },
    });

    const mapped = teamSeasons.flatMap((ts) => {
      let regFee = 0;
      let monthFee = 0;
      if (ts.billingConfig) {
        regFee = Number(ts.billingConfig.registrationFee || 0);
        if (ts.billingConfig.billingType === 'SINGLE_ONLY') {
          monthFee = Number(ts.billingConfig.seasonFee || 0);
        } else {
          monthFee = Number(ts.billingConfig.recurringFee || 0);
        }
      }

      return ts.categories.map((tsc) => ({
        id: ts.id,
        teamSeasonCategoryId: tsc.id,
        name: ts.team.name,
        discipline: tsc.category.discipline.name,
        club: ts.team.club.name,
        gender:
          tsc.gender === 'MALE'
            ? 'Masculino'
            : tsc.gender === 'FEMALE'
              ? 'Femenino'
              : 'Mixto',
        minAge: tsc.category.minAge,
        maxAge: tsc.category.maxAge,
        category: tsc.category.name,
        tournament: ts.description || 'Competencia local',
        capacity: tsc.maxMembers,
        enrolled: tsc._count.player_membership,
        registrationFee: regFee,
        monthlyFee: monthFee,
      }));
    });

    return {
      message: 'Equipos públicos obtenidos exitosamente',
      data: mapped,
    };
  }

  async getDisciplinesOptions() {
    const disciplines = await this.prisma.discipline.findMany({
      select: {
        id: true,
        name: true,
        icon: true,
      },
    });

    return {
      data: disciplines,
      message: 'Disciplinas obtenidas exitosamente',
    };
  }

  async getClubContext(clubId: string) {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: {
        id: true,
        name: true,
        discipline: {
          select: {
            name: true,
            icon: true,
          },
        },
      },
    });

    if (!club) {
      throw new NotFoundException('El club no fue encontrado');
    }

    return {
      data: club,
      message: 'Club obtenido exitosamente',
    };
  }

  async getTeamContext(teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        shortName: true,
        description: true,
        club: {
          select: {
            id: true,
            name: true,
            discipline: {
              select: {
                id: true,
                name: true,
                icon: true,
              },
            },
          },
        },
      },
    });

    if (!team) {
      throw new NotFoundException('El equipo no fue encontrado');
    }

    return {
      data: team,
      message: 'Equipo obtenido exitosamente',
    };
  }
}
