import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChargeSummaryDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  pendingAmount: number;

  @ApiProperty()
  adjustmentAmount: number;

  @ApiPropertyOptional()
  adjustmentReason?: string;

  @ApiProperty()
  dueDate: Date;

  @ApiProperty()
  status: string;

  @ApiProperty()
  type: 'MEMBERSHIP' | 'STUDENT' | 'ACCOUNT';

  @ApiProperty()
  originName: string; // Ej: "Fútbol Sub-15" o "Curso Natación" o "Cobro manual"
}

export class PlayerMembershipSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  disciplineName: string;

  @ApiProperty()
  categoryName: string;

  @ApiProperty()
  teamName: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  startedAt: Date;
}

export class StudentMembershipSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  courseName: string;

  @ApiProperty()
  institutionName: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  startedAt: Date;

  @ApiPropertyOptional()
  shiftName?: string | null;

  @ApiPropertyOptional()
  shiftStartTime?: string | null;

  @ApiPropertyOptional()
  shiftEndTime?: string | null;
}

export class PersonProfileSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  lastName: string;

  @ApiPropertyOptional()
  secondLastName?: string;

  @ApiPropertyOptional()
  documentNumber?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  imageUrl?: string;

  @ApiPropertyOptional()
  playerId?: string;

  @ApiPropertyOptional()
  studentId?: string;
}

export class SecretarySummaryResponseDto {
  @ApiProperty({ type: PersonProfileSummaryDto })
  profile: PersonProfileSummaryDto;

  @ApiProperty({ type: [PlayerMembershipSummaryDto] })
  playerMemberships: PlayerMembershipSummaryDto[];

  @ApiProperty({ type: [StudentMembershipSummaryDto] })
  studentMemberships: StudentMembershipSummaryDto[];

  @ApiProperty({ type: [ChargeSummaryDto] })
  pendingCharges: ChargeSummaryDto[];
}
