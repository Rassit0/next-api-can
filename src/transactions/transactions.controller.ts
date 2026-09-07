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
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionsPaginationDto } from './dto/pagination.dto';
import { CreateBulkTransactionDto } from './dto/create-bulk-transaction.dto';
import {
  ApiStandardResponse,
  ApiStandardCreatedResponse,
  ApiPaginatedResponse,
} from '../common/decorators/api-responses.decorator';

import { AuthGuard } from '@nestjs/passport';
import { UserRoleGuard } from '../auth/guards/user-role/user-role.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@ApiTags('Transactions')
@Controller('transactions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), UserRoleGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @ApiOperation({
    summary: 'Registrar una nueva transacción',
    description:
      'Registra un ingreso o egreso. Si es código QR, devuelve la data necesaria para dibujarlo. Si se envían cargos a aplicar, se procesan automáticamente.',
  })
  // Usamos Object genérico temporalmente hasta definir un ResponseDto estricto, o puedes crear un TransactionResponseDto
  @ApiStandardCreatedResponse(Object, 'Transacción procesada correctamente.')
  @RequirePermissions('CREATE_TRANSACTIONS')
  async create(@Body() createTransactionDto: CreateTransactionDto) {
    return await this.transactionsService.create(createTransactionDto);
  }

  @Post('bulk')
  @ApiOperation({
    summary: 'Registrar pagos masivos (bulk) sobre múltiples cargos',
    description:
      'Registra el pago de múltiples cargos de manera atómica. Valida los saldos pendientes y genera los respectivos pagos y transacciones para cada cargo.',
  })
  @ApiStandardCreatedResponse(Object, 'Transacciones procesadas correctamente.')
  @RequirePermissions('CREATE_TRANSACTIONS')
  async createBulk(@Body() createBulkTransactionDto: CreateBulkTransactionDto) {
    return await this.transactionsService.createBulk(createBulkTransactionDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Obtener lista paginada de transacciones',
    description:
      'Retorna una lista paginada y filtrable de todas las transacciones realizadas.',
  })
  @ApiPaginatedResponse(
    Object,
    'Lista de transacciones obtenida correctamente.',
  )
  @RequirePermissions('READ_TRANSACTIONS')
  async findAll(@Query() paginationDto: TransactionsPaginationDto) {
    return await this.transactionsService.findAll(paginationDto);
  }

  @Get('payment-methods')
  @ApiOperation({
    summary: 'Listar métodos de pago soportados',
    description: 'Retorna una lista con todos los métodos de pago aceptados.',
  })
  @RequirePermissions('READ_TRANSACTIONS')
  getPaymentMethods() {
    return this.transactionsService.getPaymentMethods();
  }



  @Get(':id')
  @ApiOperation({
    summary: 'Obtener detalles de una transacción por ID',
    description:
      'Busca y retorna los metadatos de una transacción específica, incluyendo sus pagos aplicados a cargos.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la transacción (UUID)',
    format: 'uuid',
  })
  @ApiStandardResponse(Object, 'Transacción encontrada exitosamente.')
  @RequirePermissions('READ_TRANSACTIONS')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return await this.transactionsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar notas o referencia de una transacción',
    description: 'Actualiza los campos editables de una transacción.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la transacción a actualizar (UUID)',
    format: 'uuid',
  })
  @ApiBody({ type: UpdateTransactionDto })
  @ApiStandardResponse(Object, 'Transacción actualizada exitosamente.')
  @RequirePermissions('UPDATE_TRANSACTIONS')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTransactionDto: UpdateTransactionDto,
  ) {
    return await this.transactionsService.update(id, updateTransactionDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar / Anular una transacción',
    description:
      'Elimina físicamente una transacción y devuelve (reversa) el saldo aplicado a los cargos asociados, devolviéndolos a su estado anterior.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la transacción a anular (UUID)',
    format: 'uuid',
  })
  @ApiStandardResponse(Object, 'Transacción anulada exitosamente.')
  @RequirePermissions('DELETE_TRANSACTIONS')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return await this.transactionsService.remove(id);
  }
}
