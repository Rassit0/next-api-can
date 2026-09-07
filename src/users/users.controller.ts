import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersPaginationDto } from './dto/pagination.dto';
import {
  ApiStandardResponse,
  ApiStandardCreatedResponse,
  ApiPaginatedResponse,
} from '../common/decorators/api-responses.decorator';
import { UserResponseDto } from '../common/dto/responses/entities.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRoleGuard } from '../auth/guards/user-role/user-role.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@ApiTags('Users')
@Controller('users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), UserRoleGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({
    summary: 'Registrar un nuevo usuario',
    description:
      'Crea las credenciales de acceso para un correo asignando un rol y vinculando opcionalmente un perfil de persona.',
  })
  @ApiStandardCreatedResponse(
    UserResponseDto,
    'Usuario creado exitosamente. Retorna la contraseña temporal en data.tempPassword.',
  )
  @RequirePermissions('CREATE_USERS')
  async create(@Body() createUserDto: CreateUserDto, @Req() req: any) {
    return await this.usersService.create(createUserDto, req.user);
  }


  @Get()
  @ApiOperation({
    summary: 'Obtener lista de usuarios',
    description:
      'Retorna una lista paginada y filtrable de todos los usuarios registrados en la plataforma.',
  })
  @ApiPaginatedResponse(
    UserResponseDto,
    'Lista de usuarios obtenida correctamente.',
  )
  @RequirePermissions('READ_USERS')
  async findAll(@Query() paginationDto: UsersPaginationDto) {
    return await this.usersService.findAll(paginationDto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtener un usuario por ID',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiStandardResponse(UserResponseDto, 'Usuario encontrado exitosamente.')
  @RequirePermissions('READ_USERS')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return await this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar un usuario específico',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateUserDto })
  @ApiStandardResponse(UserResponseDto, 'Usuario actualizado exitosamente.')
  @RequirePermissions('UPDATE_USERS')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Req() req: any,
  ) {
    return await this.usersService.update(id, updateUserDto, req.user);
  }

  @Patch(':id/deactivate')
  @ApiOperation({
    summary: 'Desactivar un usuario',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiStandardResponse(UserResponseDto, 'Usuario desactivado exitosamente.')
  @RequirePermissions('DEACTIVATE_USERS')
  async deactivate(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return await this.usersService.deactivate(id, req.user);
  }

  @Patch(':id/reactivate')
  @ApiOperation({
    summary: 'Reactivar un usuario',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiStandardResponse(UserResponseDto, 'Usuario reactivado exitosamente.')
  @RequirePermissions('DEACTIVATE_USERS')
  async reactivate(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return await this.usersService.reactivate(id, req.user);
  }
}
