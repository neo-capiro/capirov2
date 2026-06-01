import { describe, expect, test } from '@jest/globals';
import {
  summarizeTurnTrace,
  traceLogLine,
  type ClioRoundTrace,
  type ClioTraceUsage,
} from './clio-trace.helpers.js';

const usage = (over: Partial<ClioTraceUsage> = {}): ClioTraceUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  ...over,
});

const round = (over: Partial<ClioRoundTrace> = {}): ClioRoundTrace => ({
  round: 0,
  durationMs: 100,
  usage: usage(),
  stopReason: 'end_turn',
  tools: [],
  ...over,
});

describe('summarizeTurnTrace', () => {
  test('counts rounds, tool calls and tool errors', () => {
    const t = summarizeTurnTrace({
      intent: 'research',
      skill: 'briefing',
      totalDurationMs: 4200,
      totalUsage: usage({ inputTokens: 1000, outputTokens: 500 }),
      lowConfidence: false,
      rounds: [
        round({
          round: 0,
          stopReason: 'tool_use',
          tools: [
            { name: 'a', ok: true },
            { name: 'b', ok: false },
          ],
        }),
        round({ round: 1, tools: [{ name: 'c', ok: true }] }),
      ],
    });
    expect(t.roundCount).toBe(2);
    expect(t.toolCallCount).toBe(3);
    expect(t.toolErrorCount).toBe(1);
    expect(t.totalDurationMs).toBe(4200);
    expect(t.skill).toBe('briefing');
    expect(t.lowConfidence).toBe(false);
  });

  test('handles a tool-less turn', () => {
    const t = summarizeTurnTrace({
      intent: 'general',
      skill: null,
      totalDurationMs: 800,
      totalUsage: usage(),
      lowConfidence: null,
      rounds: [round()],
    });
    expect(t.toolCallCount).toBe(0);
    expect(t.toolErrorCount).toBe(0);
    expect(t.skill).toBeNull();
  });
});

describe('traceLogLine', () => {
  test('renders a compact line and omits confidence when null', () => {
    const line = traceLogLine(
      summarizeTurnTrace({
        intent: 'draft',
        skill: null,
        totalDurationMs: 1200,
        totalUsage: usage({ inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 5 }),
        lowConfidence: null,
        rounds: [round({ tools: [{ name: 'x', ok: true }] })],
      }),
    );
    expect(line).toContain('intent=draft');
    expect(line).toContain('tools=1');
    expect(line).toContain('in=10');
    expect(line).toContain('cacheRead=5');
    expect(line).not.toContain('lowConfidence');
  });

  test('includes confidence when present', () => {
    const line = traceLogLine(
      summarizeTurnTrace({
        intent: 'briefing',
        skill: 'briefing',
        totalDurationMs: 1,
        totalUsage: usage(),
        lowConfidence: true,
        rounds: [],
      }),
    );
    expect(line).toContain('lowConfidence=true');
  });
});
