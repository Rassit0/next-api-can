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
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { StudentsPaginationDto } from './dto/pagination.dto';
import { FormDataRequest } from 'nestjs-form-data';
import {
  ApiStandardResponse,
  ApiStandardCreatedResponse,
  ApiPaginatedResponse,
} from '../common/decorators/api-responses.decorator';
import { StudentResponseDto } from '../common/dto/responses/entities.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRoleGuard } from '../auth/guards/user-role/user-role.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PaginationDto } from 'src/common/dto/pagination';

@ApiTags('Students')
@Controller('students')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), UserRoleGuard)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Registrar un nuevo estudiante',
    description:
      'Crea el perfil de un estudiante a partir de un perfil de persona preexistente.',
  })
  @ApiStandardCreatedResponse(
    StudentResponseDto,
    'Estudiante registrado exitosamente.',
  )
  @RequirePermissions('CREATE_STUDENTS')
  async create(@Body() createStudentDto: CreateStudentDto) {
    return await this.studentsService.create(createStudentDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Obtener lista de estudiantes',
    description:
      'Retorna una lista paginada y filtrable de todos los estudiantes registrados.',
  })
  @ApiPaginatedResponse(
    StudentResponseDto,
    'Lista de estudiantes obtenida correctamente.',
  )
  @RequirePermissions('READ_STUDENTS')
  async findAll(@Query() paginationDto: StudentsPaginationDto) {
    return await this.studentsService.findAll(paginationDto);
  }


  @Get(':id')
  @ApiOperation({
    summary: 'Obtener un estudiante por ID',
    description:
      'Busca y retorna la información personal completa y de vinculación de un estudiante por su ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del estudiante a consultar (UUID)',
    format: 'uuid',
  })
  @ApiStandardResponse(
    StudentResponseDto,
    'Estudiante encontrado exitosamente.',
  )
  @RequirePermissions('READ_STUDENTS')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return await this.studentsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar un estudiante específico',
    description:
      'Actualiza el estado de actividad o vinculación de persona de un estudiante por su ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del estudiante a actualizar (UUID)',
    format: 'uuid',
  })
  @ApiBody({ type: UpdateStudentDto })
  @FormDataRequest()
  @ApiStandardResponse(
    StudentResponseDto,
    'Estudiante actualizado exitosamente.',
  )
  @RequirePermissions('UPDATE_STUDENTS')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateStudentDto: UpdateStudentDto,
  ) {
    return await this.studentsService.update(id, updateStudentDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar un estudiante',
    description: 'Elimina de manera permanente la vinculación del estudiante.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del estudiante a eliminar (UUID)',
    format: 'uuid',
  })
  @ApiStandardResponse(StudentResponseDto, 'Estudiante eliminado con éxito.')
  @RequirePermissions('DELETE_STUDENTS')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return await this.studentsService.remove(id);
  }
}
