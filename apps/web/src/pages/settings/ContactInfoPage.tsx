import { useEffect } from 'react';
import { App as AntApp, Button, Card, Col, Divider, Form, Input, Row, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';

interface ContactInfo {
  name?: string;
  phone?: string;
  email?: string;
  mailingStreet1?: string;
  mailingStreet2?: string;
  mailingCity?: string;
  mailingStateZip?: string;
  permanentStreet1?: string;
  permanentStreet2?: string;
  permanentCity?: string;
  permanentStateZip?: string;
}

export function ContactInfoPage() {
  const api = useApi();
  const { message } = AntApp.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<ContactInfo>();

  const { data, isPending } = useQuery<ContactInfo>({
    queryKey: ['contact-info'],
    queryFn: async () => (await api.get<ContactInfo>('/api/tenant-admin/contact-info')).data,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const save = useMutation({
    mutationFn: async (values: ContactInfo) =>
      (await api.put<ContactInfo>('/api/tenant-admin/contact-info', values)).data,
    onSuccess: () => {
      message.success('Contact info saved');
      qc.invalidateQueries({ queryKey: ['contact-info'] });
    },
    onError: () => message.error('Save failed'),
  });

  if (isPending) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  return (
    <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
      <Card title="Organization Contact" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="name" label="Organization name">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="email" label="Email">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="phone" label="Phone">
              <Input />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      <Card title="Mailing Address" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={24}>
            <Form.Item name="mailingStreet1" label="Street 1">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="mailingStreet2" label="Street 2">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={14}>
            <Form.Item name="mailingCity" label="City">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item name="mailingStateZip" label="State / ZIP">
              <Input placeholder="VA 22201" />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      <Card title="Permanent Address" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={24}>
            <Form.Item name="permanentStreet1" label="Street 1">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="permanentStreet2" label="Street 2">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={14}>
            <Form.Item name="permanentCity" label="City">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item name="permanentStateZip" label="State / ZIP">
              <Input placeholder="VA 22201" />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      <Button type="primary" htmlType="submit" loading={save.isPending}>
        Save contact info
      </Button>
    </Form>
  );
}
