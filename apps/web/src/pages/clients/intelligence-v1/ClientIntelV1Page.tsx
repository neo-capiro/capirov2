import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Skeleton, Space } from 'antd';
import { useApi } from '../../../lib/use-api.js';
import type { ClientIntelProfile } from '../../intelligence/types.js';
import { SectionNav } from './components/SectionNav.js';
import {
  buildSectionNavMeta,
  SECTION_ORDER,
  type ClientProfileV1,
  type SectionId,
} from './mappers.js';
import { SnapshotSection } from './sections/SnapshotSection.js';
import { FinancialFootprintSection } from './sections/FinancialFootprintSection.js';
import { LegislativeRegulatorySection } from './sections/LegislativeRegulatorySection.js';
import { RelationshipsSection } from './sections/RelationshipsSection.js';

function withClientContext(href: string, clientId: string): string {
  const raw = href?.trim();
  if (!raw) return `/engagement?clientId=${encodeURIComponent(clientId)}`;

  try {
    const isAbsolute = /^https?:\/\//i.test(raw);
    const url = new URL(raw, isAbsolute ? undefined : 'http://localhost');

    if (!url.searchParams.has('clientId')) {
      url.searchParams.set('clientId', clientId);
    }

    if (isAbsolute) return url.toString();
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    const joiner = raw.includes('?') ? '&' : '?';
    return `${raw}${joiner}clientId=${encodeURIComponent(clientId)}`;
  }
}

interface ClientIntelV1PageProps {
  clientId: string;
  clientName: string;
}

export function ClientIntelV1Page({ clientId, clientName }: ClientIntelV1PageProps) {
  const api = useApi();
  const [activeSection, setActiveSection] = useState<SectionId>('snapshot');

  const profileQuery = useQuery<ClientIntelProfile>({
    queryKey: ['client-intel-v1-profile', clientId],
    queryFn: async () => (await api.get<ClientIntelProfile>(`/api/intelligence/client-profile/${clientId}`)).data,
    enabled: !!clientId,
    staleTime: 2 * 60 * 1000,
  });

  const sectionIds = useMemo(() => SECTION_ORDER.map((section) => section.id), []);

  const profileV1Query = useQuery<ClientProfileV1 | null>({
    queryKey: ['client-intel-v1-aggregate', clientId],
    queryFn: async () => {
      try {
        return (
          await api.get<ClientProfileV1>(`/api/intelligence/clients/${clientId}/profile-v1`)
        ).data;
      } catch {
        return null;
      }
    },
    enabled: !!clientId,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    for (const id of sectionIds) {
      const element = document.getElementById(id);
      if (!element) continue;

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            setActiveSection(id);
          }
        },
        {
          root: null,
          rootMargin: '-30% 0px -55% 0px',
          threshold: [0.1, 0.35, 0.6],
        },
      );

      observer.observe(element);
      observers.push(observer);
    }

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, [sectionIds]);

  const scrollToSection = (id: SectionId) => {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  };

  const navMeta = buildSectionNavMeta(profileQuery.data);

  const issueHref = useMemo(() => {
    const fromLinks = profileV1Query.data?.links.competitorIssuePage?.trim();
    if (fromLinks) return fromLinks;

    const code = profileV1Query.data?.sections.legislativeRegulatory.kanban.issueCodes.find(
      (value) => typeof value === 'string' && value.trim().length > 0,
    )?.trim();

    return code ? `/intelligence/issues/${encodeURIComponent(code)}` : '';
  }, [profileV1Query.data]);

  // Scoped engagement href — always carries clientId so the Engagement Manager
  // opens pre-filtered to this client. `withClientContext` is idempotent: it
  // is a no-op if clientId is already present in the href.
  const engagementHref = useMemo(
    () => withClientContext('/engagement', clientId),
    [clientId],
  );

  return (
    <div className="iv1-page redesign">
      <header className="iv1-page__header">
        <div>
          <h1 className="iv1-page__title">Client Intelligence</h1>
          <p className="iv1-page__subtitle">{clientName}</p>
        </div>
      </header>

      <div className="iv1-layout">
        <aside className="iv1-layout__nav">
          <SectionNav
            sections={SECTION_ORDER}
            activeSection={activeSection}
            onNavClick={scrollToSection}
            syncedAt={navMeta.syncedAt}
            sourceCount={navMeta.sourceCount}
          />
        </aside>

        <main className="iv1-layout__main">
          {profileQuery.isLoading && <Skeleton active paragraph={{ rows: 6 }} />}

          {profileQuery.isError && (
            <Alert
              type="warning"
              showIcon
              message="Client intelligence is unavailable"
              description="Showing shell sections while data reconnects."
            />
          )}

          <Space direction="vertical" size={18} style={{ width: '100%' }}>
            <SnapshotSection
              clientId={clientId}
              clientName={clientName}
              profile={profileQuery.data ?? null}
              aggregate={profileV1Query.data ?? undefined}
            />

            <FinancialFootprintSection
              aggregate={profileV1Query.data ?? undefined}
              runFecEnabled={false}
              runFecHref="/explorer"
            />

            <LegislativeRegulatorySection
              aggregate={profileV1Query.data ?? undefined}
              billDrillHref={profileV1Query.data?.links.billDetailBase ?? '/explorer'}
              syncCalendarHref={engagementHref}
              setAlertsHref={
                profileV1Query.data?.links.changesInbox
                  ?? `/intelligence/changes?clientId=${encodeURIComponent(clientId)}`
              }
            />

            <RelationshipsSection
              aggregate={profileV1Query.data ?? undefined}
              issueHref={issueHref}
              expandEnabled={Boolean(issueHref)}
            />
          </Space>
        </main>
      </div>
    </div>
  );
}
