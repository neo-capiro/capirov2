import { Alert, Card, Descriptions } from 'antd';
import { UserButton } from '@clerk/clerk-react';
import { useMe } from '../../lib/me.js';

/**
 * Personal settings — the only Settings tab everyone sees. Identity surfaces
 * (email, password, MFA) live in Clerk's hosted UserButton modal; Capiro
 * surfaces the link here. Future fields: notifications, time zone,
 * accessibility preferences.
 */
export function PersonalPage() {
  const me = useMe();
  if (!me.data) return null;
  return (
    <>
      <Card title="Account" style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="User ID">{me.data.user.id}</Descriptions.Item>
          <Descriptions.Item label="Tenant">{me.data.tenant.slug}</Descriptions.Item>
          <Descriptions.Item label="Role">{me.data.role}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="Identity (Clerk)">
        <Alert
          type="info"
          showIcon
          message="Email, password, and MFA settings are managed in Clerk."
          description="Click your avatar in the top-right header to open Clerk's account settings."
          style={{ marginBottom: 16 }}
        />
        <UserButton afterSignOutUrl="/sign-in" />
      </Card>
    </>
  );
}
