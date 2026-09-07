import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { PrismaService } from 'src/prisma.service';
import { Prisma } from 'src/generated/prisma/client';
import { StudentsPaginationDto } from './dto/pagination.dto';
import { createPaginationResult } from 'src/common/helpers/pagination.helper';
import { PaginationDto } from 'src/common/dto/pagination';

export const studentSelect: Prisma.StudentSelect = {
  id: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  person: {
    select: {
      id: true,
      name: true,
      lastName: true,
      secondLastName: true,
      birthDate: true,
      email: true,
      phone: true,
      address: true,
      gender: true,
    },
  },
};

@Injectable()
export class StudentsService {
  private readonly logger = new Logger('StudentsService');

  constructor(private readonly prisma: PrismaService) {}

  async create(createStudentDto: CreateStudentDto) {
    const newStudent = await this.prisma.student.create({
      data: createStudentDto,
      select: studentSelect,
    });

    return {
      message: 'Estudiante creado exitosamente',
      data: newStudent,
    };
  }

  async findAll(paginationDto: StudentsPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'asc',
      sortField = 'name',
    } = paginationDto;
    const skip = (page - 1) * per_page;

    const where: Prisma.StudentWhereInput = search
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

    const [students, totalItems] = await Promise.all([
      this.prisma.student.findMany({
        where,
        take: per_page,
        skip,
        orderBy: {
          person: {
            [sortField]: orderBy,
          },
        },
        select: studentSelect,
      }),
      this.prisma.student.count({ where }),
    ]);

    return createPaginationResult(
      students,
      totalItems,
      page,
      per_page,
      'Estudiantes obtenidos exitosamente',
    );
  }

  async findOne(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      select: studentSelect,
    });
    if (!student) {
      throw new NotFoundException('errors.STUDENT_NOT_FOUND');
    }
    return {
      message: 'Estudiante obtenido exitosamente',
      data: student,
    };
  }

  async update(id: string, updateStudentDto: UpdateStudentDto) {
    const student = await this.prisma.student.findUnique({
      where: { id },
    });
    if (!student) {
      throw new NotFoundException('errors.STUDENT_NOT_FOUND');
    }

    const updatedStudent = await this.prisma.student.update({
      where: { id },
      data: updateStudentDto,
      select: studentSelect,
    });

    return {
      message: 'Estudiante actualizado exitosamente',
      data: updatedStudent,
    };
  }

  async remove(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
    });
    if (!student) {
      throw new NotFoundException('errors.STUDENT_NOT_FOUND');
    }

    const deletedStudent = await this.prisma.student.delete({
      where: { id },
      select: studentSelect,
    });

    return {
      message: 'Estudiante eliminado exitosamente',
      data: deletedStudent,
    };
  }


}
