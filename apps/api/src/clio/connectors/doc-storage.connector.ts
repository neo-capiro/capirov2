/**
 * Document-storage connector (P2-10): browse + read documents from an external
 * store (SharePoint / Google Drive / S3) so Clio can ground on a firm's files.
 *
 * Defined as a provider interface + an in-memory mock; a live provider (with the
 * shared OAuth core in connector.types) is dropped in once credentials exist.
 */
import type { ConnectorStatus } from './connector.types.js';

export interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedAt?: string;
}

export interface DocStorageConnector {
  readonly provider: string;
  status(): ConnectorStatus;
  listFiles(folderId?: string): Promise<StoredFile[]>;
  getFileText(fileId: string): Promise<string>;
}

/** In-memory mock used in tests + dev until a live provider's credentials are wired. */
export class MockDocStorageConnector implements DocStorageConnector {
  readonly provider = 'mock';
  private readonly files = new Map<string, { meta: StoredFile; text: string }>();

  constructor(seed: Array<{ meta: StoredFile; text: string }> = []) {
    for (const f of seed) this.files.set(f.meta.id, f);
  }

  status(): ConnectorStatus {
    return 'connected';
  }

  async listFiles(): Promise<StoredFile[]> {
    return [...this.files.values()].map((f) => f.meta);
  }

  async getFileText(fileId: string): Promise<string> {
    const f = this.files.get(fileId);
    if (!f) throw new Error(`File not found: ${fileId}`);
    return f.text;
  }
}
