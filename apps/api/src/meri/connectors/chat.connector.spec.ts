import { describe, expect, test } from '@jest/globals';
import { MockChatConnector, type ChatChannel } from './chat.connector.js';

const channels: ChatChannel[] = [
  { id: 'C1', name: 'government-affairs' },
  { id: 'C2', name: 'leadership', isPrivate: true },
];

describe('MockChatConnector', () => {
  test('lists channels', async () => {
    const c = new MockChatConnector(channels);
    expect(c.status()).toBe('connected');
    expect((await c.listChannels()).map((x) => x.name)).toEqual([
      'government-affairs',
      'leadership',
    ]);
  });

  test('posts to a known channel and records it', async () => {
    const c = new MockChatConnector(channels);
    const msg = await c.postMessage('C1', 'Daily brief is ready');
    expect(msg.channelId).toBe('C1');
    expect(c.posted).toHaveLength(1);
  });

  test('rejects posting to an unknown channel', async () => {
    const c = new MockChatConnector(channels);
    await expect(c.postMessage('NOPE', 'hi')).rejects.toThrow(/unknown channel/i);
  });
});
