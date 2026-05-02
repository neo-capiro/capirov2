import { Empty, Typography } from 'antd';

interface Props {
  title: string;
  description?: string;
}

export function PlaceholderPage({ title, description }: Props) {
  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {title}
      </Typography.Title>
      <Empty
        description={description ?? 'Coming soon. This page will be designed and built in its own session.'}
      />
    </>
  );
}
