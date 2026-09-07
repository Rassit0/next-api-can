import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateCourseSeasonDto } from './dto/create-course-season.dto';
import { UpdateCourseSeasonDto } from './dto/update-course-season.dto';
import { AddShiftDto } from './dto/add-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { PrismaService } from 'src/prisma.service';
import {
  StudentMembershipStatus,
  Prisma,
  SeasonBillingType,
  StatusCourseSeason,
  SeasonStatus,
  StatusCharge,
} from 'src/generated/prisma/client';
import { FinalizeCourseSeasonDto } from './dto/finalize-course-season.dto';
import { CancelCourseSeasonDto } from './dto/cancel-course-season.dto';
import { CourseSeasonsPaginationDto } from './dto/pagination.dto';

export const courseSeasonSelect: Prisma.CourseSeasonSelect = {
  id: true,
  name: true,
  imageUrl: true,
  shifts: {
    select: {
      id: true,
      maxMembers: true,
      minMembers: true,
      categoryId: true,
      gender: true,
      minBirthYear: true,
      maxBirthYear: true,
      validateAge: true,
      isActive: true,
      category: {
        select: {
          id: true,
          name: true,
          disciplineId: true,
          minAge: true,
          maxAge: true,
        },
      },
      shift: {
        select: {
          id: true,
          name: true,
        },
      },
      courseSeasonStaffs: {
        select: {
          id: true,
          role: true,
          isPrimary: true,
          startedAt: true,
          endedAt: true,
          staff: {
            select: {
              id: true,
              person: {
                select: {
                  id: true,
                  name: true,
                  lastName: true,
                  secondLastName: true,
                  imageUrl: true,
                  documentNumber: true,
                },
              },
            },
          },
        },
      },
      _count: {
        select: {
          studentMemberships: {
            where: {
              OR: [
                { status: StudentMembershipStatus.SUSPENDED },
                { status: StudentMembershipStatus.ACTIVE },
              ],
            },
          },
        },
      },
    },
  },
  course: {
    select: {
      id: true,
      name: true,
      imageUrl: true,
      school: {
        select: {
          id: true,
          name: true,
          disciplineId: true,
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
  billingConfig: true,
  isRegistrationOpen: true,
  _count: {
    select: {
      studentMemberships: {
        where: {
          OR: [
            { status: StudentMembershipStatus.SUSPENDED },
            { status: StudentMembershipStatus.ACTIVE },
          ],
        },
      },
    },
  },
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class CourseSeasonsService {
  private readonly logger = new Logger('CourseCategoriesService');

  constructor(private readonly prisma: PrismaService) {}

  async create(createCourseCategoryDto: CreateCourseSeasonDto) {
    const { imageUrl, ...rest } = createCourseCategoryDto;

    // Phase 7: Duplicate validation
    const existingCourseSeason = await this.prisma.courseSeason.findFirst({
      where: {
        courseId: createCourseCategoryDto.courseId,
        seasonId: createCourseCategoryDto.seasonId,
        name: createCourseCategoryDto.name,
        status: {
          not: StatusCourseSeason.CANCELLED,
        },
      },
    });

    if (existingCourseSeason) {
      throw new BadRequestException(
        'Ya existe un turno configurado con esta combinación de curso, temporada y horario',
      );
    }

    const season = await this.prisma.season.findUnique({
      where: { id: createCourseCategoryDto.seasonId },
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

    const category = await this.prisma.category.findUnique({
      where: { id: createCourseCategoryDto.categoryId },
    });

    if (!category) {
      throw new NotFoundException('La categoria no fue encontrada');
    }

    if (
      rest.minBirthYear &&
      rest.maxBirthYear &&
      rest.minBirthYear > rest.maxBirthYear
    ) {
      throw new BadRequestException(
        'El año mínimo de nacimiento no puede ser mayor al año máximo permitido',
      );
    }

    if (season.disciplineId !== category.disciplineId) {
      throw new NotFoundException(
        'La temporada y la categoria no pertenecen a la misma disciplina',
      );
    }

    if (rest.billingConfig) {
      if (rest.billingConfig.billingType !== SeasonBillingType.SINGLE_ONLY) {
        if (!rest.billingConfig.recurringFee) {
          throw new BadRequestException(
            'La cuota mensual es requerida si el plan no es de pago único exclusivo',
          );
        }
        if (!rest.billingConfig.registrationFee) {
          throw new BadRequestException(
            'La matrícula es requerida si el plan no es de pago único exclusivo',
          );
        }
      }

      if (
        rest.billingConfig.billingType === SeasonBillingType.SINGLE_ONLY ||
        rest.billingConfig.billingType === SeasonBillingType.BOTH
      ) {
        if (!rest.billingConfig.seasonFee) {
          throw new BadRequestException(
            'La cuota de temporada es requerida si el plan permite pago único',
          );
        }
      }

      if (
        !rest.billingConfig.billingFrequency ||
        rest.billingConfig.billingFrequency === 'MONTHLY'
      ) {
        if (
          rest.billingConfig.billingDay < 1 ||
          rest.billingConfig.billingDay > 28
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
            if (current.getUTCDate() === rest.billingConfig.billingDay) {
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
      } else if (rest.billingConfig.billingFrequency === 'WEEKLY') {
        if (
          rest.billingConfig.billingDay < 1 ||
          rest.billingConfig.billingDay > 7
        ) {
          throw new BadRequestException(
            'El día de facturación semanal debe estar entre 1 y 7',
          );
        }
      } else if (rest.billingConfig.billingFrequency === 'BIWEEKLY') {
        if (
          rest.billingConfig.billingDay < 1 ||
          rest.billingConfig.billingDay > 14
        ) {
          throw new BadRequestException(
            'El día de facturación quincenal debe estar entre 1 y 14',
          );
        }
      }
    }

    const {
      billingConfig,
      shiftId,
      maxMembers,
      minMembers,
      categoryId,
      gender,
      minBirthYear,
      maxBirthYear,
      validateAge,
      ...courseSeasonData
    } = rest;
    const newCourseSeason = await this.prisma.courseSeason.create({
      data: {
        ...courseSeasonData,
        shifts: {
          create: [
            {
              shiftId,
              maxMembers,
              minMembers,
              categoryId,
              gender,
              minBirthYear,
              maxBirthYear,
              validateAge,
            },
          ],
        },
        ...(billingConfig ? { billingConfig: { create: billingConfig } } : {}),
      },
      select: courseSeasonSelect,
    });

    return {
      message: 'Temporada asignada a equipo exitosamente',
      data: newCourseSeason,
    };
  }

  async addShift(id: string, addShiftDto: AddShiftDto) {
    const {
      shiftId,
      maxMembers,
      minMembers,
      categoryId,
      gender,
      minBirthYear,
      maxBirthYear,
      validateAge,
    } = addShiftDto;

    // 1. Obtener la oferta origen
    const baseCourseSeason = await this.prisma.courseSeason.findUnique({
      where: { id },
    });

    if (!baseCourseSeason) {
      throw new NotFoundException('La oferta no fue encontrada');
    }

    if (
      baseCourseSeason.status === StatusCourseSeason.FINISHED ||
      baseCourseSeason.status === StatusCourseSeason.CANCELLED
    ) {
      throw new BadRequestException(
        'No se puede agregar un turno a una temporada inactiva o finalizada',
      );
    }

    // 2. Validar que el shift exista
    const shiftExists = await this.prisma.shift.findUnique({
      where: { id: shiftId },
    });
    if (!shiftExists) {
      throw new NotFoundException('El nuevo turno (Shift) no fue encontrado');
    }

    // 3. Validar duplicidad
    const existingShift = await this.prisma.courseSeasonShift.findFirst({
      where: {
        courseSeasonId: id,
        shiftId: shiftId,
      },
    });

    if (existingShift) {
      throw new BadRequestException('La oferta ya tiene este turno asignado');
    }

    // 4. Crear el turno
    await this.prisma.courseSeasonShift.create({
      data: {
        courseSeasonId: id,
        shiftId,
        maxMembers,
        minMembers,
        categoryId,
        gender,
        minBirthYear,
        maxBirthYear,
        validateAge,
      },
    });

    const updatedCourseSeason = await this.prisma.courseSeason.findUnique({
      where: { id },
      select: courseSeasonSelect,
    });

    return {
      message: 'Turno agregado exitosamente a la oferta',
      data: updatedCourseSeason,
    };
  }

  async updateShift(
    courseSeasonId: string,
    shiftId: string,
    updateShiftDto: UpdateShiftDto,
  ) {
    const {
      maxMembers,
      minMembers,
      categoryId,
      gender,
      minBirthYear,
      maxBirthYear,
      validateAge,
    } = updateShiftDto;

    // 1. Obtener la oferta
    const baseCourseSeason = await this.prisma.courseSeason.findUnique({
      where: { id: courseSeasonId },
    });

    if (!baseCourseSeason) {
      throw new NotFoundException('La oferta no fue encontrada');
    }

    if (
      baseCourseSeason.status === StatusCourseSeason.FINISHED ||
      baseCourseSeason.status === StatusCourseSeason.CANCELLED
    ) {
      throw new BadRequestException(
        'No se puede editar un turno de una temporada inactiva o finalizada',
      );
    }

    // 2. Obtener el CourseSeasonShift
    const existingShift = await this.prisma.courseSeasonShift.findFirst({
      where: {
        id: shiftId,
        courseSeasonId: courseSeasonId,
      },
    });

    if (!existingShift) {
      throw new NotFoundException(
        'El turno no pertenece a la oferta indicada o no existe',
      );
    }

    // 3. Validar Category si viene
    if (categoryId) {
      const cat = await this.prisma.category.findUnique({
        where: { id: categoryId },
      });
      if (!cat) throw new NotFoundException('La categoría indicada no existe');
    }

    // 4. Actualizar el turno
    await this.prisma.courseSeasonShift.update({
      where: { id: shiftId },
      data: {
        ...(maxMembers !== undefined && { maxMembers }),
        ...(minMembers !== undefined && { minMembers }),
        ...(categoryId !== undefined && { categoryId }),
        ...(gender !== undefined && { gender }),
        ...(minBirthYear !== undefined && { minBirthYear }),
        ...(maxBirthYear !== undefined && { maxBirthYear }),
        ...(validateAge !== undefined && { validateAge }),
      },
    });

    const updatedCourseSeason = await this.prisma.courseSeason.findUnique({
      where: { id: courseSeasonId },
      select: courseSeasonSelect,
    });

    return {
      message: 'Configuración del turno actualizada exitosamente',
      data: updatedCourseSeason,
    };
  }

  async findAll(paginationDto: CourseSeasonsPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'asc',
      sortField = 'createdAt',
      gender,
      courseId,
    } = paginationDto;
    // Calcular el offset para la paginación
    const skip = (page - 1) * per_page;

    const where: Prisma.CourseSeasonWhereInput = search
      ? {
          OR: [
            { course: { name: { contains: search, mode: 'insensitive' } } },
            {
              shifts: {
                some: {
                  category: { name: { contains: search, mode: 'insensitive' } },
                },
              },
            },
          ],
        }
      : {};

    if (courseId) {
      where.courseId = courseId;
    }

    if (gender) {
      where.shifts = {
        ...(where.shifts as object),
        some: {
          ...(where.shifts && 'some' in (where.shifts as object)
            ? (where.shifts as any).some
            : {}),
          gender,
        },
      };
    }

    // Ejecutamos ambas consultas en paralelo para máxima velocidad
    const [courseCategorieSeasons, totalItems] = await Promise.all([
      this.prisma.courseSeason.findMany({
        where,
        take: per_page,
        skip,
        orderBy: { [sortField]: orderBy },
        select: courseSeasonSelect,
      }),
      this.prisma.courseSeason.count({ where }),
    ]);

    // Lógica de metadatos
    const totalPages = Math.ceil(totalItems / per_page);

    // Si el usuario pide un page que no existe, Prisma ya puso [] en 'disciplines'.
    // Calculamos la página actual basándonos en el page solicitado.
    const currentPage = totalItems === 0 ? 0 : Math.floor(page / per_page) + 1;

    return {
      message: 'Temporadas de equipo obtenidas exitosamente',
      data: courseCategorieSeasons, // Será [] si la página no existe o no hay registros
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
    const courseSeason = await this.prisma.courseSeason.findUnique({
      where: { id },
      select: courseSeasonSelect,
    });

    if (!courseSeason) {
      throw new NotFoundException(
        'La categoria de curso en temporada no fue encontrada',
      );
    }

    return {
      data: courseSeason,
      message: 'Temporada de curso obtenida exitosamente',
    };
  }

  async getSummary(id: string) {
    const [
      courseSeason,
      chargesAggr,
      activeMembers,
      suspendedMembers,
      pendingMembers,
    ] = await Promise.all([
      this.prisma.courseSeason.findUnique({
        where: { id },
        select: { id: true, shifts: { select: { maxMembers: true } } },
      }),
      this.prisma.charge.aggregate({
        where: {
          studentCharges: {
            some: { studentMembership: { courseSeasonId: id } },
          },
        },
        _sum: { amount: true, pendingAmount: true },
      }),
      this.prisma.studentMembership.count({
        where: { courseSeasonId: id, status: 'ACTIVE' },
      }),
      this.prisma.studentMembership.count({
        where: { courseSeasonId: id, status: 'SUSPENDED' },
      }),
      this.prisma.studentMembership.count({
        where: { courseSeasonId: id, status: 'PENDING_ACTIVE' },
      }),
    ]);

    if (!courseSeason) {
      throw new NotFoundException(
        'La categoria de curso en temporada no fue encontrada',
      );
    }

    const totalBilled = Number(chargesAggr._sum.amount || 0);
    const totalPending = Number(chargesAggr._sum.pendingAmount || 0);
    const totalPaid = totalBilled - totalPending;

    return {
      data: {
        totalBilled,
        totalPaid,
        totalPending,
        activeMembers,
        suspendedMembers,
        pendingMembers,
        occupiedSlotsCount: activeMembers + suspendedMembers + pendingMembers,
        maxMembers: courseSeason.shifts.reduce(
          (acc, shift) => acc + shift.maxMembers,
          0,
        ),
      },
      message: 'Resumen de la temporada de curso obtenido exitosamente',
    };
  }

  async update(id: string, updateCourseSeasonDto: UpdateCourseSeasonDto) {
    const { courseId, seasonId, imageUrl, ...rest } = updateCourseSeasonDto;
    const courseSeason = await this.prisma.courseSeason.findUnique({
      where: { id },
      select: courseSeasonSelect,
    });
    if (!courseSeason) {
      throw new NotFoundException(
        'La categoria de curso en temporada no fue encontrada',
      );
    }

    if (
      courseSeason.status === StatusCourseSeason.FINISHED ||
      courseSeason.status === StatusCourseSeason.CANCELLED
    ) {
      throw new BadRequestException(
        'No se puede editar una temporada de curso que ya finalizó o fue cancelada',
      );
    }

    if (courseSeason.status === StatusCourseSeason.ACTIVE) {
      if (
        (courseId && courseId !== courseSeason.course.id) ||
        (seasonId && seasonId !== courseSeason.season.id)
      ) {
        throw new BadRequestException(
          'No se puede modificar el curso ni la temporada una vez que la temporada de curso está activa',
        );
      }

      const billing = updateCourseSeasonDto.billingConfig;
      if (billing && courseSeason.billingConfig) {
        if (
          (billing.billingType !== undefined &&
            billing.billingType !== courseSeason.billingConfig.billingType) ||
          (billing.billingFrequency !== undefined &&
            billing.billingFrequency !==
              courseSeason.billingConfig.billingFrequency) ||
          (billing.billingDay !== undefined &&
            billing.billingDay !== courseSeason.billingConfig.billingDay) ||
          (billing.prorateRegistrationFee !== undefined &&
            billing.prorateRegistrationFee !==
              courseSeason.billingConfig.prorateRegistrationFee) ||
          (billing.prorateFirstRecurringFee !== undefined &&
            billing.prorateFirstRecurringFee !==
              courseSeason.billingConfig.prorateFirstRecurringFee) ||
          (billing.prorateLastRecurringFee !== undefined &&
            billing.prorateLastRecurringFee !==
              courseSeason.billingConfig.prorateLastRecurringFee) ||
          (billing.prorateSeasonFee !== undefined &&
            billing.prorateSeasonFee !==
              courseSeason.billingConfig.prorateSeasonFee)
        ) {
          throw new BadRequestException(
            'No se puede modificar la configuración base del motor de cobros (tipo, frecuencia, día y prorrateos) en una temporada activa. Solo se permite actualizar montos para nuevas inscripciones.',
          );
        }
      }
    }

    let season = await this.prisma.season.findUnique({
      where: { id: seasonId ? seasonId : courseSeason.season.id },
    });

    if (updateCourseSeasonDto.seasonId) {
      season = await this.prisma.season.findUnique({
        where: { id: updateCourseSeasonDto.seasonId },
      });
    }

    if (!season) {
      throw new NotFoundException('La temporada no fue encontrada');
    }

    if (
      season.status === SeasonStatus.FINISHED ||
      season.status === SeasonStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'No se puede actualizar ni reasignar un equipo a una temporada inactiva o finalizada',
      );
    }

    if (rest.billingConfig) {
      const currentBillingConfig = courseSeason.billingConfig;
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

    const { billingConfig, ...courseSeasonData } = rest;

    const updatedCourseCategory = await this.prisma.courseSeason.update({
      where: { id },
      data: {
        ...courseSeasonData,
        courseId,
        seasonId,
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
      },
      select: courseSeasonSelect,
    });
    return {
      message: 'Temporada de equipo actualizada exitosamente',
      data: updatedCourseCategory,
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
  async getShiftsByCourseSeasonOptions(courseSeasonId: string) {
    const courseSeasonShifts = await this.prisma.courseSeasonShift.findMany({
      where: { courseSeasonId },
      select: {
        id: true,
        shift: {
          select: {
            name: true,
          },
        },
      },
    });

    const formattedShifts = courseSeasonShifts.map((css) => ({
      id: css.id,
      name: css.shift.name,
    }));

    return {
      data: formattedShifts,
      message: 'Turnos de la temporada obtenidos exitosamente',
    };
  }

  async getShiftsByInstitutionOptions() {
    const institution = await this.prisma.institution.findFirst({
      select: {
        id: true,
      },
    });
    if (!institution) {
      throw new NotFoundException('La organización no fue encontrada');
    }

    const shifts = await this.prisma.shift.findMany({
      where: { institutionId: institution.id },
      select: {
        id: true,
        name: true,
      },
    });

    return {
      data: shifts,
      message: 'Turnos obtenidos exitosamente',
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
    const courseSeason = await this.prisma.courseSeason.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
      },
    });
    if (!courseSeason) {
      throw new NotFoundException('El turno no fue encontrado');
    }

    try {
      await this.prisma.courseSeason.delete({
        where: { id },
      });
      return {
        message: 'Turno eliminado exitosamente',
        data: courseSeason,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'No se puede eliminar el turno porque existen alumnos, ciclos financieros o clases programadas vinculadas. Intente inactivarlo.',
        );
      }
      throw error;
    }
  }

  async finish(id: string, finalizeCourseSeasonDto: FinalizeCourseSeasonDto) {
    const courseSeason = await this.prisma.courseSeason.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!courseSeason) {
      throw new NotFoundException('La temporada de equipo no fue encontrada');
    }

    if (courseSeason.status === StatusCourseSeason.ACTIVE) {
      const updatedCourseSeason = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.courseSeason.update({
          where: { id },
          data: {
            status: StatusCourseSeason.FINISHED,
          },
          select: courseSeasonSelect,
        });

        // Actualizar membresías activas o suspendidas a FINISHED
        await tx.studentMembership.updateMany({
          where: {
            courseSeasonId: id,
            status: {
              in: [
                StudentMembershipStatus.ACTIVE,
                StudentMembershipStatus.SUSPENDED,
                StudentMembershipStatus.ACTIVE,
              ],
            },
          },
          data: { status: StudentMembershipStatus.FINISHED },
        });

        return updated;
      });

      return {
        message: 'Temporada de equipo finalizada exitosamente',
        data: updatedCourseSeason,
      };
    } else {
      throw new BadRequestException(
        'Solo una temporada de equipo activa puede ser finalizada',
      );
    }
  }

  async cancel(id: string, cancelCourseSeasonDto: CancelCourseSeasonDto) {
    const courseSeason = await this.prisma.courseSeason.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!courseSeason) {
      throw new NotFoundException('La temporada de equipo no fue encontrada');
    }

    if (
      courseSeason.status === StatusCourseSeason.ACTIVE ||
      courseSeason.status === StatusCourseSeason.DRAFT
    ) {
      const updatedCourseSeason = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.courseSeason.update({
          where: { id },
          data: {
            status: StatusCourseSeason.CANCELLED,
          },
          select: courseSeasonSelect,
        });

        if (courseSeason.status === StatusCourseSeason.ACTIVE) {
          const memberships = await tx.studentMembership.findMany({
            where: {
              courseSeasonId: id,
              status: {
                in: [
                  StudentMembershipStatus.ACTIVE,
                  StudentMembershipStatus.SUSPENDED,
                  StudentMembershipStatus.ACTIVE,
                ],
              },
            },
            select: { id: true },
          });

          const membershipIds = memberships.map((m) => m.id);

          if (membershipIds.length > 0) {
            // Encontrar todos los cargos pendientes de estas membresías
            const membershipCharges = await tx.studentCharge.findMany({
              where: {
                studentMembershipId: { in: membershipIds },
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
            await tx.studentMembership.updateMany({
              where: { id: { in: membershipIds } },
              data: { status: StudentMembershipStatus.WITHDRAWN },
            });
          }
        }

        return updated;
      });

      return {
        message: 'Temporada de equipo cancelada exitosamente',
        data: updatedCourseSeason,
      };
    } else {
      throw new BadRequestException(
        'Esta temporada de equipo no puede ser cancelada',
      );
    }
  }

  async getPauses(courseSeasonId: string) {
    const pauses = await this.prisma.courseSeasonPause.findMany({
      where: { courseSeasonId },
      orderBy: { startDate: 'desc' },
    });
    return { data: pauses, message: 'Pausas obtenidas' };
  }

  async addPause(
    courseSeasonId: string,
    createPauseDto: {
      startDate: string;
      endDate: string;
      reason?: string;
      courseSeasonShiftId?: string;
    },
  ) {
    const courseSeason = await this.prisma.courseSeason.findUnique({
      where: { id: courseSeasonId },
      include: { season: true },
    });

    if (!courseSeason) throw new BadRequestException('Course season not found');

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
      startDate < courseSeason.season.startDate ||
      endDate > courseSeason.season.endDate
    ) {
      throw new BadRequestException(
        `Las fechas de la pausa deben estar dentro del rango de la temporada (${courseSeason.season.startDate.toISOString().split('T')[0]} - ${courseSeason.season.endDate.toISOString().split('T')[0]})`,
      );
    }

    const overlapping = await this.prisma.courseSeasonPause.findFirst({
      where: {
        courseSeasonId,
        ...(createPauseDto.courseSeasonShiftId
          ? { courseSeasonShiftId: createPauseDto.courseSeasonShiftId }
          : {}),
        OR: [{ startDate: { lte: endDate }, endDate: { gte: startDate } }],
      },
    });

    if (overlapping) {
      throw new BadRequestException(
        `Ya existe una pausa para esta oferta/turno en estas fechas (${overlapping.startDate.toISOString().split('T')[0]} - ${overlapping.endDate.toISOString().split('T')[0]})`,
      );
    }

    const pause = await this.prisma.courseSeasonPause.create({
      data: {
        courseSeasonId,
        courseSeasonShiftId: createPauseDto.courseSeasonShiftId,
        startDate,
        endDate,
        reason: createPauseDto.reason,
      },
    });

    return { message: 'Pausa agregada correctamente', data: pause };
  }

  async removePause(id: string) {
    const pause = await this.prisma.courseSeasonPause.findUnique({
      where: { id },
    });
    if (!pause) throw new BadRequestException('Pausa no encontrada');

    await this.prisma.courseSeasonPause.delete({
      where: { id },
    });

    return { message: 'Pausa eliminada correctamente' };
  }

  // Phase 7: Toggle Registration
  async toggleRegistration(id: string, isRegistrationOpen: boolean) {
    const courseSeason = await this.prisma.courseSeason.findUnique({
      where: { id },
    });

    if (!courseSeason) {
      throw new NotFoundException('El turno no fue encontrado');
    }

    const updated = await this.prisma.courseSeason.update({
      where: { id },
      data: { isRegistrationOpen },
      select: courseSeasonSelect,
    });

    return {
      message: `Las inscripciones han sido ${isRegistrationOpen ? 'abiertas' : 'cerradas'} exitosamente`,
      data: updated,
    };
  }
}
