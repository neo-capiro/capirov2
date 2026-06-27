import { useNavigate, useParams } from 'react-router-dom';
import { App as AntApp, Button, Input, InputNumber, Segmented, Select, Spin, Switch } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { StepsRail } from './StepsRail.js';
import {
  useDraft,
  useUpdateDraft,
  usePathwaysFor,
  useCommitteesFor,
  useTemplatesFor,
} from './api.js';
import type { WsConfig, WsTemplate } from './types.js';

/** Setup — the cascade qualifier + secondary qualifiers (6 cards). */
export function SetupPage() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { data: draft, isLoading } = useDraft(draftId ?? null);
  const update = useUpdateDraft(draftId ?? '');

  if (isLoading || !draft) {
    return (
      <div className="ws-shell">
        <StepsRail active="setup" draftId={draftId} />
        <div className="ws-stage" style={{ textAlign: 'center', padding: 60 }}>
          <Spin />
        </div>
      </div>
    );
  }

  const cfg = draft.config;
  const patchConfig = (partial: Partial<WsConfig>) => update.mutate({ config: partial });

  return (
    <div className="ws-shell">
      <StepsRail active="setup" draftId={draftId} product={draft.product} />
      <div className="ws-stage" style={{ maxWidth: 820, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginTop: 0 }}>Set up your {draft.product}</h1>

        {/* 1. Work product cascade */}
        <Card title="Work product setup">
          <CascadeCard
            industry={cfg.industry}
            product={draft.product}
            pathways={cfg.pathways}
            committees={cfg.committees}
            onPathways={(pathways) => patchConfig({ pathways })}
            onCommittees={(committees) => patchConfig({ committees })}
          />
        </Card>

        {/* 2. Templates */}
        <Card title="Templates" subtitle="Everything can be modified later in the editor.">
          <TemplatesCard
            product={draft.product}
            selected={cfg.selectedTemplate}
            onSelect={(tpl) => patchConfig({ selectedTemplate: tpl.id, sections: tpl.sections })}
          />
        </Card>

        {/* 3. Personalization */}
        <Card title="Personalization">
          <PersonalizationCard
            personalize={cfg.personalize}
            officeAssociated={cfg.officeAssociated}
            offices={cfg.offices}
            onPersonalize={(personalize) => patchConfig({ personalize })}
            onOfficeAssociated={(officeAssociated) => patchConfig({ officeAssociated })}
            onOffices={(offices) => patchConfig({ offices })}
          />
        </Card>

        {/* 4. Links & data */}
        <Card title="Links & data">
          <LinksDataCard
            industry={cfg.industry}
            linkedData={cfg.linkedData}
            onLinkedData={(linkedData) => patchConfig({ linkedData })}
          />
        </Card>

        {/* 5. Document options */}
        <Card title="Document options">
          <DocOptionsCard
            pages={cfg.pages}
            tone={cfg.tone}
            toneContext={cfg.toneContext ?? ''}
            onPages={(pages) => patchConfig({ pages })}
            onTone={(tone) => patchConfig({ tone })}
            onToneContext={(toneContext) => patchConfig({ toneContext })}
          />
        </Card>

        {/* 6. Letterhead */}
        <Card title="Letterhead">
          <LetterheadCard
            letterhead={cfg.letterhead}
            onChange={(letterhead) => patchConfig({ letterhead })}
          />
        </Card>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <Button
            type="primary"
            size="large"
            icon={<ArrowRightOutlined />}
            onClick={() => navigate(`/workspace/context/${draftId}`)}
          >
            Continue to Build context
          </Button>
        </div>
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="ws-card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: subtitle ? 2 : 12 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--ws-ink-3)', marginBottom: 12 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function CascadeCard({
  industry,
  product,
  pathways,
  committees,
  onPathways,
  onCommittees,
}: {
  industry: string | null;
  product: string | null;
  pathways: string[];
  committees: string[];
  onPathways: (p: string[]) => void;
  onCommittees: (c: string[]) => void;
}) {
  const { data: pathwayOpts } = usePathwaysFor(industry, product);
  const { data: committeeOpts } = useCommitteesFor(industry, pathways);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="Industry">
        <Input disabled value={industry ?? ''} />
      </Field>
      <Field label="Work product">
        <Input disabled value={product ?? ''} />
      </Field>
      <Field label="Legislative pathway">
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          value={pathways}
          onChange={onPathways}
          options={(pathwayOpts ?? []).map((p) => ({ value: p, label: p }))}
          placeholder="Select pathway(s)"
        />
      </Field>
      <Field label="Committee / Subcommittee">
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          value={committees}
          onChange={onCommittees}
          options={(committeeOpts ?? []).map((c) => ({ value: c, label: c }))}
          placeholder="Derived from pathways — prune as needed"
        />
      </Field>
    </div>
  );
}

function TemplatesCard({
  product,
  selected,
  onSelect,
}: {
  product: string | null;
  selected: string | null;
  onSelect: (t: WsTemplate) => void;
}) {
  const { data } = useTemplatesFor(product);
  const cards = [data?.primary, data?.secondary].filter(Boolean) as WsTemplate[];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
      {cards.map((t) => (
        <div
          key={t.id}
          className="ws-product-card"
          style={{ borderColor: selected === t.id ? 'var(--ws-accent)' : undefined, boxShadow: selected === t.id ? '0 0 0 2px var(--ws-accent-soft)' : undefined }}
          onClick={() => onSelect(t)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="ws-pill info">{t.meriPrimary ? 'Recommended' : 'Alternative'}</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.name}</div>
          <div style={{ fontSize: 12, color: 'var(--ws-ink-3)' }}>{t.description}</div>
          <div style={{ fontSize: 11, color: 'var(--ws-ink-4)', marginTop: 4 }}>
            {t.sections.length} sections
          </div>
        </div>
      ))}
      <div className="ws-product-card" style={{ borderStyle: 'dashed', justifyContent: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>Create your own</div>
        <div style={{ fontSize: 12, color: 'var(--ws-ink-3)' }}>Build the section list from scratch.</div>
      </div>
    </div>
  );
}

function PersonalizationCard({
  personalize,
  officeAssociated,
  offices,
  onPersonalize,
  onOfficeAssociated,
  onOffices,
}: {
  personalize: boolean;
  officeAssociated: boolean;
  offices: string[];
  onPersonalize: (v: boolean) => void;
  onOfficeAssociated: (v: boolean) => void;
  onOffices: (v: string[]) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Does this work product require personalization for an office, client, or other contact?">
        <Segmented
          value={personalize ? 'Personalized' : 'Standardized'}
          options={['Standardized', 'Personalized']}
          onChange={(v) => onPersonalize(v === 'Personalized')}
        />
      </Field>
      {/* Office row shows ONLY when Personalized (Neo decision #2, §12.14). */}
      {personalize && (
        <>
          <Field label="Tied to a specific office?">
            <Switch checked={officeAssociated} onChange={onOfficeAssociated} />
          </Field>
          {officeAssociated && (
            <Field label="Offices">
              <Select
                mode="tags"
                style={{ width: '100%' }}
                value={offices}
                onChange={onOffices}
                placeholder="Search the congressional or client directory"
              />
            </Field>
          )}
        </>
      )}
    </div>
  );
}

function LinksDataCard({
  industry,
  linkedData,
  onLinkedData,
}: {
  industry: string | null;
  linkedData: string[];
  onLinkedData: (v: string[]) => void;
}) {
  // Industry platform data toggles (Defense → PE/R-1/UPL). For v1 we surface a
  // free-tag selector; real wiring pulls WSC.dataFor(industry) labels.
  return (
    <Field label={`Platform data${industry ? ` for ${industry}` : ''}`}>
      <Select
        mode="tags"
        style={{ width: '100%' }}
        value={linkedData}
        onChange={onLinkedData}
        placeholder="Program Element, R-1 budget line, Navy UPL…"
      />
    </Field>
  );
}

function DocOptionsCard({
  pages,
  tone,
  toneContext,
  onPages,
  onTone,
  onToneContext,
}: {
  pages: number;
  tone: string;
  toneContext: string;
  onPages: (v: number) => void;
  onTone: (v: string) => void;
  onToneContext: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Target length (pages)">
        <InputNumber min={1} max={30} value={pages} onChange={(v) => onPages(v ?? 1)} />
      </Field>
      <Field label="Tone">
        <Segmented value={tone} options={['Formal', 'Plain', 'Persuasive']} onChange={(v) => onTone(String(v))} />
      </Field>
      <Field label="Key focus / strategic goal (optional)">
        <Input.TextArea
          rows={2}
          value={toneContext}
          onChange={(e) => onToneContext(e.target.value)}
          placeholder="e.g. emphasize ROI over technical feasibility"
        />
      </Field>
    </div>
  );
}

function LetterheadCard({
  letterhead,
  onChange,
}: {
  letterhead: { custom: boolean; firmName: string; firmAddr: string };
  onChange: (v: { custom: boolean; firmName: string; firmAddr: string }) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Custom letterhead">
        <Switch checked={letterhead.custom} onChange={(custom) => onChange({ ...letterhead, custom })} />
      </Field>
      {letterhead.custom && (
        <>
          <Field label="Firm name">
            <Input value={letterhead.firmName} onChange={(e) => onChange({ ...letterhead, firmName: e.target.value })} />
          </Field>
          <Field label="Firm address">
            <Input value={letterhead.firmAddr} onChange={(e) => onChange({ ...letterhead, firmAddr: e.target.value })} />
          </Field>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ws-ink-2)', marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}
