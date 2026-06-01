import { describe, expect, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ProgramElementModule } from './program-element.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ProgramElementWriterService } from './program-element-writer.service.js';
import { ReconciliationService } from './reconciliation/reconciliation.service.js';

/**
 * DI smoke test. ProgramElementWriterService takes ReconciliationService as its 3rd
 * constructor arg (Step 29); if it is not registered as a provider in
 * ProgramElementModule, the NestJS app context fails to boot in serve mode (this
 * exact failure took down the 79de5c2 deploy). This guards against regressing that.
 */
describe('ProgramElementModule DI', () => {
  test('compiles and resolves ProgramElementWriterService (with ReconciliationService injected)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ProgramElementModule],
    }).compile();

    expect(moduleRef.get(ProgramElementWriterService)).toBeDefined();
    expect(moduleRef.get(ReconciliationService)).toBeDefined();
    await moduleRef.close();
  });
});
