import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { StudentMembershipRepository } from '../repositories/student-membership.repository';
import { StudentPreviewService } from './student-preview.service';
import { DateUtils } from 'src/utils/date.utils';
import { Prisma, TypeMembershipCharge, StatusCharge, CycleEnrollmentStatus } from 'src/generated/prisma/client';
import { getAbsoluteSeasonCycles, findCycleContainingDate, calculateEffectiveBillablePeriod, calculateBillableDaysWithPauses, MILLISECONDS_IN_DAY, buildCycleDescription, resolveFinancialEnrollmentOptions } from '../student-billing.utils';
import { calculateOnDemandCycleFee, calculateRegistrationFee, calculateSinglePaymentFee } from '../student-financial.calculator';
import { validateCourseSeasonCapacity } from 'src/common/helpers/capacity.helper';

import { StudentCycleManagerService } from './student-cycle-manager.service';

@Injectable()
export class StudentEnrollmentService {
  private readonly logger = new Logger(StudentEnrollmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly membershipRepo: StudentMembershipRepository,
    private readonly cycleManager: StudentCycleManagerService,
  ) {}

  /**
   * FASE 2.6: Inscribe al estudiante en su primer ciclo (o ciclos de adelanto inicial).
   * Reemplaza a la antigua lógica de generación automática para nuevas membresías.
   */
  async enrollInitialCycle(
    membershipId: string,
    options?: {
      chargeRegistration?: boolean;
      chargeInitialCycle?: boolean;
      chargeRegistrationOnMigration?: boolean;
      chargeCurrentMonthOnMigration?: boolean;
      forceFullCycleFee?: boolean;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const prisma = tx || this.prisma;
    const membership = await this.membershipRepo.getMembershipById(membershipId, tx);
    if (!membership) return [];

    const isMigratedContext = membership.isMigrated;
    const { chargeRegistration, chargeInitialCycle } = resolveFinancialEnrollmentOptions(isMigratedContext, options);

    const seasonStartDate = membership.courseSeason.season.startDate;
    const seasonEndDate = membership.courseSeason.season.endDate;
    const billingFrequency = membership.courseSeason.billingConfig?.billingFrequency || 'MONTHLY';
    
    const isSeasonFeeOnly =
      membership.courseSeason.billingConfig?.billingType === 'SINGLE_ONLY' ||
      (membership.courseSeason.billingConfig?.billingType === 'BOTH' &&
        membership.paymentPlan?.isSinglePayment === true);
    
    const isFullPaymentPlan = membership.paymentPlan?.isSinglePayment === true;

    // Obtener todos los ciclos matemáticos (virtuales)
    const allCycles = getAbsoluteSeasonCycles(seasonStartDate, seasonEndDate, billingFrequency);
    
    // 1. Validar que startedAt no sea anterior al inicio de la temporada
    if (membership.startedAt.getTime() < seasonStartDate.getTime()) {
      throw new BadRequestException('La fecha de inicio de la membresía no puede ser anterior al inicio de la temporada.');
    }

    // Resolver ciclos a los que se inscribirá explícitamente
    const cyclesToEnroll = [];
    const fs = require('fs');
    fs.appendFileSync('enrollment-debug.log', `[DEBUG] enrollInitialCycle: isSeasonFeeOnly=${isSeasonFeeOnly}, startedAt=${membership.startedAt}, chargeReg=${chargeRegistration}, chargeInit=${chargeInitialCycle}\n`);
    
    if (isSeasonFeeOnly) {
       const singleCycle = allCycles[0];
       if (singleCycle) {
          cyclesToEnroll.push(singleCycle);
       }
    } else {
       const firstCycle = findCycleContainingDate(allCycles, membership.startedAt);
       if (firstCycle) {
           const advanceCycles = isFullPaymentPlan ? allCycles.length : Math.max(1, membership.paymentPlan?.advanceCycles || 1);
           const cycleIndex = allCycles.findIndex(c => c.cycleCounter === firstCycle.cycleCounter);
           for (let i = 0; i < advanceCycles; i++) {
               const currentCycle = allCycles[cycleIndex + i];
               if (currentCycle) {
                   cyclesToEnroll.push(currentCycle);
               }
           }
       }
    }
    fs.appendFileSync('enrollment-debug.log', `[DEBUG] cyclesToEnroll length: ${cyclesToEnroll.length}\n`);

    // Usamos una transacción para garantizar atomicidad
    try {
      const executeEnrollment = async (db: Prisma.TransactionClient): Promise<string[]> => {
        const generatedChargeIds: string[] = [];
        // 1. Inscripción (Matrícula)
        let totalRegistrationAmount = 0;
        let registrationDiscount = 0;
        let baseRegistrationAmount = 0;

        if (chargeRegistration) {
           const existingRegistration = await db.studentCharge.findFirst({
               where: { studentMembershipId: membership.id, type: TypeMembershipCharge.REGISTRATION }
           });
           
           if (!existingRegistration) {
               const regFeeCalculation = calculateRegistrationFee(membership);
               if (regFeeCalculation.baseAmount && regFeeCalculation.baseAmount > 0) {
                   baseRegistrationAmount = regFeeCalculation.baseAmount;
                   totalRegistrationAmount = regFeeCalculation.netAmount;
                   registrationDiscount = regFeeCalculation.adjustmentAmount;
                   
                   // Creamos el cargo de matrícula genérico
                   const registrationCharge = await db.charge.create({
                      data: {
                          amount: baseRegistrationAmount,
                          pendingAmount: totalRegistrationAmount,
                          adjustmentAmount: registrationDiscount,
                          description: 'Inscripción',
                          status: totalRegistrationAmount > 0 ? StatusCharge.PENDING : StatusCharge.PAID,
                          dueDate: DateUtils.getEndOfUTCDay(membership.startedAt),
                      }
                   });
                   
                   await db.studentCharge.create({
                      data: {
                          studentMembershipId: membership.id,
                          chargeId: registrationCharge.id,
                          type: TypeMembershipCharge.REGISTRATION,
                      }
                   });
                   generatedChargeIds.push(registrationCharge.id);
               }
           }
        }

        // 2. Crear los CycleEnrollments y sus Charges a través del orquestador central
        const { generatedChargeIds: cycleChargeIds } = await this.cycleManager.enrollCyclesToMembership(
          membership,
          cyclesToEnroll,
          membership.startedAt, // enrollmentDate explícito (para inscripción inicial, es el startedAt)
          {
            chargeInitialCycle,
            isSeasonFeeOnly,
            billingFrequency,
            forceFullCycleFee: options?.forceFullCycleFee,
          },
          db
        );
        generatedChargeIds.push(...cycleChargeIds);
        return generatedChargeIds;
      };

      let finalChargeIds: string[] = [];
      if (tx) {
        fs.appendFileSync('enrollment-debug.log', '[DEBUG] Executing with existing tx\n');
        finalChargeIds = await executeEnrollment(tx);
      } else {
        fs.appendFileSync('enrollment-debug.log', '[DEBUG] Executing with new tx\n');
        finalChargeIds = await this.prisma.$transaction(async (db) => {
          return await executeEnrollment(db);
        });
      }
      this.logger.log(`Enrollment On-Demand exitoso para membresía ${membershipId}`);
      return finalChargeIds;
    } catch (error) {
       this.logger.error(`Error en enrollment On-Demand para membresía ID ${membershipId}:`, error);
       throw error;
    }
  }
}
