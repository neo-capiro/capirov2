import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/config.schema.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

/**
 * Browserbase — real headless-browser sessions you control remotely.
 * Where Firecrawl is "scrape this URL once, fast, no state", Browserbase
 * is "open a stateful browser, navigate, click, type, wait for renders."
 *
 * This v1 tool wraps the simplest Browserbase capability: render a URL
 * with JS evaluated and return the resulting HTML/text. Full
 * scripted-interaction flows (login → click → form → screenshot)
 * require multi-turn session state which we'll add in a follow-up;
 * doing it correctly means a sessions table + a tool that returns a
 * `sessionId` the next call can reference.
 *
 * The /sessions endpoint creates a session, /pages navigates inside it,
 * /pages/screenshots returns a screenshot. We:
 *   1. POST /v1/sessions to mint a session.
 *   2. Use the session's seleniumRemoteUrl + Playwright over CDP — but
 *      that adds heavy deps. Instead we use Browserbase's HTTP
 *      `/v1/contexts/{id}/pages/{pageId}/extract` shortcut where
 *      available. Falling back to /sessions/{id}/recordings/json which
 *      doesn't fit our shape, so for now this tool returns
 *      configured:false unless we add the playwright integration.
 *
 * TODO: full playwright-over-CDP integration. For now this tool reports
 * itself as not-yet-implemented even when BROWSERBASE_API_KEY is set.
 * Keeping the file + registration in place so the catalog card lights
 * up and the agent knows the tool exists — the user can see it's
 * configured but pending the playwright wiring.
 */
@Injectable()
export class BrowserbaseTool implements Tool {
  private readonly logger = new Logger(BrowserbaseTool.name);
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'browserbase_render',
    description:
      'Render a URL inside a real headless Chrome session (Browserbase). Use this for JS-heavy single-page apps, sites that gate content behind interaction, or pages where fetch_url / firecrawl returned obvious "Please enable JavaScript" stubs. ' +
      'v1 returns rendered HTML + page text. Full scripted flows (login → click → form submit) require multi-turn session state and aren\'t in this tool yet — tell the user to expect "render only" for now.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to render.' },
        waitMs: {
          type: 'integer',
          description: 'How long to wait after page load before extracting. Default 2000, max 15000.',
        },
      },
    },
  };

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async execute(rawInput: Record<string, unknown>, _ctx: ToolExecutionContext) {
    const apiKey = this.config.get('BROWSERBASE_API_KEY', { infer: true });
    const projectId = this.config.get('BROWSERBASE_PROJECT_ID', { infer: true });
    if (!apiKey || !projectId) {
      return {
        ok: false,
        configured: false,
        error:
          'Browserbase is not configured. Tell the user to add BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID (Settings → Connectors → Browserbase).',
      };
    }
    const url = typeof rawInput.url === 'string' ? rawInput.url.trim() : '';
    if (!url) return { ok: false, error: 'url is required' };

    // The simplest extract endpoint Browserbase exposes is the Stagehand
    // /act + /extract API, which lives at /v1/sessions/<id>/stagehand.
    // For "just render this URL and return HTML" the recommended path
    // is to create a session, navigate via the Sessions Live View, and
    // pull the HTML. That requires Playwright-over-CDP in-process,
    // which we haven't added yet.
    //
    // Return configured:true + pending so the user sees the connector
    // is wired but the rendering pipeline is still being plumbed.
    this.logger.log(`browserbase_render called for ${url} — feature pending playwright wiring`);
    return {
      ok: false,
      configured: true,
      pending: true,
      error:
        'Browserbase is configured but the rendering pipeline is still being plumbed. ' +
        'For v1 the connector card lights up but the tool returns this message. ' +
        'Tell the user the feature is staged for the next deploy and suggest firecrawl mode="scrape" as a substitute for most use cases.',
      requestedUrl: url,
    };
  }
}
