import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { PrismaService } from 'src/prisma.service';
import { Prisma } from 'src/generated/prisma/client';
import { StaffPaginationDto } from './dto/pagination.dto';
import { PaginationDto } from 'src/common/dto/pagination';

export const PersonSelect: Prisma.PersonSelect = {
  id: true,
  name: true,
  lastName: true,
  secondLastName: true,
  birthDate: true,
  imageUrl: true,
  documentType: true,
  documentNumber: true,
  phone: true,
  email: true,
  address: true,
  gender: true,
  createdAt: true,
  updatedAt: true,
};

export const StaffSelect: Prisma.StaffSelect = {
  id: true,
  person: {
    select: PersonSelect,
  },
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class StaffService {
  private readonly logger = new Logger('CategoriesService');

  constructor(private readonly prisma: PrismaService) {}
  async create(createStaffDto: CreateStaffDto) {
    const newStaff = await this.prisma.staff.create({
      data: createStaffDto,
      select: StaffSelect,
    });

    return {
      message: 'Personal creado exitosamente',
      data: newStaff,
    };
  }

  async findAll(paginationDto: StaffPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'asc',
      sortField = 'name',
    } = paginationDto;
    // Calcular el offset para la paginación
    const skip = (page - 1) * per_page;

    const where: Prisma.StaffWhereInput = search
      ? {
          OR: [
            { id: { equals: search } },
            { person: { name: { contains: search, mode: 'insensitive' } } },
            { person: { lastName: { contains: search, mode: 'insensitive' } } },
            {
              person: {
                secondLastName: { contains: search, mode: 'insensitive' },
              },
            },
            {
              person: {
                documentNumber: { contains: search, mode: 'insensitive' },
              },
            },
            { person: { phone: { contains: search, mode: 'insensitive' } } },
            { person: { email: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {};

    // Ejecutamos ambas consultas en paralelo para máxima velocidad
    const [staff, totalItems] = await Promise.all([
      this.prisma.staff.findMany({
        where,
        take: per_page,
        skip,
        orderBy: {
          person: {
            [sortField]: orderBy,
          },
        },
        select: StaffSelect,
      }),
      this.prisma.staff.count({ where }),
    ]);

    // Lógica de metadatos
    const totalPages = Math.ceil(totalItems / per_page);

    // Si el usuario pide un page que no existe, Prisma ya puso [] en 'disciplines'.
    // Calculamos la página actual basándonos en el page solicitado.
    const currentPage = totalItems === 0 ? 0 : Math.floor(page / per_page) + 1;

    return {
      message: 'Personal obtenido exitosamente',
      data: staff, // Será [] si la página no existe o no hay registros
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
    const staff = await this.prisma.staff.findUnique({
      where: {
        id,
      },
      select: StaffSelect,
    });
    if (!staff) {
      throw new NotFoundException('Personal no encontrado');
    }
    return {
      message: 'Personal obtenido exitosamente',
      data: staff,
    };
  }

  async update(id: string, updateStaffDto: UpdateStaffDto) {
    const staff = await this.prisma.staff.findUnique({
      where: {
        id,
      },
      select: StaffSelect,
    });
    if (!staff) {
      throw new NotFoundException('Personal no encontrado');
    }
    const updatedStaff = await this.prisma.staff.update({
      where: {
        id,
      },
      data: updateStaffDto,
      select: StaffSelect,
    });

    return {
      message: 'Personal actualizado exitosamente',
      data: updatedStaff,
    };
  }

  async remove(id: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id },
    });
    if (!staff) {
      throw new NotFoundException('El personal no fue encontrado');
    }
    const deletedStaff = await this.prisma.staff.delete({
      where: { id },
      select: StaffSelect,
    });
    return {
      message: 'Personal eliminado exitosamente',
      data: deletedStaff,
    };
  }

}
