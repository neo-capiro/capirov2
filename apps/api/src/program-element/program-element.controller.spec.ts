import { NotFoundException } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { ProgramElementController } from './program-element.controller.js';

describe('ProgramElementController', () => {
  const ctx: TenantContext = {
    tenantId: '00000000-0000-0000-0000-000000000001',
    tenantSlug: 'capiro',
    userId: '00000000-0000-0000-0000-000000000002',
    clerkUserId: 'user_test',
    role: 'standard_user',
  };

  const makeController = () => {
    const service = {
      listProgramElements: jest.fn(),
      getProgramElement: jest.fn(),
      getTimeline: jest.fn(),
      getBills: jest.fn(),
      getContractors: jest.fn(),
      setWatching: jest.fn(),
    };

    const controller = new ProgramElementController(service as never);
    return { controller, service };
  };

  test('GET /api/program-elements applies defaults and pagination shape', async () => {
    const { controller, service } = makeController();
    service.listProgramElements.mockResolvedValue({
      data: [{ peCode: '0603270A', title: 'Electronic Warfare Advanced Payloads' }],
      total: 1,
      page: 1,
      limit: 50,
    });

    const result = await controller.list({});

    expect(service.listProgramElements).toHaveBeenCalledWith({
      service: undefined,
      budgetActivity: undefined,
      q: undefined,
      page: undefined,
      limit: undefined,
    });
    expect(result.limit).toBe(50);
    expect(result.total).toBe(1);
  });

  test('GET /api/program-elements enforces max limit in service contract', async () => {
    const { controller, service } = makeController();
    service.listProgramElements.mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 });

    const result = await controller.list({ limit: 500, page: 1, q: 'gps' } as never);

    expect(service.listProgramElements).toHaveBeenCalledWith({
      service: undefined,
      budgetActivity: undefined,
      q: 'gps',
      page: 1,
      limit: 500,
    });
    expect(result.limit).toBe(100);
  });

  test('GET /api/program-elements/:peCode includes currentUserIsWatching', async () => {
    const { controller, service } = makeController();
    service.getProgramElement.mockResolvedValue({ peCode: '0603270A', currentUserIsWatching: true });

    const result = await controller.detail(ctx, '0603270A');

    expect(service.getProgramElement).toHaveBeenCalledWith('0603270A', ctx);
    expect(result.currentUserIsWatching).toBe(true);
  });

  test('GET /api/program-elements/:peCode/timeline includes conferenceProbability field placeholder', async () => {
    const { controller, service } = makeController();
    service.getTimeline.mockResolvedValue({
      peCode: '0603270A',
      years: [{ fy: 2027, request: '278.50', conferenceProbability: null }],
      milestones: [],
    });

    const result = await controller.timeline('0603270A');

    expect(service.getTimeline).toHaveBeenCalledWith('0603270A');
    expect(result.years[0]?.conferenceProbability).toBeNull();
  });

  test('GET /api/program-elements/:peCode/bills returns related bills by pe_code', async () => {
    const { controller, service } = makeController();
    service.getBills.mockResolvedValue([{ id: '119-hr-1234', title: 'DoD Authorization' }]);

    const result = await controller.bills('0603270A');

    expect(service.getBills).toHaveBeenCalledWith('0603270A');
    expect(result).toHaveLength(1);
  });

  test('GET /api/program-elements/:peCode/contractors returns [] + TODO when federal_award table missing', async () => {
    const { controller, service } = makeController();
    service.getContractors.mockResolvedValue({
      data: [],
      todo: 'federal_award table not yet created (Step 28)',
    });

    const result = await controller.contractors('0603270A');

    expect(service.getContractors).toHaveBeenCalledWith('0603270A');
    expect(result.data).toEqual([]);
    expect(result.todo).toContain('Step 28');
  });

  test('POST /api/program-elements/:peCode/watch is tenant-scoped', async () => {
    const { controller, service } = makeController();
    service.setWatching.mockResolvedValue({ peCode: '0603270A', watching: true });

    const result = await controller.watch(ctx, '0603270A', { watching: true });

    expect(service.setWatching).toHaveBeenCalledWith('0603270A', true, ctx);
    expect(result.watching).toBe(true);
  });

  test('404 on unknown peCode from read endpoint', async () => {
    const { controller, service } = makeController();
    service.getProgramElement.mockRejectedValue(new NotFoundException('Program element BAD not found'));

    await expect(controller.detail(ctx, 'BAD')).rejects.toBeInstanceOf(NotFoundException);
  });

  test('404 on unknown peCode from watch endpoint', async () => {
    const { controller, service } = makeController();
    service.setWatching.mockRejectedValue(new NotFoundException('Program element BAD not found'));

    await expect(controller.watch(ctx, 'BAD', { watching: false })).rejects.toBeInstanceOf(NotFoundException);
  });
});
