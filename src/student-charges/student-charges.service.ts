import { BadRequestException, Injectable, Logger, HttpException } from '@nestjs/common';
import { PreviewStudentChargesDto } from './dto/preview-student-charges.dto';
import { CreateManualChargeDto } from './dto/create-manual-charge.dto';
import { CreateMassiveManualChargeDto } from './dto/create-massive-manual-charge.dto';
import { PrismaService } from 'src/prisma.service';
import { Prisma, TypeMembershipCharge } from 'src/generated/prisma/client';
import { DateUtils } from 'src/utils/date.utils';
import { StudentPreviewService } from './services/student-preview.service';
import { PreviewStudentFactory } from './factories/preview-student.factory';
import { StudentChargeRepository } from './repositories/student-charge.repository';
import { StudentMembershipRepository } from './repositories/student-membership.repository';
import { StudentCourseSeasonValidator } from './validators/student-course-season.validator';
import { PrismaErrorUtils } from 'src/utils/prisma-error.util';
import { StudentEnrollmentService } from './services/student-enrollment.service';
import { StudentManualChargeService } from './services/student-manual-charge.service';
import { StudentAdvanceChargeService } from './services/student-advance-charge.service';
import { buildValidOccupancyCondition } from 'src/common/helpers/capacity.helper';
import { getAbsoluteSeasonCycles } from './student-billing.utils';
import { CycleCapacityDto } from './dto/cycle-capacity.dto';

/**
 * Servicio central orquestador de cargos (charges) para membresías de estudiantes.
 * Responsable de coordinar la previsualización, generación diaria (cron),
 * cobros masivos, cobros manuales y cálculos de recalibración (ej. al cambiar de plan).
 */
@Injectable()
export class StudentChargesService {
  private readonly logger = new Logger(StudentChargesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly previewService: StudentPreviewService,
    private readonly membershipRepo: StudentMembershipRepository,
    private readonly chargeRepo: StudentChargeRepository,
    private readonly manualChargeService: StudentManualChargeService,
    private readonly advanceChargeService: StudentAdvanceChargeService,
    private readonly enrollmentService: StudentEnrollmentService,
  ) {}

  /**
   * Genera un desglose simulado (preview) de cómo se verán los cargos para una nueva
   * membresía ANTES de ser creada.
   * Valida que la fecha de inicio esté dentro de la temporada y construye un entorno
   * virtual ("mock") de la membresía para calcular matemáticamente las primeras cuotas.
   *
   * @param data Configuraciones como courseSeasonId, paymentPlanId, startDate y descuentos.
   * @returns Estructura IPreviewChargesResponse con cargos y totales.
   */
  async previewCharges(data: PreviewStudentChargesDto) {
    const {
      courseSeasonId,
      paymentPlanId,
      startDate,
      studentDiscounts = [],
      isMigrated,
    } = data;

    const courseSeason =
      await this.membershipRepo.getCourseSeasonOrThrow(courseSeasonId);

    StudentCourseSeasonValidator.assertIsActive(
      courseSeason,
      'No se pueden previsualizar cargos de una temporada o equipo inactivo (cancelado o finalizado)',
    );

    const paymentPlan =
      await this.membershipRepo.getPaymentPlanOrThrow(paymentPlanId);

    const mockStartedAt = new Date(startDate);
    const seasonStart = DateUtils.getStartOfUTCDay(
      courseSeason.season.startDate,
    );
    const seasonEndValidation = DateUtils.getEndOfUTCDay(
      courseSeason.season.endDate,
    );

    StudentCourseSeasonValidator.assertDateWithinSeason(
      mockStartedAt,
      seasonStart,
      seasonEndValidation,
    );

    const parsedDiscounts =
      PreviewStudentFactory.parseDiscounts(studentDiscounts);

    const mockMembership = PreviewStudentFactory.createMockMembership(
      mockStartedAt,
      courseSeason,
      paymentPlan,
      parsedDiscounts,
      isMigrated || false,
      data.chargeRegistrationOnMigration,
      data.chargeCurrentMonthOnMigration,
      data.chargeRegistration,
      data.chargeInitialCycle,
    );

    return this.previewService.extractOnDemandPreviewCharges(
      mockMembership
    );
  }

  /**
   * Extrae y formatea los cargos reales que ya están almacenados en la base de datos
   * para una membresía existente. Usado cuando un administrador visualiza el drawer
   * de una membresía activa y requiere ver lo que el sistema ya calculó.
   *
   * @param membershipId ID real de la membresía.
   */
  async previewExistingCharges(membershipId: string) {
    const membership =
      await this.membershipRepo.getMembershipOrThrow(membershipId);
    const existingCharges = await this.chargeRepo.fetchExistingCharges(
      this.prisma,
      membershipId,
      [
        TypeMembershipCharge.REGISTRATION,
        TypeMembershipCharge.SEASON_FEE,
        TypeMembershipCharge.RECURRING_FEE,
      ],
    );

    // In On-Demand model, the preview for existing just uses the mathematical calculation.
    return this.previewService.extractOnDemandPreviewCharges(
      membership
    );
  }

  /**
   * Evento transaccional ejecutado inmediatamente después de que un jugador
   * compra o inscribe una membresía. Fuerza la creación del cobro inicial
   * (matrícula y primera cuota) en tiempo real.
   */
  async generateChargesForNewMembership(
    membershipId: string,
    options?: {
      chargeRegistrationOnMigration?: boolean;
      chargeCurrentMonthOnMigration?: boolean;
      chargeRegistration?: boolean;
      chargeInitialCycle?: boolean;
      forceFullCycleFee?: boolean;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const membership =
      await this.membershipRepo.getMembershipById(membershipId, tx);
    if (!membership) return [];

    const generationMembership = {
      ...membership,
      chargeRegistrationOnMigration:
        options?.chargeRegistrationOnMigration ??
        membership.chargeRegistrationOnMigration,
      chargeCurrentMonthOnMigration:
        options?.chargeCurrentMonthOnMigration ??
        membership.chargeCurrentMonthOnMigration,
    } as typeof membership;

    try {
      return await this.enrollmentService.enrollInitialCycle(
        membershipId,
        options,
        tx,
      );
    } catch (error) {
      if (PrismaErrorUtils.isUniqueConstraintViolation(error)) {
        this.logger.warn(
          `Colisión de cargos prevenida (idempotencia) al generar cargos de nueva membresía ${membershipId}`,
        );
      } else {
        this.logger.error(
          `Error generando cargos para nueva membresía ID ${membershipId}:`,
          error,
        );
        // Propagar errores de negocio (o cualquier error si estamos en transacción, 
        // para abortar la creación completa)
        if (error instanceof HttpException || tx) {
          throw error;
        }
      }
      return [];
    }
  }

  /**
   * Aplica un cargo extraordinario (Multa, uniforme, extra) a todos los miembros
   * activos de una temporada. Emplea un mecanismo altamente optimizado usando
   * inserciones masivas (createMany) fraccionadas, permitiendo operar
   * miles de usuarios instantáneamente.
   */
  async createMassiveManualCharge(dto: CreateMassiveManualChargeDto) {
    return this.manualChargeService.createMassiveManualCharge(dto);
  }

  /**
   * Crea un cargo extraordinario manual para un único jugador específico.
   */
  async createManualCharge(dto: CreateManualChargeDto) {
    return this.manualChargeService.createManualCharge(dto);
  }

  async getAvailableCycles(membershipId: string) {
    return this.advanceChargeService.getAvailableCycles(membershipId);
  }

  /**
   * Simula N ciclos hacia adelante sin guardarlos en la base de datos.
   * Util para mostrarle al usuario un preview de "Pagar 3 cuotas por adelantado".
   */
  async previewAdvanceCharges(membershipId: string, cycles: { cycleStartDate: Date; enrollmentDate?: string }[]) {
    return this.advanceChargeService.previewAdvanceCharges(
      membershipId,
      cycles,
    );
  }

  /**
   * Concreta la generación física (persistida) de N cuotas por adelantado
   * bajo el contexto de un solo agrupamiento transaccional.
   */
  async purchaseAdvanceCycles(membershipId: string, cycles: { cycleStartDate: Date; enrollmentDate?: string }[]) {
    return this.advanceChargeService.purchaseAdvanceCycles(
      membershipId,
      cycles
    );
  }

  async getCycleCapacity(courseSeasonId: string, shiftId?: string): Promise<CycleCapacityDto[]> {
    // 1. Validar la existencia de la temporada y obtener configuración
    const courseSeason = await this.prisma.courseSeason.findUnique({
      where: { id: courseSeasonId },
      include: {
        season: true,
        shifts: {
          include: { shift: true },
          where: shiftId ? { id: shiftId } : undefined,
        },
        billingConfig: true,
      },
    });

    if (!courseSeason) {
      throw new BadRequestException('La temporada de curso no fue encontrada');
    }

    if (shiftId && courseSeason.shifts.length === 0) {
      throw new BadRequestException('El turno especificado no existe o no pertenece a esta temporada');
    }

    // 2. Generar los ciclos base usando la misma función del motor financiero
    const seasonStartDate = courseSeason.season.startDate;
    const seasonEndDate = courseSeason.season.endDate;
    const billingFrequency = courseSeason.billingConfig?.billingFrequency || 'MONTHLY';

    const absoluteCycles = getAbsoluteSeasonCycles(seasonStartDate, seasonEndDate, billingFrequency);

    // 3. Ejecutar consulta de ocupación usando groupBy de Prisma y validOccupancyCondition (sin N+1)
    const validOccupancyCondition = buildValidOccupancyCondition();

    const aggregations = await this.prisma.cycleEnrollment.groupBy({
      by: ['courseSeasonShiftId', 'cycleStartDate', 'cycleEndDate'],
      where: {
        courseSeasonShift: { courseSeasonId },
        ...(shiftId && { courseSeasonShiftId: shiftId }),
        ...validOccupancyCondition,
      },
      _count: { _all: true },
    });

    // 4. Mapeo O(1) de las agregaciones para cruce eficiente
    const occupancyMap = new Map<string, number>();
    for (const agg of aggregations) {
      // Usar ambas fechas + shiftId garantiza que no hay falsos positivos entre turnos o ciclos
      const key = `${agg.courseSeasonShiftId}_${agg.cycleStartDate.getTime()}_${agg.cycleEndDate.getTime()}`;
      occupancyMap.set(key, agg._count._all);
    }

    const capacityResponse: CycleCapacityDto[] = [];

    // 5. Cruzar cada turno de la temporada con cada ciclo temporal
    for (const shift of courseSeason.shifts) {
      for (const cycle of absoluteCycles) {
        const key = `${shift.id}_${cycle.cycleStartDate.getTime()}_${cycle.cycleEndDate.getTime()}`;
        const occupiedSpots = occupancyMap.get(key) || 0;
        const maxMembers = shift.maxMembers;

        let availableSpots: number | null = null;
        let status: 'AVAILABLE' | 'FULL' = 'AVAILABLE';

        if (maxMembers !== null) {
          availableSpots = Math.max(0, maxMembers - occupiedSpots);
          if (availableSpots === 0) {
            status = 'FULL';
          }
        }

        capacityResponse.push({
          cycleStartDate: cycle.cycleStartDate,
          cycleEndDate: cycle.cycleEndDate,
          shiftId: shift.id,
          shiftName: shift.shift?.name || 'Desconocido',
          maxMembers,
          occupiedSpots,
          availableSpots,
          status,
        });
      }
    }

    // Ordenar de manera determinística: primero por turno, luego cronológicamente por ciclo
    capacityResponse.sort((a, b) => {
      if (a.shiftName !== b.shiftName) {
        return a.shiftName.localeCompare(b.shiftName);
      }
      return a.cycleStartDate.getTime() - b.cycleStartDate.getTime();
    });

    return capacityResponse;
  }
}
