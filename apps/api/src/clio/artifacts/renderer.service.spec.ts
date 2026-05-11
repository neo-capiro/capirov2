const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  class PutObjectCommand {
    constructor(readonly input: Record<string, unknown>) {}
  }

  class DeleteObjectCommand {
    constructor(readonly input: Record<string, unknown>) {}
  }

  return {
    DeleteObjectCommand,
    PutObjectCommand,
    S3Client: jest.fn(() => ({ send: mockS3Send })),
  };
});

jest.mock(
  '@prisma/client',
  () => ({
    ClioArtifactKind: {
      policy_memo: 'policy_memo',
      meeting_brief: 'meeting_brief',
    },
    Prisma: {},
    PrismaClient: class PrismaClient {},
  }),
  { virtual: true },
);

import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { ServiceUnavailableException } from '@nestjs/common';
import { RendererService } from './renderer.service.js';

const CTX = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
};

describe('RendererService', () => {
  it('writes markdown to S3, persists a policy memo artifact, and returns the created row', async () => {
    const { service, s3Send, prisma, createArtifact } = createHarness();
    s3Send.mockResolvedValueOnce({});
    createArtifact.mockImplementationOnce(async ({ data }) => ({ ...data, createdAt: new Date('2026-05-11T00:00:00Z') }));

    const artifact = await service.render(
      'policy_memo',
      {
        title: 'Policy Memo',
        issue: 'Issue text',
        background: 'Background text',
        stakeholders: [{ name: 'Stakeholder', position: 'Supportive' }],
        recommendations: ['Do the thing'],
        citations: [{ sourceTitle: 'Source', url: 'https://example.com/source' }],
      },
      CTX,
    );

    expect(s3Send).toHaveBeenCalledTimes(1);
    const putCommand = s3Send.mock.calls[0]?.[0];
    expect(putCommand).toBeInstanceOf(PutObjectCommand);
    expect((putCommand as PutObjectCommand).input).toMatchObject({
      Bucket: 'assets-bucket',
      ContentType: 'text/markdown; charset=utf-8',
      Body: expect.stringContaining('# Policy Memo'),
    });
    expect((putCommand as PutObjectCommand).input.Key).toMatch(
      /^tenants\/11111111-1111-4111-8111-111111111111\/artifacts\/[0-9a-f-]+\.md$/,
    );

    expect(prisma.withTenant).toHaveBeenCalledWith(CTX.tenantId, expect.any(Function));
    expect(createArtifact).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: CTX.tenantId,
        createdByUserId: CTX.userId,
        kind: 'policy_memo',
        title: 'Policy Memo',
        content: expect.stringContaining('## Citations'),
        s3Key: (putCommand as PutObjectCommand).input.Key,
        s3ContentType: 'text/markdown; charset=utf-8',
        metadata: { citations: [{ sourceTitle: 'Source', url: 'https://example.com/source' }] },
      }),
    });
    expect(artifact).toEqual(expect.objectContaining({ kind: 'policy_memo', title: 'Policy Memo' }));
  });

  it('does not create an Aurora row when S3 upload fails', async () => {
    const { service, s3Send, prisma } = createHarness();
    s3Send.mockRejectedValueOnce(new Error('S3 unavailable'));

    await expect(
      service.render(
        'meeting_brief',
        {
          title: 'Meeting Brief',
          meetingDate: '2026-05-18',
          attendees: [],
          talkingPoints: [],
          asks: [],
          context: 'Context',
        },
        CTX,
      ),
    ).rejects.toThrow('S3 unavailable');

    expect(prisma.withTenant).not.toHaveBeenCalled();
  });

  it('cleans up the S3 object when Aurora persistence fails after upload', async () => {
    const { service, s3Send, prisma } = createHarness();
    const dbError = new Error('Aurora unavailable');
    s3Send.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    prisma.withTenant.mockRejectedValueOnce(dbError);

    await expect(
      service.render(
        'meeting_brief',
        {
          title: 'Meeting Brief',
          meetingDate: '2026-05-18',
          attendees: [{ name: 'Avery Hill', org: 'Capiro' }],
          talkingPoints: ['Point'],
          asks: ['Ask'],
          context: 'Context',
        },
        CTX,
      ),
    ).rejects.toThrow('Aurora unavailable');

    expect(s3Send).toHaveBeenCalledTimes(2);
    const putCommand = s3Send.mock.calls[0]?.[0] as PutObjectCommand;
    const deleteCommand = s3Send.mock.calls[1]?.[0];
    expect(deleteCommand).toBeInstanceOf(DeleteObjectCommand);
    expect((deleteCommand as DeleteObjectCommand).input).toEqual({
      Bucket: 'assets-bucket',
      Key: putCommand.input.Key,
    });
  });

  it('fails closed when ASSETS_BUCKET is not configured', async () => {
    const { service, s3Send, prisma } = createHarness({ bucket: undefined });

    await expect(
      service.render(
        'meeting_brief',
        {
          title: 'Meeting Brief',
          meetingDate: '2026-05-18',
          attendees: [],
          talkingPoints: [],
          asks: [],
          context: 'Context',
        },
        CTX,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(s3Send).not.toHaveBeenCalled();
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });
});

function createHarness(options: { bucket?: string } = {}) {
  mockS3Send.mockReset();
  const createArtifact = jest.fn(async ({ data }) => data);
  const prisma = {
    withTenant: jest.fn(async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ clioArtifact: { create: createArtifact } }),
    ),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'ASSETS_BUCKET') return 'bucket' in options ? options.bucket : 'assets-bucket';
      if (key === 'AWS_REGION_DEFAULT') return 'us-east-1';
      return undefined;
    }),
  };
  const service = new RendererService(prisma as never, config as never);
  return { service, s3Send: mockS3Send, prisma, createArtifact };
}
