/**
 * Chat connector (P3-3): list channels + post messages to Slack / Microsoft
 * Teams so Meri can share briefings/alerts where the team works.
 *
 * Provider interface + in-memory mock; a live Slack/Teams provider (with the
 * shared OAuth core in connector.types) drops in once the platform + credentials
 * are chosen. Posting is a write — gated by P2-5 confirmation/audit when wired.
 */
import type { ConnectorStatus } from './connector.types.js';

export interface ChatChannel {
  id: string;
  name: string;
  isPrivate?: boolean;
}

export interface PostedMessage {
  id: string;
  channelId: string;
  text: string;
}

export interface ChatConnector {
  readonly provider: string;
  status(): ConnectorStatus;
  listChannels(): Promise<ChatChannel[]>;
  postMessage(channelId: string, text: string): Promise<PostedMessage>;
}

export class MockChatConnector implements ChatConnector {
  readonly provider = 'mock';
  private readonly channels: ChatChannel[];
  readonly posted: PostedMessage[] = [];

  constructor(channels: ChatChannel[] = []) {
    this.channels = channels;
  }

  status(): ConnectorStatus {
    return 'connected';
  }

  async listChannels(): Promise<ChatChannel[]> {
    return this.channels;
  }

  async postMessage(channelId: string, text: string): Promise<PostedMessage> {
    if (!this.channels.some((c) => c.id === channelId)) {
      throw new Error(`Unknown channel: ${channelId}`);
    }
    const msg: PostedMessage = { id: `msg-${this.posted.length + 1}`, channelId, text };
    this.posted.push(msg);
    return msg;
  }
}
