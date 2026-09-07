import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

jest.mock('uuid', () => ({
  v4: () => randomUUID(),
}));

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { PersonsService } from '../src/persons/persons.service';
import { ContactRelationship } from 'src/generated/prisma/client';

describe('Person Contacts - CRUD QA Integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let personsService: PersonsService;

  const createdIds = {
    persons: [] as string[],
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    personsService = app.get(PersonsService);
  });

  afterAll(async () => {
    try {
      const schedulerRegistry = app.get(require('@nestjs/schedule').SchedulerRegistry);
      schedulerRegistry.getCronJobs().forEach((job: any) => job.stop());
      schedulerRegistry.getIntervals().forEach((interval: any) => clearInterval(schedulerRegistry.getInterval(interval)));
      schedulerRegistry.getTimeouts().forEach((timeout: any) => clearTimeout(schedulerRegistry.getTimeout(timeout)));
    } catch (e) {}

    await prisma.personContact.deleteMany({});
    
    for (const id of createdIds.persons) {
      await prisma.person.deleteMany({ where: { id } });
    }

    await prisma.$disconnect();
    await app.close();
  });

  describe('CRUD Person Contacts', () => {
    let personAId: string;
    let personBId: string;

    beforeAll(async () => {
      const p1 = await prisma.person.create({ data: { name: 'Person A', lastName: 'Test', documentNumber: 'TEST-A' } });
      const p2 = await prisma.person.create({ data: { name: 'Person B', lastName: 'Test', documentNumber: 'TEST-B' } });
      personAId = p1.id;
      personBId = p2.id;
      createdIds.persons.push(personAId, personBId);
    });

    it('1. Debe rechazar auto-contacto', async () => {
      await expect(
        personsService.addContact(personAId, {
          contactPersonId: personAId,
          relationship: ContactRelationship.FATHER,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('2. Debe crear relación válida', async () => {
      const res = await personsService.addContact(personAId, {
        contactPersonId: personBId,
        relationship: ContactRelationship.FATHER,
        isEmergencyContact: true,
      });

      expect(res.message).toBe('Contacto agregado exitosamente');
      expect(res.data.personId).toBe(personAId);
      expect(res.data.contactPersonId).toBe(personBId);
      expect(res.data.isEmergencyContact).toBe(true);
    });

    it('3. Debe rechazar duplicado', async () => {
      await expect(
        personsService.addContact(personAId, {
          contactPersonId: personBId,
          relationship: ContactRelationship.MOTHER,
        })
      ).rejects.toThrow(ConflictException);
    });

    it('4. Debe actualizar relación existente', async () => {
      const res = await personsService.updateContact(personAId, personBId, {
        relationship: ContactRelationship.FRIEND,
        isBillingContact: true,
      });

      expect(res.data.relationship).toBe(ContactRelationship.FRIEND);
      expect(res.data.isBillingContact).toBe(true);
    });

    it('5. Debe obtener contactos de una persona', async () => {
      const res = await personsService.getContacts(personAId);
      expect(res.data.length).toBe(1);
      expect(res.data[0].contactPersonId).toBe(personBId);
      expect(res.data[0].contactPerson).toBeDefined();
    });

    it('6. Debe eliminar contacto', async () => {
      await personsService.removeContact(personAId, personBId);
      const res = await personsService.getContacts(personAId);
      expect(res.data.length).toBe(0);
    });

    it('7. Debe fallar al editar un contacto eliminado', async () => {
      await expect(
        personsService.updateContact(personAId, personBId, {
          relationship: ContactRelationship.TUTOR,
        })
      ).rejects.toThrow(NotFoundException);
    });
  });
});
