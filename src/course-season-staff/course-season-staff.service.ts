import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateCourseSeasonStaffDto } from './dto/create-course-season-staff.dto';
import { UpdateCourseSeasonStaffDto } from './dto/update-course-season-staff.dto';
import { PrismaService } from 'src/prisma.service';
import { Prisma } from 'src/generated/prisma/client';
import { CourseSeasonStaffPaginationDto } from './dto/pagination.dto';
import { createPaginationResult } from 'src/common/helpers/pagination.helper';

export const courseSeasonStaffSelect: Prisma.CourseSeasonStaffSelect = {
  id: true,
  role: true,
  customRole: true,
  startedAt: true,
  endedAt: true,
  isPrimary: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  courseSeasonShift: {
    select: {
      id: true,
      courseSeason: {
        select: {
          id: true,
          name: true,
          course: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },
  staff: {
    select: {
      id: true,
      person: {
        select: {
          id: true,
          name: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
  },
};

import { I18nService } from 'nestjs-i18n';

@Injectable()
export class CourseSeasonStaffService {
  private readonly logger = new Logger('CourseSeasonStaffService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async create(createCourseSeasonStaffDto: CreateCourseSeasonStaffDto) {
    const { courseSeasonShiftId, isPrimary } = createCourseSeasonStaffDto;

    const newStaffAssoc = await this.prisma.$transaction(async (tx) => {
      // Si se marca como primario, remover la bandera de los demás
      if (isPrimary) {
        await tx.courseSeasonStaff.updateMany({
          where: { courseSeasonShiftId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      return await tx.courseSeasonStaff.create({
        data: createCourseSeasonStaffDto,
        select: courseSeasonStaffSelect,
      });
    });

    return {
      message: this.i18n.t('messages.COURSE_STAFF_CREATED'),
      data: newStaffAssoc,
    };
  }

  async findAll(paginationDto: CourseSeasonStaffPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'asc',
      sortField = 'startedAt',
    } = paginationDto;
    const skip = (page - 1) * per_page;

    const where: Prisma.CourseSeasonStaffWhereInput = {};

    if (search) {
      where.OR = [
        { customRole: { contains: search, mode: 'insensitive' } },
        {
          staff: {
            person: {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
        {
          courseSeasonShift: {
            courseSeason: {
              course: {
                name: { contains: search, mode: 'insensitive' },
              },
            },
          },
        },
      ];
    }

    const [staffs, totalItems] = await Promise.all([
      this.prisma.courseSeasonStaff.findMany({
        where,
        take: per_page,
        skip,
        orderBy: { [sortField]: orderBy },
        select: courseSeasonStaffSelect,
      }),
      this.prisma.courseSeasonStaff.count({ where }),
    ]);

    return createPaginationResult(
      staffs,
      totalItems,
      page,
      per_page,
      this.i18n.t('messages.COURSE_STAFF_FETCHED'),
    );
  }

  async getAvailableStaff(paginationDto: CourseSeasonStaffPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'asc',
      courseSeasonShiftId,
    } = paginationDto;
    const skip = (page - 1) * per_page;

    const where: Prisma.StaffWhereInput = {
      isActive: true,
      ...(courseSeasonShiftId
        ? {
            courseSeasonStaffs: {
              none: { courseSeasonShiftId },
            },
          }
        : {}),
      ...(search
        ? {
            person: {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { secondLastName: { contains: search, mode: 'insensitive' } },
                { documentNumber: { contains: search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [staffs, totalItems] = await Promise.all([
      this.prisma.staff.findMany({
        where,
        take: per_page,
        skip,
        orderBy: { person: { name: orderBy as any } },
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
              imageUrl: true,
            },
          },
        },
      }),
      this.prisma.staff.count({ where }),
    ]);

    const mappedStaff = staffs.map((staff) => ({
      id: staff.id,
      personId: staff.person.id,
      name: staff.person.name,
      lastName: staff.person.lastName,
      secondLastName: staff.person.secondLastName,
      fullName: `${staff.person.lastName || ''} ${staff.person.secondLastName || ''} ${staff.person.name}`.replace(/\s+/g, ' ').trim(),
      documentNumber: staff.person.documentNumber,
      imageUrl: staff.person.imageUrl,
      isActive: staff.isActive,
    }));

    return createPaginationResult(
      mappedStaff,
      totalItems,
      page,
      per_page,
      this.i18n.t('messages.STAFF_FETCHED'),
    );
  }

  async findOne(id: string) {
    const staffAssoc = await this.prisma.courseSeasonStaff.findUnique({
      where: { id },
      select: courseSeasonStaffSelect,
    });
    if (!staffAssoc) {
      throw new NotFoundException(this.i18n.t('errors.COURSE_STAFF_NOT_FOUND'));
    }
    return {
      message: this.i18n.t('messages.COURSE_STAFF_FETCHED'),
      data: staffAssoc,
    };
  }

  async update(
    id: string,
    updateCourseSeasonStaffDto: UpdateCourseSeasonStaffDto,
  ) {
    const staffAssoc = await this.prisma.courseSeasonStaff.findUnique({
      where: { id },
    });
    if (!staffAssoc) {
      throw new NotFoundException(this.i18n.t('errors.COURSE_STAFF_NOT_FOUND'));
    }

    const { courseSeasonShiftId, isPrimary } = updateCourseSeasonStaffDto;
    const finalCourseSeasonShiftId = courseSeasonShiftId || staffAssoc.courseSeasonShiftId;

    const updatedStaffAssoc = await this.prisma.$transaction(async (tx) => {
      // Si se actualiza a primario, limpiar los otros
      if (isPrimary === true) {
        await tx.courseSeasonStaff.updateMany({
          where: { courseSeasonShiftId: finalCourseSeasonShiftId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      return await tx.courseSeasonStaff.update({
        where: { id },
        data: updateCourseSeasonStaffDto,
        select: courseSeasonStaffSelect,
      });
    });

    return {
      message: this.i18n.t('messages.COURSE_STAFF_UPDATED'),
      data: updatedStaffAssoc,
    };
  }

  async remove(id: string) {
    const staffAssoc = await this.prisma.courseSeasonStaff.findUnique({
      where: { id },
    });
    if (!staffAssoc) {
      throw new NotFoundException(this.i18n.t('errors.COURSE_STAFF_NOT_FOUND'));
    }

    const deletedStaffAssoc = await this.prisma.courseSeasonStaff.delete({
      where: { id },
      select: courseSeasonStaffSelect,
    });

    return {
      message: this.i18n.t('messages.COURSE_STAFF_DELETED'),
      data: deletedStaffAssoc,
    };
  }
}
