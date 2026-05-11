import { BadRequestException } from '@nestjs/common';
import { RenderArtifactTool } from './render-artifact.tool.js';

describe('RenderArtifactTool', () => {
  it('defines a customer-visible render_artifact tool', () => {
    const tool = new RenderArtifactTool({ render: jest.fn() } as never);

    expect(tool.internal).toBe(false);
    expect(tool.definition).toEqual(
      expect.objectContaining({
        name: 'render_artifact',
        inputSchema: expect.objectContaining({
          required: ['kind', 'input'],
        }),
      }),
    );
  });

  it('calls the renderer with normalized meeting brief input and replacing metadata', async () => {
    const render = jest.fn(async () => ({ id: 'artifact-1', status: 'ready' }));
    const tool = new RenderArtifactTool({ render } as never);

    const result = await tool.execute(
      {
        kind: 'meeting_brief',
        replacing: '33333333-3333-4333-8333-333333333333',
        input: {
          title: ' Meeting Brief ',
          meetingDate: ' 2026-05-18 ',
          attendees: [{ name: ' Avery ', org: ' Capiro ' }],
          talkingPoints: [' Point '],
          asks: [' Ask '],
          context: ' Context ',
        },
      },
      { tenantId: 'tenant-1', userId: 'user-1', tx: {} as never },
    );

    expect(render).toHaveBeenCalledWith(
      'meeting_brief',
      {
        title: 'Meeting Brief',
        meetingDate: '2026-05-18',
        attendees: [{ name: 'Avery', org: 'Capiro' }],
        talkingPoints: ['Point'],
        asks: ['Ask'],
        context: 'Context',
      },
      { tenantId: 'tenant-1', userId: 'user-1' },
      { replacing: '33333333-3333-4333-8333-333333333333' },
    );
    expect(result).toEqual({ id: 'artifact-1', status: 'ready' });
  });

  it('rejects unsupported artifact kinds', async () => {
    const tool = new RenderArtifactTool({ render: jest.fn() } as never);

    await expect(
      tool.execute(
        { kind: 'client_intel_update', input: {} },
        { tenantId: 'tenant-1', userId: 'user-1', tx: {} as never },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

