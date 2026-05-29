import { Alert, Badge, Descriptions, Divider, List, Tag, Typography } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, MailOutlined, WarningOutlined } from '@ant-design/icons';
import type { Client } from '../../../clients/clientTypes.js';
import type { OutreachRecipient } from '../../OutreachView.js';
import type { GeneratedEmail } from '../OutreachWizard.js';

interface SendScheduleProps {
  campaignName: string;
  clients: Client[];
  clientId: string | null;
  recipients: OutreachRecipient[];
  generatedEmails: GeneratedEmail[];
  emailConnected: boolean;
  sendFrom: string | null;
  sending: boolean;
}

export function SendSchedule({
  campaignName,
  clients,
  clientId,
  recipients,
  generatedEmails,
  emailConnected,
  sendFrom,
  sending,
}: SendScheduleProps) {
  const client = clients.find((c) => c.id === clientId) ?? null;
  const readyEmails = generatedEmails.filter((e) => e.status === 'ready' || e.status === 'edited');
  const pendingEmails = generatedEmails.filter((e) => e.status === 'pending');
  const errorEmails = generatedEmails.filter((e) => e.status === 'error');
  const missingEmail = recipients.filter((r) => !r.email);

  return (
    <div className="outreach-flow-stack">
      <Typography.Title level={4}>Review and send</Typography.Title>
      <Typography.Paragraph type="secondary">
        Review your campaign summary below. Click <strong>Send Campaign</strong> to send all
        ready emails from your connected account.
      </Typography.Paragraph>

      <Descriptions
        bordered
        size="small"
        column={1}
        style={{ marginBottom: 16 }}
        items={[
          { label: 'Campaign name', children: campaignName || 'Campaign' },
          { label: 'Client', children: client?.name ?? '-' },
          { label: 'Total recipients', children: recipients.length },
          {
            label: 'Emails ready',
            children: (
              <span style={{ color: readyEmails.length > 0 ? 'var(--success)' : 'var(--ink-3)' }}>
                {readyEmails.length} of {recipients.length}
              </span>
            ),
          },
          {
            label: 'Sending from',
            children: sendFrom ? (
              <span>
                <MailOutlined style={{ marginRight: 4 }} />
                {sendFrom}
              </span>
            ) : (
              <span style={{ color: 'var(--critical)' }}>No email connected</span>
            ),
          },
        ]}
      />

      {!emailConnected && (
        <Alert
          type="warning"
          icon={<WarningOutlined />}
          message="No email account connected"
          description="Connect a Microsoft 365 or Google Workspace account in Integrations to send campaigns."
          showIcon
          style={{ marginBottom: 12 }}
        />
      )}

      {missingEmail.length > 0 && (
        <Alert
          type="error"
          icon={<WarningOutlined />}
          message={`${missingEmail.length} recipient${missingEmail.length !== 1 ? 's' : ''} missing email address`}
          description={missingEmail.map((r) => r.name || 'Unknown').join(', ')}
          showIcon
          style={{ marginBottom: 12 }}
        />
      )}

      {pendingEmails.length > 0 && (
        <Alert
          type="warning"
          icon={<ClockCircleOutlined />}
          message={`${pendingEmails.length} email${pendingEmails.length !== 1 ? 's' : ''} not yet generated`}
          description="Go back to Generate & Review to generate them, or they will be skipped."
          showIcon
          style={{ marginBottom: 12 }}
        />
      )}

      {errorEmails.length > 0 && (
        <Alert
          type="error"
          message={`${errorEmails.length} email${errorEmails.length !== 1 ? 's' : ''} had generation errors`}
          description="These will be skipped. Regenerate them in the previous step if needed."
          showIcon
          style={{ marginBottom: 12 }}
        />
      )}

      {readyEmails.length > 0 && (
        <>
          <Divider orientation="left" style={{ fontSize: 13 }}>
            Ready to send ({readyEmails.length})
          </Divider>
          <List
            size="small"
            dataSource={readyEmails}
            renderItem={(email) => (
              <List.Item>
                <List.Item.Meta
                  avatar={<CheckCircleOutlined style={{ color: 'var(--success)', marginTop: 3 }} />}
                  title={email.recipient.name || email.recipient.email || 'Recipient'}
                  description={
                    <span>
                      <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                        {email.subject || 'No subject'}
                      </span>
                      {email.recipient.state && (
                        <Tag style={{ marginLeft: 6, fontSize: 11 }}>{email.recipient.state}</Tag>
                      )}
                      {email.status === 'edited' && (
                        <Badge
                          count="Edited"
                          style={{ backgroundColor: 'var(--accent-ink)', fontSize: 10, marginLeft: 4 }}
                        />
                      )}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        </>
      )}

      {sending && (
        <Alert
          type="info"
          message="Sending campaign…"
          description="Clio is sending your emails. Do not close this page."
          showIcon
          style={{ marginTop: 12 }}
        />
      )}
    </div>
  );
}
