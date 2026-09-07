import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { Exists } from 'src/common/validators/decorators/exists.decorator';
import { PaymentMethod, TransactionType } from 'src/generated/prisma/client';

export class SplitTransactionDto {
  @ApiProperty({ example: 100 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amount: number;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsUUID('4')
  @Exists('financialAccount', 'id')
  financialAccountId: string;
}

export class CreateTransactionDto {
  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'ID de la persona que realiza/recibe el pago',
  })
  @IsOptional()
  @IsUUID('4', {
    message: i18nValidationMessage('validation.IS_UUID', {
      constraint1: 'payerPersonId',
    }),
  })
  @Exists('person', 'id', {
    message: i18nValidationMessage('validation.NOT_EXISTS', {
      constraint1: 'payerPersonId',
    }),
  })
  payerPersonId?: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440001',
    description:
      'ID de la entidad/proveedor (ThirdParty) asociado a la transacción',
  })
  @IsOptional()
  @IsUUID('4', {
    message: i18nValidationMessage('validation.IS_UUID', {
      constraint1: 'thirdPartyId',
    }),
  })
  @Exists('thirdParty', 'id', {
    message: i18nValidationMessage('validation.NOT_EXISTS', {
      constraint1: 'thirdPartyId',
    }),
  })
  thirdPartyId?: string;

  @ApiPropertyOptional({
    example: 150.0,
    description:
      'Monto total de la transacción (requerido si no hay splitTransactions)',
  })
  @IsOptional()
  @IsNumber(
    {},
    {
      message: i18nValidationMessage('validation.IS_NUMBER', {
        constraint1: 'amount',
      }),
    },
  )
  @Min(0, {
    message: i18nValidationMessage('validation.MIN_VALUE', {
      constraint1: 'amount',
      constraint2: 0,
    }),
  })
  @Type(() => Number)
  amount: number;

  @ApiProperty({
    example: '2026-07-05T00:00:00.000Z',
    description: 'Fecha en que se realiza la transacción',
  })
  @IsOptional()
  @IsISO8601(
    { strict: true },
    {
      message: i18nValidationMessage('validation.IS_DATE', {
        constraint1: 'transactionDate',
      }),
    },
  )
  transactionDate?: string;

  @ApiPropertyOptional({
    example: 'Pago de mensualidad julio',
    description: 'Descripción breve de la transacción',
  })
  @IsOptional()
  @IsString({
    message: i18nValidationMessage('validation.IS_STRING', {
      constraint1: 'description',
    }),
  })
  description?: string;

  @ApiProperty({
    enum: TransactionType,
    example: TransactionType.INCOME,
    description: 'Tipo de transacción (INCOME, EXPENSE)',
  })
  @IsOptional()
  @IsEnum(TransactionType, {
    message: i18nValidationMessage('validation.IS_ENUM', {
      constraint1: 'type',
    }),
  })
  type: TransactionType;

  @ApiProperty({
    enum: PaymentMethod,
    example: PaymentMethod.CASH,
    description: 'Método de pago (QR, TRANSFER, CASH)',
  })
  @IsOptional()
  @IsEnum(PaymentMethod, {
    message: i18nValidationMessage('validation.IS_ENUM', {
      constraint1: 'paymentMethod',
    }),
  })
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({
    example: '123456789',
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
    example: 'El apoderado pagó en efectivo en caja',
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
    description:
      'ID del cargo a pagar. Si se especifica, se generará un Payment comercial.',
  })
  @IsOptional()
  @IsUUID('4')
  @Exists('charge', 'id')
  chargeId?: string;

  @ApiPropertyOptional({
    type: [SplitTransactionDto],
    description:
      'Lista de transacciones financieras múltiples (Ej. Efectivo + QR)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SplitTransactionDto)
  splitTransactions?: SplitTransactionDto[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Lista de IDs de archivos temporales (previamente subidos) para enlazar a esta transacción',
  })
  @IsOptional()
  @IsArray({
    message: i18nValidationMessage('validation.IS_ARRAY', {
      constraint1: 'attachmentIds',
    }),
  })
  @IsUUID('4', {
    each: true,
    message: 'Cada attachmentId debe ser un UUID válido',
  })
  attachmentIds?: string[];

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'ID de la cuenta financiera a la que ingresa o sale el dinero',
  })
  @IsOptional()
  @IsUUID('4', {
    message: i18nValidationMessage('validation.IS_UUID', {
      constraint1: 'financialAccountId',
    }),
  })
  @Exists('financialAccount', 'id', {
    message: i18nValidationMessage('validation.EXISTS', {
      constraint1: 'financialAccount',
    }),
  })
  financialAccountId?: string;
}
