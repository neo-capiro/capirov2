import { useQuery } from '@tanstack/react-query';
import { CopyOutlined, MailOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Tooltip } from 'antd';
import { useApi } from '../../lib/use-api.js';

interface MailboxResponse {
  id: string;
  localPart: string;
  fullAddress: string;
  active: boolean;
  autoReply: boolean;
  createdAt: string;
}

/**
 * Workspace header chip showing the user's Clio mailbox address with a
 * one-click copy. Pings GET /api/clio/mailbox which auto-provisions on
 * first call — so the chip both DISPLAYS and BOOTSTRAPS the mailbox.
 *
 * Hidden when the request fails (e.g. backend old image — graceful
 * degradation). On success the address is the most visible "your Clio
 * is alive" affordance in the UI.
 */
export function MailboxChip() {
  const api = useApi();
  const { message } = AntApp.useApp();

  const mb = useQuery<MailboxResponse>({
    queryKey: ['clio', 'mailbox'],
    queryFn: async () => (await api.get<MailboxResponse>('/api/clio/mailbox')).data,
    retry: false,
    staleTime: 60_000,
  });

  if (mb.isError || !mb.data) return null;
  const addr = mb.data.fullAddress;

  return (
    <div className="clio-mailbox-chip" role="region" aria-label="Your Clio email address">
      <MailOutlined className="clio-mailbox-chip__icon" aria-hidden />
      <code className="clio-mailbox-chip__addr">{addr}</code>
      <Tooltip title="Copy address">
        <Button
          type="text"
          size="small"
          icon={<CopyOutlined />}
          aria-label="Copy Clio email address"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(addr);
              message.success('Address copied');
            } catch {
              message.error('Could not copy — select and copy manually');
            }
          }}
        />
      </Tooltip>
    </div>
  );
}
