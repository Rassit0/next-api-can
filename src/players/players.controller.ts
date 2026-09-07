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
import { PlayersService } from './players.service';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { PlayerPaginationDto } from './dto/pagination.dto';
import { PaginationDto } from 'src/common/dto/pagination';
import { FormDataRequest } from 'nestjs-form-data';
import {
  ApiStandardResponse,
  ApiStandardCreatedResponse,
  ApiPaginatedResponse,
} from '../common/decorators/api-responses.decorator';
import { PlayerResponseDto } from '../common/dto/responses/entities.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRoleGuard } from '../auth/guards/user-role/user-role.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@ApiTags('Players')
@Controller('players')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), UserRoleGuard)
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Post()
  @ApiOperation({
    summary: 'Registrar un jugador',
    description: 'Vincula una persona existente como jugador activo del club.',
  })
  @ApiStandardCreatedResponse(
    PlayerResponseDto,
    'Jugador registrado exitosamente.',
  )
  @RequirePermissions('CREATE_PLAYERS')
  async create(@Body() createPlayerDto: CreatePlayerDto) {
    return await this.playersService.create(createPlayerDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar jugadores',
    description:
      'Retorna una lista paginada y filtrable de todos los jugadores del club.',
  })
  @ApiPaginatedResponse(
    PlayerResponseDto,
    'Lista de jugadores obtenida correctamente.',
  )
  @RequirePermissions('READ_PLAYERS')
  async findAll(@Query() paginationDto: PlayerPaginationDto) {
    return await this.playersService.findAll(paginationDto);
  }



  @Get(':id')
  @ApiOperation({
    summary: 'Obtener jugador por ID',
    description:
      'Busca y retorna la información personal y deportiva del jugador por su ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del jugador (UUID)',
    format: 'uuid',
  })
  @ApiStandardResponse(PlayerResponseDto, 'Jugador encontrado exitosamente.')
  @RequirePermissions('READ_PLAYERS')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return await this.playersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar jugador por ID',
    description:
      'Modifica detalles de vinculación o ficha del jugador por su ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del jugador a actualizar (UUID)',
    format: 'uuid',
  })
  @ApiBody({ type: UpdatePlayerDto })
  @FormDataRequest()
  @ApiStandardResponse(
    PlayerResponseDto,
    'Ficha de jugador actualizada exitosamente.',
  )
  @RequirePermissions('UPDATE_PLAYERS')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePlayerDto: UpdatePlayerDto,
  ) {
    return await this.playersService.update(id, updatePlayerDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar jugador por ID',
    description: 'Desvincula permanentemente al jugador del club.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del jugador a eliminar (UUID)',
    format: 'uuid',
  })
  @ApiStandardResponse(PlayerResponseDto, 'Jugador desvinculado exitosamente.')
  @RequirePermissions('DELETE_PLAYERS')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return await this.playersService.remove(id);
  }
}
