import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class GetBulkPaymentReportDto {
  @ApiProperty({
    description: 'Arreglo de IDs de pagos para generar el reporte consolidado',
    example: ['123e4567-e89b-12d3-a456-426614174000', '123e4567-e89b-12d3-a456-426614174001'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'El arreglo de IDs de pagos no puede estar vacío.' })
  @IsUUID(4, { each: true, message: 'Cada ID de pago debe ser un UUID válido.' })
  paymentIds: string[];
}
