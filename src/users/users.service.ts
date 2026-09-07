import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from 'src/prisma.service';
import { Prisma } from 'src/generated/prisma/client';
import { UsersPaginationDto } from './dto/pagination.dto';
import { createPaginationResult } from 'src/common/helpers/pagination.helper';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

export const userSelect: Prisma.UserSelect = {
  id: true,
  email: true,
  isActive: true,
  personId: true,
  roleId: true,
  createdAt: true,
  updatedAt: true,
  role: {
    select: {
      id: true,
      name: true,
      description: true,
      isSystem: true,
      isSuperAdmin: true,
    },
  },
  person: {
    select: {
      id: true,
      name: true,
      lastName: true,
      phone: true,
      email: true,
    },
  },
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger('UsersService');

  constructor(private readonly prisma: PrismaService) {}

  private hashPassword(password: string): string {
    return bcrypt.hashSync(password, 10);
  }

  async create(createUserDto: CreateUserDto, actor: any) {
    const { email, personId, roleId } = createUserDto;

    const exists = await this.prisma.user.findUnique({
      where: { email },
    });
    if (exists) {
      throw new BadRequestException('errors.EMAIL_ALREADY_EXISTS');
    }

    // Role verification
    const targetRole = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!targetRole) throw new NotFoundException('Role not found');
    
    // Check if non-superadmin is trying to assign a SuperAdmin role
    if (targetRole.isSuperAdmin && !actor?.role?.isSuperAdmin) {
      throw new ForbiddenException('No tienes permisos para asignar este rol');
    }

    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = this.hashPassword(tempPassword);

    const newUser = await this.prisma.user.create({
      data: {
        email,
        password: passwordHash,
        personId,
        roleId,
      },
      select: userSelect,
    });

    return {
      message: 'Usuario creado exitosamente',
      data: {
        ...newUser,
        tempPassword, // Return cleartext password only once
      },
    };
  }


  async findAll(paginationDto: UsersPaginationDto) {
    const { per_page = 10, page = 1, search, orderBy = 'asc', sortField = 'email' } = paginationDto;
    const skip = (page - 1) * per_page;

    const where: Prisma.UserWhereInput = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        {
          person: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
        {
          role: {
            name: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [users, totalItems] = await Promise.all([
      this.prisma.user.findMany({
        where,
        take: per_page,
        skip,
        orderBy: { [sortField]: orderBy },
        select: userSelect,
      }),
      this.prisma.user.count({ where }),
    ]);

    return createPaginationResult(users, totalItems, page, per_page, 'Usuarios obtenidos exitosamente');
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });
    if (!user) {
      throw new NotFoundException('errors.USER_NOT_FOUND');
    }
    return {
      message: 'Usuario obtenido exitosamente',
      data: user,
    };
  }

  async update(id: string, updateUserDto: UpdateUserDto, actor: any) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!user) throw new NotFoundException('errors.USER_NOT_FOUND');

    const { email, personId, roleId } = updateUserDto;

    // Self role change restriction
    if (roleId && roleId !== user.roleId) {
      if (id === actor.id) {
        throw new ForbiddenException('No puedes modificar tu propio rol');
      }

      // Check assignment permissions
      const targetRole = await this.prisma.role.findUnique({ where: { id: roleId } });
      if (!targetRole) throw new NotFoundException('Role not found');
      
      if (targetRole.isSuperAdmin && !actor?.role?.isSuperAdmin) {
        throw new ForbiddenException('No tienes permisos para asignar este rol');
      }
    }

    if (email && email !== user.email) {
      const emailExists = await this.prisma.user.findUnique({ where: { email } });
      if (emailExists) throw new BadRequestException('errors.EMAIL_ALREADY_EXISTS');
    }

    const data: Prisma.UserUpdateInput = { email };

    if (personId !== undefined) {
      if (personId === null) {
        data.person = { disconnect: true };
      } else {
        data.person = { connect: { id: personId } };
      }
    }

    if (roleId !== undefined) {
      data.role = { connect: { id: roleId } };
    }

    const isDowngradingSuperAdmin = roleId && roleId !== user.roleId && user.role.isSuperAdmin;

    let updatedUser;

    if (isDowngradingSuperAdmin) {
      updatedUser = await this.prisma.$transaction(
        async (tx) => {
          const activeSuperAdminsCount = await tx.user.count({
            where: {
              isActive: true,
              role: { isSuperAdmin: true },
              id: { not: id },
            },
          });

          if (activeSuperAdminsCount < 1) {
            throw new ForbiddenException(
              'Operación abortada: El sistema quedaría sin Super Administradores activos',
            );
          }

          return await tx.user.update({
            where: { id },
            data,
            select: userSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } else {
      updatedUser = await this.prisma.user.update({
        where: { id },
        data,
        select: userSelect,
      });
    }

    return {
      message: 'Usuario actualizado exitosamente',
      data: updatedUser,
    };
  }

  async deactivate(id: string, actor: any) {
    if (id === actor.id) {
      throw new ForbiddenException('No puedes desactivarte a ti mismo');
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!user) throw new NotFoundException('errors.USER_NOT_FOUND');

    let deactivatedUser;

    if (user.role.isSuperAdmin) {
      deactivatedUser = await this.prisma.$transaction(
        async (tx) => {
          const activeSuperAdminsCount = await tx.user.count({
            where: {
              isActive: true,
              role: { isSuperAdmin: true },
              id: { not: id },
            },
          });

          if (activeSuperAdminsCount < 1) {
            throw new ForbiddenException(
              'Operación abortada: El sistema quedaría sin Super Administradores activos',
            );
          }

          return await tx.user.update({
            where: { id },
            data: { isActive: false },
            select: userSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } else {
      deactivatedUser = await this.prisma.user.update({
        where: { id },
        data: { isActive: false },
        select: userSelect,
      });
    }

    return {
      message: 'Usuario desactivado exitosamente',
      data: deactivatedUser,
    };
  }

  async reactivate(id: string, actor: any) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });
    if (!user) throw new NotFoundException('errors.USER_NOT_FOUND');

    const reactivatedUser = await this.prisma.user.update({
      where: { id },
      data: { isActive: true },
      select: userSelect,
    });

    return {
      message: 'Usuario reactivado exitosamente',
      data: reactivatedUser,
    };
  }

  // checkLastSuperAdminProtection se eliminó a favor de transacciones atómicas directas
  async remove(id: string) {
    throw new BadRequestException('El borrado físico de usuarios no está permitido');
  }
}
