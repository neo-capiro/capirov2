// Quick Log — a global top-bar action to jot a personal note onto any client
// or directory-member profile without navigating there.
//
//  • Client notes → POST /api/clients/:id/notes (prepended to the client's
//    profile notes, shown in Portfolio → Documents → Notes).
//  • Member notes → POST /api/directory/contacts/:id/notes (shown in the
//    member directory profile's Overview → Notes).

import { useMemo, useState } from 'react';
import { App, Button, Input, Modal, Segmented, Select } from 'antd';
import { FormOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../lib/use-api.js';

type Target = 'client' | 'member';

interface ClientOption {
  id: string;
  name: string;
  status?: string;
}

interface DirectoryContactsResponse {
  contacts: Array<{
    id: string;
    fullName: string;
    office?: string | null;
    title?: string | null;
    state?: string | null;
  }>;
}

export function QuickLogButton() {
  const api = useApi();
  const qc = useQueryClient();
  const { message } = App.useApp();

  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Target>('client');
  const [clientId, setClientId] = useState<string | undefined>();
  const [memberId, setMemberId] = useState<string | undefined>();
  const [memberName, setMemberName] = useState<string | undefined>();
  const [memberQuery, setMemberQuery] = useState('');
  const [note, setNote] = useState('');

  const reset = () => {
    setTarget('client');
    setClientId(undefined);
    setMemberId(undefined);
    setMemberName(undefined);
    setMemberQuery('');
    setNote('');
  };

  const clients = useQuery<ClientOption[]>({
    enabled: open,
    queryKey: ['clients'],
    queryFn: async () => (await api.get<ClientOption[]>('/api/clients')).data,
    staleTime: 60_000,
  });

  const members = useQuery<DirectoryContactsResponse>({
    enabled: open && target === 'member' && memberQuery.trim().length >= 2,
    queryKey: ['quicklog-directory', memberQuery.trim()],
    queryFn: async () =>
      (
        await api.get<DirectoryContactsResponse>('/api/directory/contacts', {
          params: { q: memberQuery.trim(), pageSize: 20 },
        })
      ).data,
  });

  const clientOptions = useMemo(
    () =>
      (clients.data ?? [])
        .filter((c) => c.status !== 'archived' && c.name?.trim())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.name })),
    [clients.data],
  );

  const memberOptions = useMemo(
    () =>
      (members.data?.contacts ?? []).map((c) => ({
        value: c.id,
        label: [c.fullName, c.office].filter(Boolean).join(' · '),
        name: c.fullName,
      })),
    [members.data],
  );

  const canSave =
    note.trim().length > 0 && (target === 'client' ? !!clientId : !!memberId);

  const save = useMutation({
    mutationFn: async () => {
      const body = note.trim();
      if (target === 'client') {
        if (!clientId) throw new Error('Select a client');
        return (await api.post(`/api/clients/${clientId}/notes`, { body })).data;
      }
      if (!memberId) throw new Error('Select a member');
      return (
        await api.post(`/api/directory/contacts/${encodeURIComponent(memberId)}/notes`, {
          body,
          directoryContactName: memberName,
        })
      ).data;
    },
    onSuccess: () => {
      message.success('Note logged');
      // Refresh anywhere these notes surface.
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['client'] });
      qc.invalidateQueries({ queryKey: ['client-attachments'] });
      qc.invalidateQueries({ queryKey: ['directory-contact-notes'] });
      qc.invalidateQueries({ queryKey: ['outreach-pool-member-notes'] });
      setOpen(false);
      reset();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message;
      message.error(typeof msg === 'string' ? msg : 'Could not log note');
    },
  });

  return (
    <>
      <Button
        className="app-topbar-quicklog"
        type="text"
        icon={<FormOutlined />}
        onClick={() => setOpen(true)}
      >
        Quick Log
      </Button>

      <Modal
        title="Quick Log a note"
        open={open}
        onCancel={() => {
          setOpen(false);
          reset();
        }}
        okText="Log note"
        okButtonProps={{ disabled: !canSave, loading: save.isPending }}
        onOk={() => save.mutate()}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
          <Segmented
            block
            value={target}
            onChange={(v) => setTarget(v as Target)}
            options={[
              { label: 'Client', value: 'client' },
              { label: 'Member', value: 'member' },
            ]}
          />

          {target === 'client' ? (
            <Select
              showSearch
              placeholder="Select a client…"
              value={clientId}
              onChange={(v) => setClientId(v)}
              options={clientOptions}
              optionFilterProp="label"
              loading={clients.isLoading}
              style={{ width: '100%' }}
            />
          ) : (
            <Select
              showSearch
              placeholder="Search members by name…"
              value={memberId}
              onSearch={setMemberQuery}
              onChange={(v, opt) => {
                setMemberId(v);
                setMemberName((opt as { name?: string } | undefined)?.name);
              }}
              filterOption={false}
              options={memberOptions}
              loading={members.isFetching}
              notFoundContent={
                memberQuery.trim().length < 2 ? 'Type at least 2 characters' : 'No members found'
              }
              style={{ width: '100%' }}
            />
          )}

          <Input.TextArea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Write your note… (timestamped and attributed to you)"
            autoSize={{ minRows: 4, maxRows: 10 }}
            maxLength={4000}
            showCount
          />
          <div style={{ fontSize: 12, color: 'var(--ink-3, #888)' }}>
            {target === 'client'
              ? 'Saved to the client profile → Documents → Notes.'
              : 'Saved to the member directory profile → Overview → Notes.'}
          </div>
        </div>
      </Modal>
    </>
  );
}
