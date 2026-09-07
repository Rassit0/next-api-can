import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { CreatePersonContactDto, UpdatePersonContactDto } from './dto/person-contact.dto';
import { PrismaService } from 'src/prisma.service';
import { Prisma } from 'src/generated/prisma/client';
import { PersonPaginationDto } from './dto/pagination.dto';
import { PersonsOptionsPaginationDto, ExcludeRole } from './dto/persons-options-pagination.dto';

export const PersonSelect: Prisma.PersonSelect = {
  id: true,
  name: true,
  lastName: true,
  secondLastName: true,
  imageUrl: true,
  address: true,
  phone: true,
  email: true,
  gender: true,
  birthDate: true,
  documentNumber: true,
  documentType: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class PersonsService {
  private readonly logger = new Logger('PersonsService');

  constructor(private readonly prisma: PrismaService) {}

  async create(createPersonDto: CreatePersonDto) {
    const { imageUrl, ...personData } = createPersonDto;
    const newPerson = await this.prisma.person.create({
      data: { ...personData },
      // Esto es lo que hace "la magia" de devolver los datos relacionados
      include: {},
    });

    return {
      message: 'Persona agregada exitosamente',
      data: newPerson,
    };
  }

  async findAll(paginationDto: PersonPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'asc',
      sortField = 'name',
    } = paginationDto;
    // Calcular el offset para la paginación
    const skip = (page - 1) * per_page;

    const where: Prisma.PersonWhereInput = search
      ? {
          OR: [
            // ({ id: { equals: Number(search) } }),
            { name: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { secondLastName: { contains: search, mode: 'insensitive' } },
            { documentNumber: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    // Ejecutamos ambas consultas en paralelo para máxima velocidad
    const [persons, totalItems] = await Promise.all([
      this.prisma.person.findMany({
        where,
        take: per_page,
        skip,
        orderBy: { [sortField]: orderBy },
        select: PersonSelect,
      }),
      this.prisma.person.count({ where }),
    ]);

    // Lógica de metadatos
    const totalPages = Math.ceil(totalItems / per_page);

    // Si el usuario pide un page que no existe, Prisma ya puso [] en 'disciplines'.
    // Calculamos la página actual basándonos en el page solicitado.
    const currentPage = totalItems === 0 ? 0 : Math.floor(page / per_page) + 1;

    return {
      data: persons, // Será [] si la página no existe o no hay registros
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

  async getPersonOptions(paginationDto: PersonsOptionsPaginationDto) {
    const {
      per_page = 10,
      page = 1,
      search,
      orderBy = 'asc',
      gender,
      excludeRole,
    } = paginationDto;
    const skip = (page - 1) * per_page;

    const searchTerms = search ? search.trim().split(/\s+/) : [];

    const where: Prisma.PersonWhereInput = {
      ...(searchTerms.length > 0
        ? {
            AND: searchTerms.map((term) => ({
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
                { secondLastName: { contains: term, mode: 'insensitive' } },
                { documentNumber: { contains: term, mode: 'insensitive' } },
              ],
            })),
          }
        : {}),
      ...(gender && { gender }),
    };

    if (excludeRole) {
      if (excludeRole === ExcludeRole.PLAYER) where.players = null;
      if (excludeRole === ExcludeRole.STUDENT) where.students = null;
      if (excludeRole === ExcludeRole.STAFF) where.staff = null;
      if (excludeRole === ExcludeRole.USER) where.user = null;
    }

    const [persons, totalItems] = await Promise.all([
      this.prisma.person.findMany({
        where,
        take: per_page,
        skip,
        orderBy: [
          { lastName: orderBy }, 
          { secondLastName: orderBy }, 
          { name: orderBy }, 
          { id: 'asc' }
        ],
        select: {
          id: true,
          name: true,
          lastName: true,
          secondLastName: true,
          documentType: true,
          documentNumber: true,
          gender: true,
          birthDate: true,
          imageUrl: true,
        },
      }),
      this.prisma.person.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / per_page);
    const currentPage = totalItems === 0 ? 0 : page;

    return {
      message: 'Personas obtenidas exitosamente',
      data: persons.map((person) => ({
        ...person,
        fullName: `${person.lastName || ''} ${person.secondLastName || ''} ${person.name}`.replace(/\s+/g, ' ').trim(),
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
    const person = await this.prisma.person.findUnique({
      where: { id },
      select: PersonSelect,
    });

    if (!person) {
      throw new NotFoundException('La persona no fue encontrada');
    }
    return { data: person, message: 'Persona encontrada exitosamente' };
  }

  async update(id: string, updatePersonDto: UpdatePersonDto) {
    const { imageUrl, ...personData } = updatePersonDto;
    const newPerson = await this.prisma.person.update({
      where: { id },
      data: { ...personData },
      select: PersonSelect,
    });

    return {
      message: 'Persona actualizada exitosamente',
      data: newPerson,
    };
  }

  async getSecretarySummary(personId: string) {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      include: {
        players: true,
        students: true,
      },
    });

    if (!person) {
      throw new NotFoundException('La persona no fue encontrada');
    }

    const [playerMemberships, studentMemberships, charges] = await Promise.all([
      // 1. Active Player Memberships
      person.players?.id
        ? this.prisma.playerMembership.findMany({
            where: {
              playerId: person.players.id,
              status: { notIn: ['WITHDRAWN', 'FINISHED'] },
            },
            include: {
              teamSeasonCategories: {
                include: {
                  teamSeason: {
                    include: { team: true },
                  },
                  category: {
                    include: { discipline: true },
                  },
                },
              },
            },
            orderBy: { startedAt: 'desc' },
          })
        : Promise.resolve([]),

      // 2. Active Student Memberships
      person.students?.id
        ? this.prisma.studentMembership.findMany({
            where: {
              studentId: person.students.id,
              status: { notIn: ['WITHDRAWN', 'FINISHED'] },
            },
            include: {
              courseSeason: {
                include: {
                  course: true,
                  season: {
                    include: { institution: true },
                  },
                },
              },
              courseSeasonShift: {
                include: {
                  shift: true,
                },
              },
            },
            orderBy: { startedAt: 'desc' },
          })
        : Promise.resolve([]),

      // 3. Pending Charges
      this.prisma.charge.findMany({
        where: {
          pendingAmount: { gt: 0 },
          status: { not: 'CANCELLED' },
          OR: [
            {
              accountCharge: {
                personId,
              },
            },
            {
              membershipCharges: {
                some: {
                  playerMembership: {
                    player: {
                      personId,
                    },
                  },
                },
              },
            },
            {
              studentCharges: {
                some: {
                  studentMembership: {
                    student: {
                      personId,
                    },
                  },
                },
              },
            },
          ],
        },
        include: {
          accountCharge: {
            include: { category: true },
          },
          membershipCharges: {
            include: {
              playerMembership: {
                include: {
                  teamSeasonCategories: {
                    include: {
                      teamSeason: { include: { team: true } },
                      category: { include: { discipline: true } },
                    },
                  },
                },
              },
            },
          },
          studentCharges: {
            include: {
              studentMembership: {
                include: {
                  courseSeason: {
                    include: { course: true },
                  },
                },
              },
            },
          },
          payments: {
            select: { amount: true, status: true },
          },
        },
        orderBy: { dueDate: 'asc' },
      }),
    ]);

    return {
      message: 'Resumen de secretaría obtenido exitosamente',
      data: {
        profile: {
          id: person.id,
          name: person.name,
          lastName: person.lastName,
          secondLastName: person.secondLastName,
          documentNumber: person.documentNumber,
          phone: person.phone,
          email: person.email,
          imageUrl: person.imageUrl,
          playerId: person.players?.id,
          studentId: person.students?.id,
        },
        playerMemberships: playerMemberships.map((pm) => ({
          id: pm.id,
          disciplineName: pm.teamSeasonCategories.category.discipline.name,
          categoryName: pm.teamSeasonCategories.category.name,
          teamName: pm.teamSeasonCategories.teamSeason.team.name,
          status: pm.status,
          startedAt: pm.startedAt,
        })),
        studentMemberships: studentMemberships.map((sm) => {
          return {
            id: sm.id,
            courseName: sm.courseSeason.course.name,
            institutionName: sm.courseSeason.season.institution.name,
            status: sm.status,
            startedAt: sm.startedAt,
            shiftName: sm.courseSeasonShift?.shift?.name ?? null,
            shiftStartTime: null,
            shiftEndTime: null,
          };
        }),
        pendingCharges: charges.map((charge) => {
          let type = 'ACCOUNT';
          let originName = 'Cobro Manual';

          if (charge.membershipCharges.length > 0) {
            type = 'MEMBERSHIP';
            const pm = charge.membershipCharges[0].playerMembership;
            originName = `${pm.teamSeasonCategories.teamSeason.team.name} - ${pm.teamSeasonCategories.category.name}`;
          } else if (charge.studentCharges.length > 0) {
            type = 'STUDENT';
            const sm = charge.studentCharges[0].studentMembership;
            originName = sm.courseSeason.course.name;
          } else if (charge.accountCharge) {
            originName =
              charge.accountCharge.category?.name ||
              charge.accountCharge.title ||
              'Cobro Manual';
          }

          return {
            id: charge.id,
            description: charge.description,
            amount: Number(charge.amount),
            pendingAmount: Number(charge.pendingAmount),
            adjustmentAmount: Number(charge.adjustmentAmount),
            adjustmentReason: charge.adjustmentReason,
            dueDate: charge.dueDate,
            status: charge.status,
            type,
            originName,
            membershipCharges: charge.membershipCharges.map(mc => ({ type: mc.type })),
            studentCharges: charge.studentCharges.map(sc => ({ type: sc.type })),
            payments: charge.payments,
          };
        }),
      },
    };
  }

  remove(id: string) {
    return `This action removes a #${id} person`;
  }

  // ==========================================
  // PERSON CONTACTS (Familia / Relaciones)
  // ==========================================

  async getContacts(personId: string) {
    // Verificar que la persona existe
    const person = await this.prisma.person.findUnique({ where: { id: personId } });
    if (!person) {
      throw new NotFoundException('La persona no existe');
    }

    const contacts = await this.prisma.personContact.findMany({
      where: { personId },
      include: {
        contactPerson: {
          select: {
            id: true,
            name: true,
            lastName: true,
            imageUrl: true,
            email: true,
            phone: true,
            documentType: true,
            documentNumber: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return {
      message: 'Contactos obtenidos exitosamente',
      data: contacts,
    };
  }

  async addContact(personId: string, dto: CreatePersonContactDto) {
    if (personId === dto.contactPersonId) {
      throw new BadRequestException('Una persona no puede ser contacto de sí misma');
    }

    // Verificar existencia de ambas personas de forma concurrente
    const [person, contactPerson] = await Promise.all([
      this.prisma.person.findUnique({ where: { id: personId } }),
      this.prisma.person.findUnique({ where: { id: dto.contactPersonId } })
    ]);

    if (!person) throw new NotFoundException('La persona propietaria no existe');
    if (!contactPerson) throw new NotFoundException('La persona a asignar como contacto no existe');

    try {
      const newContact = await this.prisma.personContact.create({
        data: {
          personId,
          contactPersonId: dto.contactPersonId,
          relationship: dto.relationship,
          isEmergencyContact: dto.isEmergencyContact,
          isBillingContact: dto.isBillingContact,
        },
        include: {
          contactPerson: {
            select: { id: true, name: true, lastName: true, imageUrl: true }
          }
        }
      });

      return {
        message: 'Contacto agregado exitosamente',
        data: newContact,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Esta persona ya está registrada como contacto');
      }
      throw new InternalServerErrorException('Error al registrar contacto');
    }
  }

  async updateContact(personId: string, contactPersonId: string, dto: UpdatePersonContactDto) {
    const existing = await this.prisma.personContact.findUnique({
      where: {
        personId_contactPersonId: { personId, contactPersonId }
      }
    });

    if (!existing) {
      throw new NotFoundException('La relación de contacto no existe');
    }

    const updated = await this.prisma.personContact.update({
      where: {
        personId_contactPersonId: { personId, contactPersonId }
      },
      data: {
        relationship: dto.relationship,
        isEmergencyContact: dto.isEmergencyContact,
        isBillingContact: dto.isBillingContact,
      },
      include: {
        contactPerson: {
          select: { id: true, name: true, lastName: true, imageUrl: true }
        }
      }
    });

    return {
      message: 'Contacto actualizado exitosamente',
      data: updated,
    };
  }

  async removeContact(personId: string, contactPersonId: string) {
    const existing = await this.prisma.personContact.findUnique({
      where: {
        personId_contactPersonId: { personId, contactPersonId }
      }
    });

    if (!existing) {
      throw new NotFoundException('La relación de contacto no existe');
    }

    await this.prisma.personContact.delete({
      where: {
        personId_contactPersonId: { personId, contactPersonId }
      }
    });

    return {
      message: 'Contacto eliminado exitosamente',
      data: null,
    };
  }
}
