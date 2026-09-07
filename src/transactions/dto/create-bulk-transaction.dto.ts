import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from 'src/generated/prisma/client';
import { Exists } from 'src/common/validators/decorators/exists.decorator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { SplitTransactionDto } from './create-transaction.dto';

export class BulkChargeItemDto {
  @ApiProperty({ description: 'ID del cargo a pagar completamente' })
  @IsUUID('4', {
    message: i18nValidationMessage('validation.IS_UUID', {
      constraint1: 'chargeId',
    }),
  })
  @Exists('charge', 'id')
  chargeId: string;

  @ApiPropertyOptional({
    type: [SplitTransactionDto],
    description: 'Distribución de pagos específica para este cargo. Si se provee, ignora la distribución global.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SplitTransactionDto)
  splitTransactions?: SplitTransactionDto[];
}

export class CreateBulkTransactionDto {
  @ApiPropertyOptional({
    description: 'ID de la persona que realiza el pago (opcional)',
  })
  @IsOptional()
  @IsUUID('4', {
    message: i18nValidationMessage('validation.IS_UUID', {
      constraint1: 'payerPersonId',
    }),
  })
  @Exists('person', 'id')
  payerPersonId?: string;

  @ApiProperty({
    type: [BulkChargeItemDto],
    description: 'Lista de cargos a pagar. Se aplicará el saldo pendiente total a cada uno.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkChargeItemDto)
  charges: BulkChargeItemDto[];

  @ApiPropertyOptional({
    description: 'Importe total que el operador declara estar cobrando. Opcional si se envían splits detallados.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  totalAmount?: number;

  @ApiPropertyOptional({
    enum: PaymentMethod,
    description: 'Método de pago a aplicar por defecto',
  })
  @IsOptional()
  @IsEnum(PaymentMethod, {
    message: i18nValidationMessage('validation.IS_ENUM', {
      constraint1: 'paymentMethod',
    }),
  })
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    description: 'ID de la cuenta financiera a la que ingresará el dinero por defecto',
  })
  @IsOptional()
  @IsUUID('4', {
    message: i18nValidationMessage('validation.IS_UUID', {
      constraint1: 'financialAccountId',
    }),
  })
  @Exists('financialAccount', 'id')
  financialAccountId?: string;

  @ApiPropertyOptional({
    description: 'Número de referencia bancaria o comprobante',
  })
  @IsOptional()
  @IsString({
    message: i18nValidationMessage('validation.IS_STRING', {
      constraint1: 'reference',
    }),
  })
  reference?: string;

  @ApiPropertyOptional({
    description: 'Notas adicionales internas',
  })
  @IsOptional()
  @IsString({
    message: i18nValidationMessage('validation.IS_STRING', {
      constraint1: 'notes',
    }),
  })
  notes?: string;

  @ApiPropertyOptional({
    description: 'Fecha de la transacción',
  })
  @IsOptional()
  @IsISO8601()
  transactionDate?: string;
}
