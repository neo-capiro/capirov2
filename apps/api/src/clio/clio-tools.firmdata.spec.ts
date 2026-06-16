import { BadRequestException } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { ClioToolsService } from './clio-tools.service.js';

/**
 * Wiring/shape tests for the firm-operational-data tools (tool-coverage
 * expansion). The heavy queries live in their own already-tested services, so
 * these specs mock the services and assert: (a) tenant-scope params are passed
 * through, (b) required inputs are enforced, (c) the returned shape is what the
 * model sees, (d) branch selection (list vs detail vs deadlines) is correct.
 */

const ctx = { tenantId: 'tenant-1', userId: 'user-1' } as TenantContext;

function makeMocks() {
  const tx = {
    client: { findFirst: jest.fn().mockResolvedValue({ id: 'client-1' }) },
    clioConversation: {
      findFirst: jest.fn().mockResolvedValue({ id: 'conv-1', clientId: 'client-1' }),
    },
    clioArtifact: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'artifact-1',
        ...data,
      })),
    },
  };
  const prisma = {
    withTenant: jest.fn(async (_tenantId: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const engagement = {
    clientContext: jest.fn().mockResolvedValue({ client: { id: 'client-1', name: 'Acme' } }),
    listTasks: jest.fn().mockResolvedValue([]),
    listClientDebriefs: jest.fn().mockResolvedValue([]),
    listCampaigns: jest.fn().mockResolvedValue([]),
    getOutreachRecord: jest.fn(),
    createTask: jest.fn(),
    updateTask: jest.fn(),
  };
  const workflows = {
    listInstances: jest.fn().mockResolvedValue([]),
    getInstance: jest.fn(),
    updateInstance: jest.fn(),
  };
  const strategies = {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn(),
    getDeadlines: jest.fn().mockResolvedValue([]),
  };
  const actionRecommendations = {
    list: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
  };
  const intelligence = { listTrackedBills: jest.fn().mockResolvedValue([]) };
  const regulatoryDockets = {
    listDockets: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
    getUpcomingDeadlines: jest.fn().mockResolvedValue([]),
  };
  const programElement = {
    listSamOpportunities: jest.fn().mockResolvedValue({ data: [], total: 0 }),
  };
  const clientCapabilities = {
    listCapabilities: jest.fn().mockResolvedValue([]),
    listClientHistory: jest.fn().mockResolvedValue([]),
  };
  const clientPeople = { listPeople: jest.fn().mockResolvedValue([]) };
  const clientFacilities = { listFacilities: jest.fn().mockResolvedValue([]) };

  const docgen = {
    buildDocx: jest.fn().mockResolvedValue(Buffer.from('docx')),
    buildXlsx: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
    buildPptx: jest.fn().mockResolvedValue(Buffer.from('pptx')),
  };

  const service = new ClioToolsService(
    prisma as never,
    { get: jest.fn() } as never,
    engagement as never,
    {} as never, // microsoftGraph
    {} as never, // ldaIntel
    {} as never, // lobbyIntel
    {} as never, // federalSpending
    programElement as never,
    {} as never, // acquisitionPersonnel
    docgen as never,
    workflows as never,
    strategies as never,
    actionRecommendations as never,
    intelligence as never,
    regulatoryDockets as never,
    clientCapabilities as never,
    clientPeople as never,
    clientFacilities as never,
    { search: jest.fn().mockResolvedValue([]) } as never, // clientKb
    { isEnabled: jest.fn().mockResolvedValue(false) } as never, // featureFlags
  );

  return {
    service,
    tx,
    prisma,
    engagement,
    workflows,
    strategies,
    actionRecommendations,
    intelligence,
    regulatoryDockets,
    programElement,
    clientCapabilities,
    clientPeople,
    clientFacilities,
    docgen,
  };
}

describe('query_workflows', () => {
  it('lists instances (slimmed) and passes tenant + filters through', async () => {
    const m = makeMocks();
    m.workflows.listInstances.mockResolvedValue([
      {
        id: 'wf-1',
        title: 'FY27 White Paper',
        status: 'in_progress',
        template: { slug: 'white-paper', name: 'White Paper' },
        clientId: 'client-1',
        client: { id: 'client-1', name: 'Acme' },
        submissionDeadline: new Date('2026-07-01'),
        submissionMethod: 'portal',
        completedAt: null,
        updatedAt: new Date('2026-06-01'),
        formData: { secret: 'big blob that must not leak into list rows' },
      },
    ]);
    const result = (await m.service.execute(ctx, 'query_workflows', {
      clientId: 'client-1',
      status: 'in_progress',
    })) as { total: number; results: Array<Record<string, unknown>> };

    expect(m.workflows.listInstances).toHaveBeenCalledWith('tenant-1', {
      clientId: 'client-1',
      status: 'in_progress',
    });
    expect(result.total).toBe(1);
    expect(result.results[0]).toMatchObject({
      id: 'wf-1',
      templateSlug: 'white-paper',
      clientName: 'Acme',
      status: 'in_progress',
    });
    expect(result.results[0]!.formData).toBeUndefined();
  });

  it('returns full detail when instanceId is given', async () => {
    const m = makeMocks();
    m.workflows.getInstance.mockResolvedValue({ id: 'wf-9', formData: { a: 1 } });
    const result = (await m.service.execute(ctx, 'query_workflows', {
      instanceId: 'wf-9',
    })) as { instance: { id: string } };
    expect(m.workflows.getInstance).toHaveBeenCalledWith('tenant-1', 'wf-9');
    expect(result.instance.id).toBe('wf-9');
  });

  it('rejects an invalid status', async () => {
    const m = makeMocks();
    await expect(
      m.service.execute(ctx, 'query_workflows', { status: 'bogus' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('query_tasks', () => {
  it('derives overdue from past due date on open tasks only', async () => {
    const m = makeMocks();
    m.engagement.listTasks.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Past-due open task',
        status: 'todo',
        dueDate: new Date('2020-01-01'),
        clientId: null,
        client: null,
        meeting: null,
        description: null,
        createdAt: new Date('2019-12-01'),
      },
      {
        id: 'task-2',
        title: 'Past-due DONE task',
        status: 'done',
        dueDate: new Date('2020-01-01'),
        clientId: null,
        client: null,
        meeting: null,
        description: null,
        createdAt: new Date('2019-12-01'),
      },
    ]);
    const result = (await m.service.execute(ctx, 'query_tasks', {})) as {
      tasks: Array<{ id: string; overdue: boolean }>;
    };
    expect(result.tasks.find((t) => t.id === 'task-1')!.overdue).toBe(true);
    expect(result.tasks.find((t) => t.id === 'task-2')!.overdue).toBe(false);
  });

  it('maps status=overdue to openOnly + dueBefore', async () => {
    const m = makeMocks();
    await m.service.execute(ctx, 'query_tasks', { status: 'overdue', limit: 10 });
    const call = m.engagement.listTasks.mock.calls[0]!;
    expect(call[0]).toBe(ctx);
    expect(call[1]).toMatchObject({ openOnly: true, limit: 10 });
    expect(call[1].dueBefore).toBeInstanceOf(Date);
  });

  it('rejects unknown statuses', async () => {
    const m = makeMocks();
    await expect(
      m.service.execute(ctx, 'query_tasks', { status: 'nonsense' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('query_strategies', () => {
  it('list branch maps targets/instances counts', async () => {
    const m = makeMocks();
    m.strategies.list.mockResolvedValue([
      {
        id: 'strat-1',
        name: 'FY27 approps push',
        status: 'active',
        fiscalYear: 2027,
        clientId: 'client-1',
        client: { id: 'client-1', name: 'Acme' },
        capability: { id: 'cap-1', name: 'Radar', fundingAsk: 5 },
        targets: [{ id: 'target-1' }, { id: 'target-2' }],
        _count: { instances: 3 },
        description: 'desc',
        createdAt: new Date('2026-01-01'),
      },
    ]);
    const result = (await m.service.execute(ctx, 'query_strategies', {})) as {
      results: Array<Record<string, unknown>>;
    };
    expect(m.strategies.list).toHaveBeenCalledWith('tenant-1', { clientId: undefined });
    expect(result.results[0]).toMatchObject({ targetsCount: 2, instancesCount: 3 });
  });

  it('detail branch uses get()', async () => {
    const m = makeMocks();
    m.strategies.get.mockResolvedValue({ id: 'strat-9' });
    const result = (await m.service.execute(ctx, 'query_strategies', {
      strategyId: 'strat-9',
    })) as { strategy: { id: string } };
    expect(m.strategies.get).toHaveBeenCalledWith('tenant-1', 'strat-9');
    expect(result.strategy.id).toBe('strat-9');
  });

  it('deadlinesOnly branch uses getDeadlines()', async () => {
    const m = makeMocks();
    m.strategies.getDeadlines.mockResolvedValue([{ strategyId: 'strat-1', daysUntil: 5 }]);
    const result = (await m.service.execute(ctx, 'query_strategies', {
      deadlinesOnly: true,
    })) as { deadlines: unknown[] };
    expect(m.strategies.getDeadlines).toHaveBeenCalledWith('tenant-1');
    expect(result.deadlines).toHaveLength(1);
  });
});

describe('query_action_items', () => {
  it('passes ctx + filters to the read service and returns the cards', async () => {
    const m = makeMocks();
    m.actionRecommendations.list.mockResolvedValue({
      data: [{ id: 'action-1', issueTitle: 'PE cut' }],
      total: 1,
      page: 1,
      limit: 20,
    });
    const result = (await m.service.execute(ctx, 'query_action_items', {
      clientId: 'client-1',
      status: 'new',
      sort: 'priority',
    })) as { total: number; actions: Array<{ id: string }> };
    expect(m.actionRecommendations.list).toHaveBeenCalledWith(ctx, {
      clientId: 'client-1',
      status: 'new',
      sort: 'priority',
      limit: 20,
    });
    expect(result.total).toBe(1);
    expect(result.actions[0]!.id).toBe('action-1');
  });
});

describe('search_tracked_bills', () => {
  it('requires clientId', async () => {
    const m = makeMocks();
    await expect(m.service.execute(ctx, 'search_tracked_bills', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns the tracked bills for a visible client', async () => {
    const m = makeMocks();
    m.intelligence.listTrackedBills.mockResolvedValue([{ billId: 'hr-1', bill: null }]);
    const result = (await m.service.execute(ctx, 'search_tracked_bills', {
      clientId: 'client-1',
    })) as { total: number; bills: unknown[] };
    expect(m.intelligence.listTrackedBills).toHaveBeenCalledWith('client-1', 'tenant-1');
    expect(result.total).toBe(1);
  });
});

describe('query_regulatory_dockets', () => {
  it('list branch', async () => {
    const m = makeMocks();
    await m.service.execute(ctx, 'query_regulatory_dockets', {
      agencyId: 'EPA',
      documentType: 'Proposed Rule',
      limit: 5,
    });
    expect(m.regulatoryDockets.listDockets).toHaveBeenCalledWith({
      agencyId: 'EPA',
      documentType: 'Proposed Rule',
      limit: 5,
    });
  });

  it('upcoming-deadlines branch', async () => {
    const m = makeMocks();
    await m.service.execute(ctx, 'query_regulatory_dockets', { upcomingOnly: true, days: 45 });
    expect(m.regulatoryDockets.getUpcomingDeadlines).toHaveBeenCalledWith(45);
    expect(m.regulatoryDockets.listDockets).not.toHaveBeenCalled();
  });
});

describe('search_sam_opportunities', () => {
  it('passes filters and summarizes long descriptions', async () => {
    const m = makeMocks();
    m.programElement.listSamOpportunities.mockResolvedValue({
      data: [{ id: 'opp-1', title: 'Radar RFI', description: 'x'.repeat(2000) }],
      total: 1,
    });
    const result = (await m.service.execute(ctx, 'search_sam_opportunities', {
      query: 'radar',
      naics: '3364',
    })) as { results: Array<{ description: string }> };
    expect(m.programElement.listSamOpportunities).toHaveBeenCalledWith({
      query: 'radar',
      naics: '3364',
      includeInactive: undefined,
      limit: 20,
    });
    expect(result.results[0]!.description.length).toBeLessThanOrEqual(300);
  });
});

describe('query_debriefs', () => {
  it('requires clientId and withholds restricted bodies', async () => {
    const m = makeMocks();
    await expect(m.service.execute(ctx, 'query_debriefs', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    m.engagement.listClientDebriefs.mockResolvedValue([
      {
        id: 'debrief-1',
        meetingId: 'meeting-1',
        meeting: { id: 'meeting-1', subject: 'Hill day' },
        body: 'super secret',
        restricted: true,
        author: null,
        createdAt: new Date('2026-06-01'),
      },
    ]);
    const result = (await m.service.execute(ctx, 'query_debriefs', {
      clientId: 'client-1',
    })) as { debriefs: Array<{ body: string | null; restricted: boolean }> };
    expect(result.debriefs[0]!.body).toBeNull();
    expect(result.debriefs[0]!.restricted).toBe(true);
  });
});

describe('query_outreach', () => {
  it('list branch maps campaigns with recipient counts', async () => {
    const m = makeMocks();
    m.engagement.listCampaigns.mockResolvedValue([
      {
        id: 'campaign-1',
        name: 'June Hill blitz',
        type: 'custom',
        status: 'draft',
        subject: null,
        clientId: 'client-1',
        client: { id: 'client-1', name: 'Acme' },
        recipients: [{ id: 'recipient-1' }, { id: 'recipient-2' }, { id: 'recipient-3' }],
        createdBy: { email: 'neo@capiro.ai' },
        sentAt: null,
        createdAt: new Date('2026-06-01'),
      },
    ]);
    const result = (await m.service.execute(ctx, 'query_outreach', {})) as {
      campaigns: Array<Record<string, unknown>>;
    };
    expect(m.engagement.listCampaigns).toHaveBeenCalledWith(ctx, {
      clientId: undefined,
      status: undefined,
    });
    expect(result.campaigns[0]).toMatchObject({ recipientCount: 3, clientName: 'Acme' });
  });

  it('detail branch fetches a single record', async () => {
    const m = makeMocks();
    m.engagement.getOutreachRecord.mockResolvedValue({ id: 'outreach-9', body: 'b' });
    const result = (await m.service.execute(ctx, 'query_outreach', {
      outreachId: 'outreach-9',
    })) as { record: { id: string } };
    expect(m.engagement.getOutreachRecord).toHaveBeenCalledWith(ctx, 'outreach-9');
    expect(result.record.id).toBe('outreach-9');
  });
});

describe('get_client_context profile depth', () => {
  it('adds the additive profile key without touching the engagement context', async () => {
    const m = makeMocks();
    m.clientCapabilities.listCapabilities.mockResolvedValue([
      { id: 'cap-1', name: 'Radar', type: 'product', peNumbers: ['0604123A'] },
    ]);
    m.clientPeople.listPeople.mockResolvedValue([{ id: 'person-1', name: 'Dr. Smith' }]);
    m.clientFacilities.listFacilities.mockResolvedValue([{ id: 'facility-1', name: 'HQ' }]);
    m.clientCapabilities.listClientHistory.mockResolvedValue([
      { id: 'history-1', fiscalYear: 2026, title: 'FY26 approps', outcomeType: 'won' },
    ]);
    const result = (await m.service.execute(ctx, 'get_client_context', {
      clientId: 'client-1',
    })) as { context: unknown; profile: Record<string, unknown[]> };
    expect(m.engagement.clientContext).toHaveBeenCalledWith(ctx, 'client-1');
    expect(result.context).toEqual({ client: { id: 'client-1', name: 'Acme' } });
    expect(result.profile.capabilities).toHaveLength(1);
    expect(result.profile.people).toHaveLength(1);
    expect(result.profile.facilities).toHaveLength(1);
    expect(result.profile.submissionHistory).toHaveLength(1);
  });

  it('profile reads are best-effort: a failing profile service never breaks the tool', async () => {
    const m = makeMocks();
    m.clientPeople.listPeople.mockRejectedValue(new Error('boom'));
    const result = (await m.service.execute(ctx, 'get_client_context', {
      clientId: 'client-1',
    })) as { profile: { people: unknown[] } };
    expect(result.profile.people).toEqual([]);
  });
});

describe('P2 write tools', () => {
  it('create_task maps inputs onto EngagementService.createTask', async () => {
    const m = makeMocks();
    m.engagement.createTask.mockResolvedValue({
      id: 'task-9',
      title: 'Follow up with PEO',
      status: 'todo',
      dueDate: new Date('2026-06-20'),
      clientId: 'client-1',
      createdAt: new Date('2026-06-10'),
    });
    const result = (await m.service.execute(ctx, 'create_task', {
      title: 'Follow up with PEO',
      clientId: 'client-1',
      dueDate: '2026-06-20',
    })) as { created: boolean; task: { id: string } };
    expect(m.engagement.createTask).toHaveBeenCalledWith(ctx, {
      title: 'Follow up with PEO',
      clientId: 'client-1',
      dueDate: '2026-06-20',
      description: undefined,
    });
    expect(result.created).toBe(true);
    expect(result.task.id).toBe('task-9');
  });

  it('update_task maps open->todo, rejects an empty update', async () => {
    const m = makeMocks();
    m.engagement.updateTask.mockResolvedValue({
      id: 'task-9',
      title: 'x',
      status: 'todo',
      dueDate: null,
      clientId: null,
      updatedAt: new Date('2026-06-10'),
    });
    await m.service.execute(ctx, 'update_task', { taskId: 'task-9', status: 'open' });
    expect(m.engagement.updateTask).toHaveBeenCalledWith(ctx, 'task-9', { status: 'todo' });

    await expect(m.service.execute(ctx, 'update_task', { taskId: 'task-9' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      m.service.execute(ctx, 'update_task', { taskId: 'task-9', status: 'bogus' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update_workflow_field merges one key into existing formData', async () => {
    const m = makeMocks();
    m.workflows.getInstance.mockResolvedValue({
      id: 'wf-1',
      formData: { program: 'Radar', amount: 5 },
    });
    m.workflows.updateInstance.mockResolvedValue({
      id: 'wf-1',
      status: 'in_progress',
      title: 'FY27 White Paper',
    });
    const result = (await m.service.execute(ctx, 'update_workflow_field', {
      instanceId: 'wf-1',
      fieldKey: 'justification',
      value: 'Approved justification text',
    })) as { updated: boolean; fieldKey: string };
    expect(m.workflows.updateInstance).toHaveBeenCalledWith('tenant-1', 'wf-1', {
      formData: { program: 'Radar', amount: 5, justification: 'Approved justification text' },
    });
    expect(result.updated).toBe(true);
    expect(result.fieldKey).toBe('justification');
  });
});

describe('create_word artifact persistence (regression: conversationId threading)', () => {
  it('persists the document artifact and returns a download URL when conversationId is supplied', async () => {
    const m = makeMocks();
    const result = (await m.service.execute(ctx, 'create_word', {
      title: 'Strategy Memo',
      clientId: 'client-1',
      conversationId: 'conv-1',
      sections: [{ heading: 'Overview', body: 'Body text' }],
    })) as { downloadUrl: string | null; artifact: { persisted?: boolean; id?: string } };

    // The artifact row must be created (so it has a download URL) — the whole
    // point of the fix: without conversationId this silently no-ops.
    expect(m.tx.clioArtifact.create).toHaveBeenCalledTimes(1);
    const createArg = (m.tx.clioArtifact.create.mock.calls[0]?.[0] ?? { data: {} }) as {
      data: { conversationId: string; kind: string; metadata: Record<string, unknown> };
    };
    expect(createArg.data.conversationId).toBe('conv-1');
    expect(createArg.data.kind).toBe('word_document');
    expect(createArg.data.metadata.docFormat).toBe('docx');
    expect(result.downloadUrl).toBe('/api/clio/artifacts/artifact-1/download');
    expect(m.docgen.buildDocx).toHaveBeenCalledTimes(1);
  });

  it('does NOT persist (no download URL) when conversationId is absent', async () => {
    const m = makeMocks();
    const result = (await m.service.execute(ctx, 'create_word', {
      title: 'Strategy Memo',
      clientId: 'client-1',
      sections: [{ heading: 'Overview', body: 'Body text' }],
    })) as { downloadUrl: string | null; artifact: { persisted?: boolean } };

    expect(m.tx.clioArtifact.create).not.toHaveBeenCalled();
    expect(result.downloadUrl).toBeNull();
    expect(result.artifact.persisted).toBe(false);
  });
});

describe('client visibility gate', () => {
  it('rejects when the client is not visible in the tenant', async () => {
    const m = makeMocks();
    m.tx.client.findFirst.mockResolvedValue(null);
    await expect(
      m.service.execute(ctx, 'query_tasks', { clientId: 'client-x' }),
    ).rejects.toThrow('Client not found');
    expect(m.engagement.listTasks).not.toHaveBeenCalled();
  });
});
