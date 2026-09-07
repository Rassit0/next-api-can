import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';
import { PrismaService } from 'src/prisma.service';
import {
  PlayerMembershipWithRelations,
  calculateRegistrationFee,
  calculateSinglePaymentFee,
} from '../membership-financial.calculator';
import {
  formatDiscountsDescription,
  extractDiscountReason,
} from '../membership-billing.utils';
import { simulateAllCycles, SimulatedCycle } from '../membership-cycles.engine';
import { MembershipChargeFactory } from '../membership-charge.factory';
import { TypeMembershipCharge } from 'src/generated/prisma/client';
import { CycleBatch } from '../interfaces/membership-charge.types';
import { DateUtils } from 'src/utils/date.utils';
import { MembershipChargeRepository } from '../repositories/membership-charge.repository';
import { MembershipRepository } from '../repositories/membership.repository';

@Injectable()
export class MembershipGenerationService {
  private readonly logger = new Logger(MembershipGenerationService.name);

  constructor(
    private readonly membershipRepo: MembershipRepository,
    private readonly chargeRepo: MembershipChargeRepository,
  ) {}

  public async ensureMembershipCharges(
    tx: Prisma.TransactionClient,
    membership: PlayerMembershipWithRelations,
    evaluationDate: Date,
  ): Promise<string[]> {
    const chargeIds: string[] = [];
    if (!membership.isMigrated || membership.chargeRegistrationOnMigration) {
      const regId = await this.ensureRegistrationCharge(tx, membership);
      if (regId) chargeIds.push(regId);
    }
    const recIds = await this.ensureRecurringCharges(tx, membership, evaluationDate);
    chargeIds.push(...recIds);
    return chargeIds;
  }

  public async ensureRegistrationCharge(
    tx: Prisma.TransactionClient,
    membership: PlayerMembershipWithRelations,
  ): Promise<string | null> {
    const startYear = membership.startedAt.getUTCFullYear();
    const startMonth = membership.startedAt.getUTCMonth() + 1;

    const exists = await this.chargeRepo.checkRegistrationChargeExists(
      tx,
      membership.id,
      startYear,
      startMonth,
    );
    if (exists) return null;

    const { baseAmount, netAmount, appliedDiscounts } =
      calculateRegistrationFee(membership);
    if (baseAmount <= 0) return null;

    const description =
      'Inscripción' + formatDiscountsDescription(appliedDiscounts);
    const charge = await tx.charge.create({
      data: MembershipChargeFactory.buildRegistrationChargePayload(
        membership.id,
        baseAmount,
        baseAmount - netAmount,
        description,
        membership.startedAt,
        extractDiscountReason(appliedDiscounts),
      ),
    });
    return charge.id;
  }

  public async ensureRecurringCharges(
    tx: Prisma.TransactionClient,
    membership: PlayerMembershipWithRelations,
    evaluationDate: Date,
  ): Promise<string[]> {
    const allCycles = simulateAllCycles(membership);
    const generationDate = this.resolveGenerationPointer(
      membership,
      allCycles,
      evaluationDate,
    );
    let nextPointer: Date | null = generationDate;

    if (
      !generationDate &&
      membership.isMigrated &&
      membership.nextRecurringChargeGenerationDate !== null
    ) {
      await this.membershipRepo.updateNextGenerationPointer(
        tx,
        membership.id,
        membership.nextRecurringChargeGenerationDate,
        null,
      );
      return [];
    }

    const isSeasonFeeOnly =
      membership.teamSeason.billingConfig?.billingType === 'SINGLE_ONLY' ||
      (membership.teamSeason.billingConfig?.billingType === 'BOTH' &&
        membership.paymentPlan?.isSinglePayment === true);
    const isFullPaymentPlan = membership.paymentPlan?.isSinglePayment === true;

    const generatedIds: string[] = [];

    if (isSeasonFeeOnly) {
      const spId = await this.processSinglePaymentGeneration(
        tx,
        membership,
        allCycles,
      );
      if (spId) generatedIds.push(spId);
    } else {
      const billingFrequency =
        membership.teamSeason.billingConfig?.billingFrequency || 'MONTHLY';
      const existingChargesSet = await this.fetchExistingChargesSet(
        tx,
        membership.id,
        billingFrequency,
      );

      // Si es pago completo, generamos todos los ciclos ignorando evaluationDate
      const evalDateToUse = isFullPaymentPlan
        ? DateUtils.getEndOfUTCDay(membership.teamSeason.season.endDate)
        : evaluationDate;

      if (generationDate) {
        const { nextPointer: calcPointer, chargeIds } = await this.processRecurringGeneration(
          tx,
          membership,
          allCycles,
          generationDate,
          evalDateToUse,
          existingChargesSet,
        );
        generatedIds.push(...chargeIds);
        nextPointer = calcPointer;
      }
    }

    await this.membershipRepo.updateNextGenerationPointer(
      tx,
      membership.id,
      membership.nextRecurringChargeGenerationDate,
      nextPointer,
    );
    return generatedIds;
  }

  public async generateAdvanceCharges(
    tx: Prisma.TransactionClient,
    membership: PlayerMembershipWithRelations,
    cyclesToGenerate: SimulatedCycle[],
    existingChargesSet?: Set<string>,
  ): Promise<string[]> {
    const { lastGeneratedCycle, chargeIds } = await this.createRecurringChargesFromCycles(
      tx,
      membership,
      cyclesToGenerate,
      existingChargesSet,
    );

    if (lastGeneratedCycle) {
      const nextPointer = this.calculateNextGenerationPointer(
        membership,
        lastGeneratedCycle.nextDueDate,
      );
      await this.membershipRepo.updateNextGenerationPointer(
        tx,
        membership.id,
        membership.nextRecurringChargeGenerationDate,
        nextPointer,
      );
    }
    return chargeIds;
  }

  private async processSinglePaymentGeneration(
    tx: Prisma.TransactionClient,
    membership: PlayerMembershipWithRelations,
    allCycles: SimulatedCycle[],
  ): Promise<string | null> {
    if (membership.isMigrated) {
      await this.membershipRepo.updateNextGenerationPointer(
        tx,
        membership.id,
        membership.nextRecurringChargeGenerationDate,
        null,
      );
      return null;
    }

    const startBillingYear = membership.startedAt.getUTCFullYear();
    const startBillingMonth = membership.startedAt.getUTCMonth() + 1;

    const exists = await this.chargeRepo.checkSeasonChargeExists(
      tx,
      membership.id,
      startBillingYear,
      startBillingMonth,
    );

    if (!exists) {
      let singlePaymentBaseAmount = 0;
      let singlePaymentDiscountPercent = 0;

      for (const cycle of allCycles) {
        singlePaymentBaseAmount += cycle.baseAmount;
        singlePaymentDiscountPercent = cycle.discountPercent;
      }

      const singlePayment = calculateSinglePaymentFee(
        membership,
        singlePaymentBaseAmount,
        singlePaymentDiscountPercent,
      );
      if (singlePayment.hasSinglePaymentAmount) {
        const charge = await tx.charge.create({
          data: MembershipChargeFactory.buildSeasonChargePayload(
            membership.id,
            singlePayment.baseAmount,
            singlePayment.baseAmount - singlePayment.netAmount,
            singlePayment.description,
            membership.startedAt,
            startBillingYear,
            startBillingMonth,
            extractDiscountReason(singlePayment.appliedDiscounts),
          ),
        });
        return charge.id;
      }
    }
    return null;
  }

  private async processRecurringGeneration(
    tx: Prisma.TransactionClient,
    membership: PlayerMembershipWithRelations,
    allCycles: SimulatedCycle[],
    generationDate: Date,
    evaluationDate: Date,
    existingChargesSet: Set<string>,
  ): Promise<{ nextPointer: Date | null; chargeIds: string[] }> {
    let nextPointer: Date | null = generationDate;
    const chargeIds: string[] = [];

    const ungeneratedCycles = allCycles.filter(
      (cycle) => !this.isCycleGenerated(cycle, existingChargesSet, membership),
    );

    const validStartingCycles = ungeneratedCycles.filter((c) => {
      let cycleGenDate = this.calculateNextGenerationPointer(
        membership,
        c.dueDate,
      );
      // Removed cycleGenDate override to allow generation if within the generation window
      return cycleGenDate && cycleGenDate <= evaluationDate;
    });

    if (validStartingCycles.length === 0) {
      if (membership.isMigrated || generationDate > membership.startedAt) {
        let tempPointer = new Date(membership.startedAt);
        for (const cycle of allCycles) {
          if (tempPointer >= generationDate) break;
          const cycleGenDate = this.calculateNextGenerationPointer(
            membership,
            cycle.dueDate,
          );
          if (cycleGenDate) tempPointer = cycleGenDate;
        }
      }
      return { nextPointer, chargeIds };
    }

    let currentIndex = ungeneratedCycles.indexOf(validStartingCycles[0]);
    if (currentIndex === -1) return { nextPointer, chargeIds };

    const advanceCycles = Math.max(
      1,
      membership.paymentPlan?.advanceCycles || 1,
    );
    const seasonEnd = DateUtils.getEndOfUTCDay(
      membership.teamSeason.season.endDate,
    );

    while (currentIndex < ungeneratedCycles.length) {
      const cycle = ungeneratedCycles[currentIndex];
      let cycleGenDate = this.calculateNextGenerationPointer(
        membership,
        cycle.dueDate,
      );
      // Removed cycleGenDate override to allow generation if within the generation window

      if (!cycleGenDate || cycleGenDate > evaluationDate) {
        break;
      }

      const currentBatchAdvanceCycles =
        cycle.cycleCounter <= advanceCycles
          ? advanceCycles - cycle.cycleCounter + 1
          : 1;
      const batch = this.chunkCyclesByAdvanceConfiguration(
        ungeneratedCycles,
        currentIndex,
        currentBatchAdvanceCycles,
        seasonEnd,
      );
      if (batch.cycles.length > 0) {
        const { chargeIds: batchIds } = await this.createRecurringChargesFromCycles(
          tx,
          membership,
          batch.cycles,
          existingChargesSet,
          batch.groupDueDate,
        );
        chargeIds.push(...batchIds);

        nextPointer = this.calculateNextGenerationPointer(
          membership,
          batch.lastCycleNextDueDate,
        );
      } else {
        nextPointer = null;
      }

      currentIndex += batch.cycles.length > 0 ? batch.cycles.length : 1;
    }

    return { nextPointer, chargeIds };
  }

  private chunkCyclesByAdvanceConfiguration(
    ungeneratedCycles: SimulatedCycle[],
    startIndex: number,
    advanceCycles: number,
    seasonEnd: Date,
  ): CycleBatch {
    const cycles: SimulatedCycle[] = [];
    const firstCycle = ungeneratedCycles[startIndex];

    if (!firstCycle)
      return {
        cycles: [],
        groupDueDate: new Date(),
        lastCycleNextDueDate: new Date(),
      };

    let lastNextDueDate = firstCycle.nextDueDate;

    for (let i = 0; i < advanceCycles; i++) {
      const c = ungeneratedCycles[startIndex + i];
      if (!c) break;
      if (i > 0 && c.dueDate > seasonEnd) break;

      cycles.push(c);
      lastNextDueDate = c.nextDueDate;
      if (c.nextDueDate > seasonEnd) break;
    }

    return {
      cycles,
      groupDueDate: firstCycle.dueDate,
      lastCycleNextDueDate: lastNextDueDate,
    };
  }

  public async fetchExistingChargesSet(
    tx: Prisma.TransactionClient | PrismaService,
    membershipId: string,
    billingFrequency: string,
  ): Promise<Set<string>> {
    const existing = await this.chargeRepo.fetchExistingCharges(
      tx,
      membershipId,
      [TypeMembershipCharge.RECURRING_FEE],
    );
    return new Set(
      existing.map(
        (c) =>
          `${c.billingYear}-${c.billingMonth}-${billingFrequency === 'MONTHLY' ? 'NONE' : c.billingCycle}`,
      ),
    );
  }

  public isCycleGenerated(
    cycle: SimulatedCycle,
    existingChargesSet: Set<string>,
    membership: PlayerMembershipWithRelations,
  ): boolean {
    const freq =
      membership.teamSeason.billingConfig?.billingFrequency || 'MONTHLY';
    const chargeKey = `${cycle.billingYear}-${cycle.billingMonth}-${freq === 'MONTHLY' ? 'NONE' : cycle.billingCycle}`;

    if (existingChargesSet.has(chargeKey)) return true;

    if (membership.isMigrated && !membership.chargeCurrentMonthOnMigration) {
      const startYear = membership.startedAt.getUTCFullYear();
      const startMonth = membership.startedAt.getUTCMonth() + 1;
      if (
        cycle.billingYear < startYear ||
        (cycle.billingYear === startYear && cycle.billingMonth <= startMonth)
      ) {
        return true;
      }
    }

    return false;
  }

  public calculateNextGenerationPointer(
    membership: PlayerMembershipWithRelations,
    lastNextDueDate: Date,
  ): Date | null {
    const seasonEnd = DateUtils.getEndOfUTCDay(
      membership.teamSeason.season.endDate,
    );
    if (lastNextDueDate > seasonEnd) return null;

    const nextGenerationDate = new Date(lastNextDueDate);
    nextGenerationDate.setUTCDate(
      nextGenerationDate.getUTCDate() -
        (membership.teamSeason.billingConfig?.chargeGenerationDaysBefore || 7),
    );
    return nextGenerationDate;
  }

  public resolveGenerationPointer(
    membership: PlayerMembershipWithRelations,
    allCycles: SimulatedCycle[],
    evaluationDate: Date,
  ): Date | null {
    if (membership.nextRecurringChargeGenerationDate)
      return membership.nextRecurringChargeGenerationDate;
    if (!membership.isMigrated || membership.chargeCurrentMonthOnMigration)
      return new Date(membership.startedAt);

    let tempPointer = new Date(membership.startedAt);
    const startYear = membership.startedAt.getUTCFullYear();
    const startMonth = membership.startedAt.getUTCMonth() + 1;

    for (const cycle of allCycles) {
      // Para membresías migradas, asumimos que todo el mes actual (el mes de startedAt) y anteriores
      // ya fueron pagados en el sistema anterior. Saltamos estos ciclos.
      const isCycleFromPastOrCurrentMonth =
        cycle.billingYear < startYear ||
        (cycle.billingYear === startYear && cycle.billingMonth <= startMonth);

      if (isCycleFromPastOrCurrentMonth) {
        const nextGenerationDate = this.calculateNextGenerationPointer(
          membership,
          cycle.nextDueDate,
        );
        if (!nextGenerationDate) {
          tempPointer = new Date(0);
          break;
        }
        tempPointer = nextGenerationDate;
      } else {
        break;
      }
    }
    return tempPointer.getTime() === 0 ? null : tempPointer;
  }

  public async createRecurringChargesFromCycles(
    tx: Prisma.TransactionClient | PrismaService,
    membership: PlayerMembershipWithRelations,
    cycles: SimulatedCycle[],
    existingChargesSet?: Set<string>,
    groupDueDate?: Date,
  ): Promise<{ lastGeneratedCycle: SimulatedCycle | null; count: number; chargeIds: string[] }> {
    const billingFrequency =
      membership.teamSeason.billingConfig?.billingFrequency || 'MONTHLY';
    let lastGeneratedCycle: SimulatedCycle | null = null;
    let count = 0;
    const chargeIds: string[] = [];

    for (const cycle of cycles) {
      if (cycle.netAmount >= 0) {
        const charge = await tx.charge.create({
          data: MembershipChargeFactory.buildRecurringChargePayload(
            membership.id,
            cycle.baseAmount,
            cycle.baseAmount - cycle.netAmount,
            cycle.description,
            groupDueDate || cycle.dueDate,
            cycle.billingYear,
            cycle.billingMonth,
            billingFrequency === 'MONTHLY' ? null : cycle.billingCycle,
            extractDiscountReason(cycle.appliedDiscounts),
          ),
        });
        chargeIds.push(charge.id);
        if (existingChargesSet) {
          existingChargesSet.add(
            `${cycle.billingYear}-${cycle.billingMonth}-${billingFrequency === 'MONTHLY' ? 'NONE' : cycle.billingCycle}`,
          );
        }
      }
      lastGeneratedCycle = cycle;
      count++;
    }

    return { lastGeneratedCycle, count, chargeIds };
  }

  public async findNextUngeneratedCycles(
    tx: Prisma.TransactionClient | PrismaService,
    membership: PlayerMembershipWithRelations,
    quantity: number,
  ): Promise<SimulatedCycle[]> {
    const billingFrequency =
      membership.teamSeason.billingConfig?.billingFrequency || 'MONTHLY';
    const allCycles = simulateAllCycles(membership);
    const existingChargesSet = await this.fetchExistingChargesSet(
      tx,
      membership.id,
      billingFrequency,
    );

    const nextCycles: SimulatedCycle[] = [];
    for (const cycle of allCycles) {
      if (!this.isCycleGenerated(cycle, existingChargesSet, membership)) {
        nextCycles.push(cycle);
        if (nextCycles.length === quantity) break;
      }
    }

    return nextCycles;
  }
}
