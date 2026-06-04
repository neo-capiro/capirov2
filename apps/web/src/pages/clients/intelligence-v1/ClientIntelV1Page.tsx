import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Skeleton, Space } from 'antd';
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

  const profileV1Query = useQuery<ClientProfileV1>({
    queryKey: ['client-intel-v1-aggregate', clientId],
    // Let real failures surface as query errors instead of silently
    // collapsing to `null`. A swallowed error here blanked every
    // aggregate-fed section (Top Alerts, District Nexus, Hearings, Financial
    // Footprint, kanban, relationships) at once with no diagnostic — the
    // sections looked "empty" when the endpoint was actually erroring.
    queryFn: async () =>
      (await api.get<ClientProfileV1>(`/api/intelligence/clients/${clientId}/profile-v1`)).data,
    enabled: !!clientId,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    // Single observer across all sections. On each callback we pick the
    // section with the largest intersection ratio currently on screen, rather
    // than letting any intersecting section win the last write (which made the
    // active nav highlight flicker when two sections intersected in one tick).
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null);

    if (elements.length === 0) return;

    // Track the latest ratio per section id so we can choose the max.
    const ratios = new Map<SectionId, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id as SectionId;
          ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }

        let bestId: SectionId | null = null;
        let bestRatio = 0;
        for (const id of sectionIds) {
          const r = ratios.get(id) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            bestId = id;
          }
        }

        if (bestId) setActiveSection(bestId);
      },
      {
        root: null,
        rootMargin: '-30% 0px -55% 0px',
        threshold: [0.1, 0.35, 0.6],
      },
    );

    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
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

          {profileV1Query.isError && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 14 }}
              message="Intelligence aggregate failed to load"
              description={
                <span>
                  Snapshot alerts, financial footprint, bill pipeline, hearings, and
                  relationships could not be retrieved for this client. This is a load
                  error, not an empty dataset.
                  {(() => {
                    const err = profileV1Query.error as unknown;
                    const status =
                      err && typeof err === 'object' && 'response' in err
                        ? (err as { response?: { status?: number } }).response?.status
                        : undefined;
                    return status ? ` (HTTP ${status})` : '';
                  })()}
                </span>
              }
              action={
                <Button size="small" onClick={() => void profileV1Query.refetch()}>
                  Retry
                </Button>
              }
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
              clientId={clientId}
              billDrillHref={profileV1Query.data?.links.billDetailBase ?? '/explorer'}
            />

            <RelationshipsSection
              aggregate={profileV1Query.data ?? undefined}
              clientId={clientId}
              issueHref={issueHref}
              expandEnabled={Boolean(issueHref)}
            />
          </Space>
        </main>
      </div>
    </div>
  );
}
