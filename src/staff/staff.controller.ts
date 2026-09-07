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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffPaginationDto } from './dto/pagination.dto';
import {
  ApiStandardResponse,
  ApiStandardCreatedResponse,
  ApiPaginatedResponse,
} from '../common/decorators/api-responses.decorator';
import { StaffResponseDto } from '../common/dto/responses/entities.dto';
import { PaginationDto } from 'src/common/dto/pagination';
import { AuthGuard } from '@nestjs/passport';
import { UserRoleGuard } from '../auth/guards/user-role/user-role.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@ApiTags('Staff')
@Controller('staff')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), UserRoleGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @ApiOperation({
    summary: 'Registrar un miembro del personal',
    description:
      'Crea la vinculación de personal (entrenador, auxiliar, etc.) a partir de un perfil de persona preexistente.',
  })
  @ApiStandardCreatedResponse(
    StaffResponseDto,
    'Miembro del personal registrado exitosamente.',
  )
  @RequirePermissions('CREATE_STAFF')
  async create(@Body() createStaffDto: CreateStaffDto) {
    return await this.staffService.create(createStaffDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar miembros del personal',
    description:
      'Retorna una lista paginada y filtrable de todos los entrenadores/auxiliares.',
  })
  @ApiPaginatedResponse(
    StaffResponseDto,
    'Lista del personal obtenida correctamente.',
  )
  @RequirePermissions('READ_STAFF')
  async findAll(@Query() paginationDto: StaffPaginationDto) {
    return this.staffService.findAll(paginationDto);
  }



  @Get(':id')
  @ApiOperation({
    summary: 'Obtener personal por ID',
    description:
      'Retorna los datos completos de perfil y vinculación del personal por su ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del personal (UUID)',
    format: 'uuid',
  })
  @ApiStandardResponse(
    StaffResponseDto,
    'Miembro del personal encontrado exitosamente.',
  )
  @RequirePermissions('READ_STAFF')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.staffService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar personal por ID',
    description: 'Modifica datos de ficha o vigencia del personal por su ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del personal a actualizar (UUID)',
    format: 'uuid',
  })
  @ApiBody({ type: UpdateStaffDto })
  @ApiStandardResponse(
    StaffResponseDto,
    'Miembro del personal actualizado exitosamente.',
  )
  @RequirePermissions('UPDATE_STAFF')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateStaffDto: UpdateStaffDto,
  ) {
    return await this.staffService.update(id, updateStaffDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar personal por ID',
    description: 'Remueve de forma definitiva el registro de personal.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del personal a eliminar (UUID)',
    format: 'uuid',
  })
  @ApiStandardResponse(
    StaffResponseDto,
    'Miembro del personal eliminado exitosamente.',
  )
  @RequirePermissions('DELETE_STAFF')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.staffService.remove(id);
  }
}
