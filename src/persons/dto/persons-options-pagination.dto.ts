import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination';
import { Gender } from 'src/generated/prisma/client';

export enum ExcludeRole {
  PLAYER = 'PLAYER',
  STUDENT = 'STUDENT',
  STAFF = 'STAFF',
  USER = 'USER',
}

export class PersonsOptionsPaginationDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: Gender,
    description: 'Filtrar por género',
  })
  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @ApiPropertyOptional({
    enum: ExcludeRole,
    description: 'Rol a excluir para mostrar solo personas disponibles',
  })
  @IsEnum(ExcludeRole)
  @IsOptional()
  excludeRole?: ExcludeRole;
}
