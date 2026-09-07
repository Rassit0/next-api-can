import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateTeamSeasonStaffDto } from './dto/create-team-season-staff.dto';
import { UpdateTeamSeasonStaffDto } from './dto/update-team-season-staff.dto';
import { PrismaService } from 'src/prisma.service';
import { Prisma } from 'src/generated/prisma/client';
import { TeamSeasonStaffPaginationDto } from './dto/pagination.dto';

export const teamSeasonStaffSelect: Prisma.TeamSeasonStaffSelect = {
  id: true,
  teamSeasonCategoryId: true,
  staffId: true,
  role: true,
  customRole: true,
  startedAt: true,
  endedAt: true,
  isPrimary: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  staff: {
    select: {
      person: {
        select: {
          id: true,
          name: true,
          lastName: true,
          imageUrl: true,
        },
      },
    },
  },
};

import { I18nService } from 'nestjs-i18n';

@Injectable()
export class TeamSeasonStaffService {
  private readonly logger = new Logger('TeamSeasonStaffService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async create(createTeamSeasonStaffDto: CreateTeamSeasonStaffDto) {
    const { teamSeasonCategoryId, ...rest } = createTeamSeasonStaffDto;
    
    const newSeason = await this.prisma.teamSeasonStaff.create({
      data: {
        ...rest,
        teamSeasonCategoryId,
      },
      select: teamSeasonStaffSelect,
    });

    return {
      message: this.i18n.t('messages.TEAM_STAFF_CREATED'),
      data: newSeason,
    };
  }

  async findAll(paginationDto: TeamSeasonStaffPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'asc',
      sortField = 'createdAt',
      staffId,
      teamSeasonId,
      role,
    } = paginationDto;
    // Calcular el offset para la paginación
    const skip = (page - 1) * per_page;

    const where: Prisma.TeamSeasonStaffWhereInput = {};

    if (teamSeasonId) {
      where.teamSeasonCategory = { teamSeasonId };
    }

    if (staffId) {
      where.staffId = staffId;
    }

    if (role) {
      where.role = role;
    }

    // Ejecutamos ambas consultas en paralelo para máxima velocidad
    const [teamSeasonStaffs, totalItems] = await Promise.all([
      this.prisma.teamSeasonStaff.findMany({
        where,
        take: per_page,
        skip,
        orderBy: { [sortField]: orderBy },
        select: teamSeasonStaffSelect,
      }),
      this.prisma.teamSeasonStaff.count({ where }),
    ]);

    // Lógica de metadatos
    const totalPages = Math.ceil(totalItems / per_page);

    // Si el usuario pide un page que no existe, Prisma ya puso [] en 'disciplines'.
    // Calculamos la página actual basándonos en el page solicitado.
    const currentPage = totalItems === 0 ? 0 : Math.floor(page / per_page) + 1;

    return {
      message: this.i18n.t('messages.TEAM_STAFF_FETCHED'),
      data: teamSeasonStaffs, // Será [] si la página no existe o no hay registros
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

  async getAvailableStaff(paginationDto: TeamSeasonStaffPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'asc',
      teamSeasonId,
    } = paginationDto;
    const skip = (page - 1) * per_page;

    const where: Prisma.StaffWhereInput = {
      isActive: true,
      ...(teamSeasonId
        ? {
            teamSeasonStaffs: {
              none: { teamSeasonCategory: { teamSeasonId } },
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
        orderBy: [
          { person: { lastName: orderBy as any } },
          { person: { secondLastName: orderBy as any } },
          { person: { name: orderBy as any } },
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
              imageUrl: true,
            },
          },
        },
      }),
      this.prisma.staff.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / per_page);
    const currentPage = totalItems === 0 ? 0 : Math.floor(page / per_page) + 1;

    return {
      message: this.i18n.t('messages.STAFF_FETCHED'),
      data: staffs.map((staff) => ({
        id: staff.id,
        personId: staff.person.id,
        name: staff.person.name,
        lastName: staff.person.lastName,
        secondLastName: staff.person.secondLastName,
        fullName: `${staff.person.lastName || ''} ${staff.person.secondLastName || ''} ${staff.person.name}`.replace(/\s+/g, ' ').trim(),
        documentNumber: staff.person.documentNumber,
        imageUrl: staff.person.imageUrl,
        isActive: staff.isActive,
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

  async findOne(id: string) {
    const teamSeasonStaff = await this.prisma.teamSeasonStaff.findUnique({
      where: { id },
      select: teamSeasonStaffSelect,
    });
    if (!teamSeasonStaff) {
      throw new NotFoundException(this.i18n.t('errors.TEAM_STAFF_NOT_FOUND'));
    }
    return {
      data: teamSeasonStaff,
      message: this.i18n.t('messages.TEAM_STAFF_FETCHED'),
    };
  }

  async update(id: string, updateTeamSeasonStaffDto: UpdateTeamSeasonStaffDto) {
    const teamSeasonStaff = await this.prisma.teamSeasonStaff.findUnique({
      where: { id },
      select: teamSeasonStaffSelect,
    });
    if (!teamSeasonStaff) {
      throw new NotFoundException(this.i18n.t('errors.TEAM_STAFF_NOT_FOUND'));
    }
    const { teamSeasonCategoryId, ...rest } = updateTeamSeasonStaffDto;
    let categoryData = {};
    if (teamSeasonCategoryId) {
      categoryData = {
        teamSeasonCategoryId,
      };
    }

    const updatedTeamSeasonStaff = await this.prisma.teamSeasonStaff.update({
      where: { id },
      data: {
        ...rest,
        ...categoryData,
      },
      select: teamSeasonStaffSelect,
    });
    return {
      message: this.i18n.t('messages.TEAM_STAFF_UPDATED'),
      data: updatedTeamSeasonStaff,
    };
  }

  async remove(id: string) {
    const teamSeasonStaff = await this.prisma.teamSeasonStaff.findUnique({
      where: { id },
      select: teamSeasonStaffSelect,
    });
    if (!teamSeasonStaff) {
      throw new NotFoundException(this.i18n.t('errors.TEAM_STAFF_NOT_FOUND'));
    }
    const deletedTeamSeasonStaff = await this.prisma.teamSeasonStaff.delete({
      where: { id },
      select: teamSeasonStaffSelect,
    });
    return {
      message: this.i18n.t('messages.TEAM_STAFF_DELETED'),
      data: deletedTeamSeasonStaff,
    };
  }
}
