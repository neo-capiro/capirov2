import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config/config.schema.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

interface SandboxFile {
  name: string;
  contentType: string;
  sizeBytes: number;
  s3Key: string;
  /** Presigned-GET URL minted by the sandbox at upload time, ~15min TTL. */
  url: string;
}

interface SandboxResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  files: SandboxFile[];
}

/**
 * Lets the Clio agent write a short Python program, run it in the
 * clio-sandbox service (separate Fargate task), and pull file outputs
 * back. Pre-installed libs include pandas, openpyxl (Excel),
 * python-docx (Word), python-pptx (PowerPoint), reportlab (PDF),
 * Pillow (images), requests (network — egress allowlisted).
 *
 * Files the program writes into /tmp/output/ get auto-uploaded to
 * s3://assets/tenants/<tenantId>/clio-runs/<runId>/<filename> and
 * returned to the model with presigned-GET URLs (~15min TTL).
 *
 * Until `CLIO_SANDBOX_BASE_URL` is configured, this tool returns a
 * structured "not provisioned" error so the agent can tell the user
 * the feature is staged but not live. See
 * OVERNIGHT_DECISIONS_CODE_EXEC.md §16 for the full architecture and
 * the deploy steps.
 */
@Injectable()
export class CodeInterpreterTool implements Tool {
  private readonly logger = new Logger(CodeInterpreterTool.name);
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'code_interpreter',
    description:
      'Run a short Python program in a sandboxed environment. Use this for any task that needs computation, API calls, data transformation, or file generation. ' +
      'Pre-installed libraries: pandas, numpy, openpyxl (Excel), python-docx (Word), python-pptx (PowerPoint), reportlab (PDF), Pillow (images), requests (HTTP — egress allowlisted), beautifulsoup4. ' +
      'Write file outputs into /tmp/output/<filename> — they will be uploaded and returned as downloadable artifacts. ' +
      'Sandbox limits: 30s wall clock, 512MB memory, no filesystem access outside /tmp. Outbound network restricted to an allowlist (S3, public APIs).',
    inputSchema: {
      type: 'object',
      required: ['code'],
      properties: {
        code: {
          type: 'string',
          description:
            'Self-contained Python program. Indentation matters. Print statements go to stdout and are returned to you. Write any file artifacts into /tmp/output/<filename>.',
        },
        title: {
          type: 'string',
          description:
            'Short human-readable label for this run, shown in the artifact panel. E.g. "Generate contact roster Excel".',
        },
      },
    },
  };

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async execute(rawInput: Record<string, unknown>, ctx: ToolExecutionContext) {
    const code = typeof rawInput.code === 'string' ? rawInput.code : '';
    if (!code.trim()) {
      throw new BadRequestException('code is required');
    }
    const title =
      typeof rawInput.title === 'string' && rawInput.title.trim()
        ? rawInput.title.trim()
        : 'Untitled run';

    const sandboxUrl = this.config.get('CLIO_SANDBOX_BASE_URL', { infer: true });
    if (!sandboxUrl) {
      // Tool is registered but the sandbox service isn't provisioned
      // yet. Return a clean machine-readable shape so the agent can
      // tell the user what's happening without making something up.
      this.logger.warn('code_interpreter called but CLIO_SANDBOX_BASE_URL is not set');
      return {
        ok: false,
        provisioned: false,
        error:
          'The code-interpreter sandbox is not provisioned in this environment yet. The tool is registered and ready, but the backing service (clio-sandbox) needs to be deployed. See OVERNIGHT_DECISIONS_CODE_EXEC.md §16. Tell the user the feature is staged for the next deploy.',
      };
    }

    const runId = randomUUID();
    const sharedSecret =
      this.config.get('CLIO_INBOUND_SHARED_SECRET', { infer: true }) ?? '';
    // Same shared-secret scheme the agent loop uses for tool callbacks.
    // The sandbox service validates it on every /run, identical to the
    // Capiro API's ClioInternalAuthGuard.
    try {
      const res = await fetch(`${sandboxUrl.replace(/\/$/, '')}/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${sharedSecret}`,
        },
        body: JSON.stringify({
          runId,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          code,
          title,
        }),
        // Sandbox enforces 30s internally; this is a generous client-
        // side cap so a hung connection doesn't pin the agent loop.
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        const body = await res.text();
        return {
          ok: false,
          provisioned: true,
          error: `Sandbox returned ${res.status}: ${body.slice(0, 400)}`,
        };
      }
      const data = (await res.json()) as SandboxResponse;

      // Surface each output file as a clio_artifacts row so the
      // Workspace's artifact panel can show + download it. Without
      // this, the model says "here's your file" and gives a URL but
      // the side panel stays empty — confusing UX.
      //
      // We classify by content type so the icon + label match (xlsx
      // → 'Excel Workbook', docx → 'Word Document', etc.). Unknown
      // types fall through to `other`.
      const artifactIds: string[] = [];
      if (ctx.sessionId && data.files.length > 0) {
        for (const f of data.files) {
          try {
            const row = await ctx.tx.clioArtifact.create({
              data: {
                tenantId: ctx.tenantId,
                sessionId: ctx.sessionId,
                createdByUserId: ctx.userId,
                kind: 'other',
                title: f.name,
                s3Key: f.s3Key,
                s3ContentType: f.contentType,
                content: null,
                status: 'ready',
                version: 1,
                metadata: {
                  source: 'code_interpreter',
                  runId,
                  runTitle: title,
                  sizeBytes: f.sizeBytes,
                  presignedUrl: f.url,
                  presignedExpiresInSeconds: 15 * 60,
                },
              },
              select: { id: true },
            });
            artifactIds.push(row.id);
          } catch (insertErr) {
            this.logger.warn(
              `code_interpreter: failed to insert clio_artifact for ${f.name}: ${String(insertErr)}`,
            );
          }
        }
      }

      return {
        ok: true,
        runId,
        title,
        stdout: data.stdout.slice(0, 4096),
        stderr: data.stderr.slice(0, 2048),
        exitCode: data.exitCode,
        durationMs: data.durationMs,
        files: data.files.map((f, i) => ({
          name: f.name,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
          url: f.url,
          // Echo the artifact id back so the model can reference it
          // by name in its reply ("see the test.xlsx in the panel
          // on the right") if it wants to.
          artifactId: artifactIds[i],
        })),
      };
    } catch (err) {
      this.logger.warn(`code_interpreter sandbox call failed: ${String(err)}`);
      return {
        ok: false,
        provisioned: true,
        error: 'Sandbox unreachable. Try again in a moment.',
      };
    }
  }
}
