import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AccountChargesService } from './account-charges.service';
import { CreateAccountChargeDto } from './dto/create-account-charge.dto';
import { UpdateAccountChargeDto } from './dto/update-account-charge.dto';
import { AccountChargesPaginationDto } from './dto/pagination.dto';

import { UserRoleGuard } from 'src/auth/guards/user-role/user-role.guard';
import { RequirePermissions } from 'src/auth/decorators/permissions.decorator';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ApiStandardResponse, ApiStandardCreatedResponse, ApiPaginatedResponse } from 'src/common/decorators/api-responses.decorator';
@ApiTags('Account Charges')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), UserRoleGuard)
@Controller('account-charges')
export class AccountChargesController {
  constructor(private readonly accountChargesService: AccountChargesService) {}

  @Post()
  @ApiOperation({ summary: 'Registrar un cargo/abono a cuenta', description: 'Crea un cargo o abono y registra sus transacciones relacionadas.' })
  @ApiStandardCreatedResponse(Object, 'Cargo/abono registrado exitosamente.')
  @RequirePermissions('CREATE_ACCOUNT_CHARGES')
  create(
    @Body() createAccountChargeDto: CreateAccountChargeDto,
    @Req() req: any,
  ) {
    return this.accountChargesService.create(createAccountChargeDto, req.user?.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar cargos y abonos', description: 'Obtiene una lista paginada de cargos/abonos con sus filtros.' })
  @ApiPaginatedResponse(Object, 'Cargos/abonos listados exitosamente.')
  @RequirePermissions('READ_ACCOUNT_CHARGES')
  findAll(@Query() paginationDto: AccountChargesPaginationDto) {
    return this.accountChargesService.findAll(paginationDto);
  }






  @Get(':id')
  @ApiOperation({ summary: 'Obtener un cargo/abono', description: 'Devuelve la información detallada de un cargo/abono.' })
  @ApiParam({ name: 'id', description: 'UUID del cargo/abono' })
  @ApiStandardResponse(Object, 'Cargo/abono obtenido exitosamente.')
  @RequirePermissions('READ_ACCOUNT_CHARGES')
  findOne(@Param('id') id: string) {
    return this.accountChargesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un cargo/abono', description: 'Actualiza los datos de un cargo/abono y ajusta saldos.' })
  @ApiParam({ name: 'id', description: 'UUID del cargo/abono' })
  @ApiStandardResponse(Object, 'Cargo/abono actualizado exitosamente.')
  @RequirePermissions('UPDATE_ACCOUNT_CHARGES')
  update(
    @Param('id') id: string,
    @Body() updateAccountChargeDto: UpdateAccountChargeDto,
    @Req() req: any,
  ) {
    return this.accountChargesService.update(id, updateAccountChargeDto, req.user?.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar/Anular un cargo/abono', description: 'Anula un cargo/abono y revierte las transacciones correspondientes.' })
  @ApiParam({ name: 'id', description: 'UUID del cargo/abono' })
  @ApiStandardResponse(Object, 'Cargo/abono anulado exitosamente.')
  @RequirePermissions('DELETE_ACCOUNT_CHARGES')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.accountChargesService.remove(id, req.user?.id);
  }
}
