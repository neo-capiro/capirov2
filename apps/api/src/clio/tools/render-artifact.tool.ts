import { BadRequestException, Injectable } from '@nestjs/common';
import { RendererService, type ArtifactRenderKind } from '../artifacts/renderer.service.js';
import type { MeetingBriefInput } from '../artifacts/meeting-brief.template.js';
import type { PolicyMemoInput } from '../artifacts/policy-memo.template.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

type RenderArtifactInput =
  | { kind: 'policy_memo'; input: PolicyMemoInput; replacing?: string }
  | { kind: 'meeting_brief'; input: MeetingBriefInput; replacing?: string };

@Injectable()
export class RenderArtifactTool implements Tool {
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'render_artifact',
    description:
      'Render a Clio artifact as deterministic Markdown and persist it for the current tenant. ' +
      'Use this after drafting a policy memo or meeting brief that should appear as a saved Workspace artifact. ' +
      'Pass replacing when this artifact is a newer version of an earlier artifact.',
    inputSchema: {
      type: 'object',
      required: ['kind', 'input'],
      properties: {
        kind: {
          type: 'string',
          enum: ['policy_memo', 'meeting_brief'],
          description: 'The artifact template to render.',
        },
        replacing: {
          type: 'string',
          description: 'Optional artifact UUID that this render supersedes.',
        },
        input: {
          oneOf: [
            {
              type: 'object',
              required: ['title', 'issue', 'background', 'stakeholders', 'recommendations', 'citations'],
              properties: {
                title: { type: 'string' },
                issue: { type: 'string' },
                background: { type: 'string' },
                stakeholders: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['name', 'position'],
                    properties: {
                      name: { type: 'string' },
                      position: { type: 'string' },
                    },
                  },
                },
                recommendations: { type: 'array', items: { type: 'string' } },
                citations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['sourceTitle', 'url'],
                    properties: {
                      sourceTitle: { type: 'string' },
                      url: { type: 'string' },
                    },
                  },
                },
              },
            },
            {
              type: 'object',
              required: ['title', 'meetingDate', 'attendees', 'talkingPoints', 'asks', 'context'],
              properties: {
                title: { type: 'string' },
                meetingDate: { type: 'string' },
                attendees: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                      name: { type: 'string' },
                      org: { type: 'string' },
                    },
                  },
                },
                talkingPoints: { type: 'array', items: { type: 'string' } },
                asks: { type: 'array', items: { type: 'string' } },
                context: { type: 'string' },
              },
            },
          ],
        },
      },
    },
  };

  constructor(private readonly renderer: RendererService) {}

  async execute(rawInput: Record<string, unknown>, ctx: ToolExecutionContext) {
    const input = parseRenderArtifactInput(rawInput);
    return this.renderer.render(input.kind, input.input, { tenantId: ctx.tenantId, userId: ctx.userId }, {
      ...(input.replacing ? { replacing: input.replacing } : {}),
    });
  }
}

function parseRenderArtifactInput(input: Record<string, unknown>): RenderArtifactInput {
  const kind = input.kind;
  if (kind !== 'policy_memo' && kind !== 'meeting_brief') {
    throw new BadRequestException('kind must be policy_memo or meeting_brief');
  }

  const payload = requireRecord(input.input, 'input');
  const replacing = optionalString(input.replacing);
  const parsedInput = kind === 'policy_memo' ? parsePolicyMemoInput(payload) : parseMeetingBriefInput(payload);
  return { kind, input: parsedInput, ...(replacing ? { replacing } : {}) } as RenderArtifactInput;
}

function parsePolicyMemoInput(input: Record<string, unknown>): PolicyMemoInput {
  return {
    title: requiredString(input.title, 'input.title'),
    issue: requiredString(input.issue, 'input.issue'),
    background: requiredString(input.background, 'input.background'),
    stakeholders: requiredObjectArray(input.stakeholders, 'input.stakeholders').map((stakeholder, index) => ({
      name: requiredString(stakeholder.name, `input.stakeholders[${index}].name`),
      position: requiredString(stakeholder.position, `input.stakeholders[${index}].position`),
    })),
    recommendations: requiredStringArray(input.recommendations, 'input.recommendations'),
    citations: requiredObjectArray(input.citations, 'input.citations').map((citation, index) => ({
      sourceTitle: requiredString(citation.sourceTitle, `input.citations[${index}].sourceTitle`),
      url: requiredString(citation.url, `input.citations[${index}].url`),
    })),
  };
}

function parseMeetingBriefInput(input: Record<string, unknown>): MeetingBriefInput {
  return {
    title: requiredString(input.title, 'input.title'),
    meetingDate: requiredString(input.meetingDate, 'input.meetingDate'),
    attendees: requiredObjectArray(input.attendees, 'input.attendees').map((attendee, index) => {
      const org = optionalString(attendee.org);
      return {
        name: requiredString(attendee.name, `input.attendees[${index}].name`),
        ...(org ? { org } : {}),
      };
    }),
    talkingPoints: requiredStringArray(input.talkingPoints, 'input.talkingPoints'),
    asks: requiredStringArray(input.asks, 'input.asks'),
    context: requiredString(input.context, 'input.context'),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new BadRequestException(`${label} must be an object`);
}

function requiredString(value: unknown, label: string): string {
  const text = optionalString(value);
  if (!text) throw new BadRequestException(`${label} must be a non-empty string`);
  return text;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new BadRequestException(`${label} must be an array`);
  return value.map((item, index) => requiredString(item, `${label}[${index}]`));
}

function requiredObjectArray(value: unknown, label: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new BadRequestException(`${label} must be an array`);
  return value.map((item, index) => requireRecord(item, `${label}[${index}]`));
}
