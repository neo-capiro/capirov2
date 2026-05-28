import { Suspense, lazy } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Card,
  Col,
  Flex,
  Row,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { EyeOutlined, FileSearchOutlined, NumberOutlined, ScheduleOutlined } from '@ant-design/icons';
import { useApi } from '../../lib/use-api.js';
import {
  getProgramElementBills,
  getProgramElementContractors,
  getProgramElementDetail,
  getProgramElementsList,
} from './api.js';

const LazyWatchSections = lazy(async () => ({ default: WatchSectionsPlaceholder }));

const { Title, Text } = Typography;

export function ProgramElementWatchPage() {
  const { peCode = '' } = useParams<{ peCode: string }>();
  const normalizedPeCode = peCode.toUpperCase();
  const api = useApi();

  const detailQuery = useQuery({
    queryKey: ['program-element-detail', normalizedPeCode],
    queryFn: () => getProgramElementDetail(api, normalizedPeCode),
    staleTime: 5 * 60 * 1000,
    enabled: normalizedPeCode.length > 0,
  });

  useQuery({
    queryKey: ['program-element-list', normalizedPeCode],
    queryFn: () => getProgramElementsList(api, { q: normalizedPeCode, limit: 25, page: 1 }),
    staleTime: 60 * 1000,
    enabled: normalizedPeCode.length > 0,
  });

  useQuery({
    queryKey: ['program-element-bills', normalizedPeCode],
    queryFn: () => getProgramElementBills(api, normalizedPeCode),
    staleTime: 60 * 1000,
    enabled: normalizedPeCode.length > 0,
  });

  useQuery({
    queryKey: ['program-element-contractors', normalizedPeCode],
    queryFn: () => getProgramElementContractors(api, normalizedPeCode),
    staleTime: 60 * 1000,
    enabled: normalizedPeCode.length > 0,
  });

  if (!normalizedPeCode) {
    return <Alert type="warning" message="Missing PE code" showIcon />;
  }

  if (detailQuery.isLoading) {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Skeleton active paragraph={{ rows: 3 }} />
        <Row gutter={[16, 16]}>
          {[0, 1, 2, 3].map((idx) => (
            <Col key={idx} xs={24} md={12} xl={6}>
              <Card>
                <Skeleton active paragraph={{ rows: 1 }} title={false} />
              </Card>
            </Col>
          ))}
        </Row>
      </Space>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <Alert
        type="error"
        showIcon
        message="Unable to load program element"
        description="Please retry in a moment."
      />
    );
  }

  const detail = detailQuery.data;
  const latestYear = detail.years[0];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Flex vertical gap={8}>
          <Text type="secondary">Program Element Watch</Text>
          <Flex justify="space-between" align="flex-start" gap={16} wrap>
            <div>
              <Title level={2} style={{ margin: 0 }}>
                {detail.peCode} · {detail.title}
              </Title>
              <Text type="secondary">{detail.appropriationType ?? 'Appropriation N/A'}</Text>
            </div>
            <Tag color="blue" data-testid="pe-sector-tag">
              {detail.service ?? 'Service N/A'}
            </Tag>
          </Flex>
        </Flex>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="Latest Request"
              value={latestYear?.request != null ? Number(latestYear.request) : 0}
              precision={2}
              prefix={<NumberOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="Latest Conference"
              value={latestYear?.conference != null ? Number(latestYear.conference) : 0}
              precision={2}
              prefix={<FileSearchOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="Latest Enacted"
              value={latestYear?.enacted != null ? Number(latestYear.enacted) : 0}
              precision={2}
              prefix={<ScheduleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card>
            <Statistic
              title="Watching"
              value={detail.currentUserIsWatching ? 1 : 0}
              valueRender={() => <Tag color={detail.currentUserIsWatching ? 'green' : 'default'}>{detail.currentUserIsWatching ? 'Watching' : 'Not Watching'}</Tag>}
              prefix={<EyeOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Suspense fallback={<Skeleton active paragraph={{ rows: 6 }} />}>
        <LazyWatchSections />
      </Suspense>
    </Space>
  );
}

function WatchSectionsPlaceholder() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="Timeline (coming soon)">
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
      <Card title="Bills (coming soon)">
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
      <Card title="Contractors (coming soon)">
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
    </Space>
  );
}
