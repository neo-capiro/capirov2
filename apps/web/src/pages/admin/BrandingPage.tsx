import { App, Button, Form, Input, Space, Typography, Upload, type UploadFile } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';

interface BrandingResponse {
  id: string;
  slug: string;
  name: string;
  logoS3Key: string | null;
  logoContentType: string | null;
  logoUploadedAt: string | null;
  logoUrl?: string | null;
}

interface PresignedUrlResponse {
  url: string;
  fields: Record<string, string>;
  s3Key: string;
}

export function BrandingPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ name: string }>();

  const branding = useQuery<BrandingResponse>({
    queryKey: ['branding'],
    queryFn: async () => (await api.get('/api/tenant-admin/branding')).data,
  });

  const updateName = useMutation({
    mutationFn: async (input: { name: string }) =>
      (await api.put('/api/tenant-admin/branding', input)).data,
    onSuccess: () => {
      message.success('Saved');
      qc.invalidateQueries({ queryKey: ['branding'] });
    },
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const presigned = (
        await api.post<PresignedUrlResponse>('/api/tenant-admin/branding/logo/upload-url', {
          contentType: file.type,
          contentLength: file.size,
        })
      ).data;
      // POST the file via the presigned form fields. The API uses
      // createPresignedPost so we get a signed multipart upload that
      // includes content-type validation.
      const fd = new FormData();
      for (const [k, v] of Object.entries(presigned.fields)) fd.append(k, v);
      fd.append('file', file);
      const res = await fetch(presigned.url, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      // Confirm, server reads the object metadata and updates the row.
      return (
        await api.post('/api/tenant-admin/branding/logo/confirm', {
          s3Key: presigned.s3Key,
          contentType: file.type,
        })
      ).data;
    },
    onSuccess: () => {
      message.success('Logo uploaded');
      qc.invalidateQueries({ queryKey: ['branding'] });
    },
    onError: (err) => message.error((err as Error).message),
  });

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div>
        <Typography.Title level={5}>Company name</Typography.Title>
        <Form
          form={form}
          layout="inline"
          initialValues={{ name: branding.data?.name }}
          onFinish={(v) => updateName.mutate(v)}
        >
          <Form.Item name="name" rules={[{ required: true, min: 2 }]}>
            <Input placeholder="Company name" style={{ width: 320 }} />
          </Form.Item>
          <Form.Item>
            <Button htmlType="submit" type="primary" loading={updateName.isPending}>
              Save
            </Button>
          </Form.Item>
        </Form>
      </div>

      <div>
        <Typography.Title level={5}>Logo</Typography.Title>
        <Space size="large" align="start">
          {branding.data?.logoUrl ? (
            <img
              src={branding.data.logoUrl}
              alt="Tenant logo"
              style={{
                maxHeight: 96,
                maxWidth: 200,
                border: '1px solid #f0f0f0',
                padding: 8,
                borderRadius: 4,
              }}
            />
          ) : (
            <div
              style={{
                width: 200,
                height: 96,
                border: '1px dashed #d9d9d9',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#bfbfbf',
              }}
            >
              No logo
            </div>
          )}
          <Upload
            accept="image/png,image/jpeg,image/svg+xml"
            showUploadList={false}
            beforeUpload={(file) => {
              if (file.size > 2 * 1024 * 1024) {
                message.error('Max 2 MB');
                return Upload.LIST_IGNORE;
              }
              uploadLogo.mutate(file as File);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={uploadLogo.isPending}>
              Upload logo
            </Button>
          </Upload>
        </Space>
      </div>
    </Space>
  );
}
