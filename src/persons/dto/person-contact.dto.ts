import { ApiProperty, PartialType, OmitType } from '@nestjs/swagger';
import { IsUUID, IsEnum, IsBoolean, IsOptional } from 'class-validator';
import { ContactRelationship } from 'src/generated/prisma/client';

export class CreatePersonContactDto {
  @ApiProperty({
    description: 'El ID de la persona que será registrada como contacto.',
    format: 'uuid',
  })
  @IsUUID('4')
  contactPersonId: string;

  @ApiProperty({
    enum: ContactRelationship,
    description: 'El tipo de relación de parentesco o contacto.',
  })
  @IsEnum(ContactRelationship)
  relationship: ContactRelationship;

  @ApiProperty({
    required: false,
    default: false,
    description: 'Bandera indicando si es contacto de emergencia.',
  })
  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;

  @ApiProperty({
    required: false,
    default: false,
    description: 'Bandera indicando si es el responsable de facturación (sólo metadato).',
  })
  @IsOptional()
  @IsBoolean()
  isBillingContact?: boolean;
}

export class UpdatePersonContactDto extends PartialType(
  OmitType(CreatePersonContactDto, ['contactPersonId'] as const)
) {}
