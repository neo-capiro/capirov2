import { Card, Descriptions, Spin, Typography } from 'antd';
import { useMe } from '../lib/me.js';

export function HomePage() {
  const me = useMe();
  if (me.isLoading) return <Spin />;
  if (!me.data) return null;
  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Command Center
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Today's meetings, pending notes, recent client activity, and AI-surfaced nudges will land
        here. For now, here's the round-trip proof: your identity + tenant context.
      </Typography.Paragraph>
      <Card title="Session">
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="User ID">{me.data.user.id}</Descriptions.Item>
          <Descriptions.Item label="Clerk User ID">{me.data.user.clerkUserId}</Descriptions.Item>
          <Descriptions.Item label="Tenant">{me.data.tenant.slug}</Descriptions.Item>
          <Descriptions.Item label="Tenant ID">{me.data.tenant.id}</Descriptions.Item>
          <Descriptions.Item label="Role">{me.data.role}</Descriptions.Item>
        </Descriptions>
      </Card>
    </>
  );
}
