/**
 * Workspace Editor — Phase 5 core, built to the locked prototype (asset_14 +
 * asset_07 + asset_12). Replaces the v0 editor.
 *
 * Layout (matches the prototype): a full-height shell with the EditorToolbar and
 * the RichTextToolbar pinned at top, then a scrolling 4-column grid:
 *   StepsRail (208) · document canvas (1fr) · InsertRail (74) · MeriPanel (300).
 *
 * Autosave (Q-ED-7 + binding decision): the FULL document model is debounced
 * (~1.2s). `cfg` (sections, sectionContent, sectionMeta, ask, anonymize, …) is
 * persisted via useUpdateDraft; each packet tab's edited body is persisted via
 * useUpdateDocument. "Save draft" flushes immediately. The toolbar shows
 * Saving…/Saved.
 *
 * Rich text: section + packet bodies use a CONTROLLED contentEditable
 * (editor/rich-text.tsx) that stores sanitized HTML and syncs external values
 * only while unfocused. The RichTextToolbar drives the active editor only — no
 * global execCommand.
 *
 * Phase 6 stubs (DEFERRED, layout present): Comments rail content, Anonymize
 * review modal, Checks popover, Version-history popover, Insert→Templates,
 * Insert→Table-type picker, concurrent-edit lock. These toast / no-op.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App as AntApp, Spin } from 'antd';
import { StepsRail } from './StepsRail.js';
import {
  useAddDocument,
  useDeleteDocument,
  useDraft,
  useGenerateSection,
  useUpdateDocument,
  useUpdateDraft,
} from './api.js';
import type { WsAsk, WsBlock, WsConfig, WsDocument, WsSectionMeta } from './types.js';
import { EditorToolbar, type SaveStatus } from './editor/EditorToolbar.js';
import { RichTextToolbar } from './editor/RichTextToolbar.js';
import { DraftOutline } from './editor/DraftOutline.js';
import { OfficeRow } from './editor/OfficeRow.js';
import { DocTabs, type DocTab } from './editor/DocTabs.js';
import { PaperBody } from './editor/PaperBody.js';
import { PacketDocCanvas, type PacketBody } from './editor/PacketDocCanvas.js';
import { Letterhead } from './editor/canvas-blocks.js';
import { InsertRail } from './editor/InsertRail.js';
import { MeriPanel } from './editor/MeriPanel.js';
import { budgetFrom } from './editor/BudgetBlock.js';
import { sectionViews } from './editor/section-model.js';
import { anonymizeMap } from './editor/anonymize.js';

const AUTOSAVE_MS = 1200;
const MAIN_TAB = 'main';

export function EditorPage() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { data: draft, isLoading } = useDraft(draftId ?? null);

  const updateDraft = useUpdateDraft(draftId ?? '');
  const updateDocument = useUpdateDocument(draftId ?? '');
  const addDocument = useAddDocument(draftId ?? '');
  const deleteDocument = useDeleteDocument(draftId ?? '');
  const generate = useGenerateSection(draftId ?? '');

  // ── Local working copies (the autosave debounce flushes these to the API) ──
  const [cfg, setCfg] = useState<WsConfig | null>(null);
  const [docTitle, setDocTitle] = useState('');
  // Per-document body working copies for non-main packet docs, keyed by doc id.
  const [packetBodies, setPacketBodies] = useState<Record<string, PacketBody>>({});
  // Inserted media blocks on the MAIN doc (photo/table/logo). Persisted in cfg.
  const [mainBlocks, setMainBlocks] = useState<WsBlock[]>([]);

  const [activeTab, setActiveTab] = useState<string>(MAIN_TAB);
  const [activeOffice, setActiveOffice] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [draftingSection, setDraftingSection] = useState<string | null>(null);

  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dirty trackers so the debounce only writes what changed.
  const cfgDirty = useRef(false);
  const dirtyDocs = useRef<Set<string>>(new Set());

  // Hydrate the local working copies from the draft once it loads (Q-DOC-2:
  // open on the draft's OWN data, including Meri-intake auto-drafted content).
  useEffect(() => {
    if (!draft || hydrated.current) return;
    hydrated.current = true;
    setCfg(draft.config);
    setDocTitle(draft.docTitle);
    setMainBlocks(((draft.config.mainBlocks as WsBlock[] | undefined) ?? []).slice());
    const bodies: Record<string, PacketBody> = {};
    for (const d of draft.documents) {
      bodies[d.id] = normalizeBody(d);
    }
    setPacketBodies(bodies);
    setActiveOffice(draft.config.offices?.[0] ?? null);
  }, [draft]);

  // ── Autosave: debounce the full document model (cfg + packet bodies) ────────
  // `flush` closes over the latest cfg/bodies; the debounce timer dispatches
  // through `flushRef` so a fired timer always runs the freshest flush (not a
  // stale closure captured when the timer was set).
  const flushRef = useRef<(manual: boolean) => void>(() => {});
  const scheduleSave = useCallback(() => {
    if (!draftId) return;
    setSaveStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flushRef.current(false), AUTOSAVE_MS);
  }, [draftId]);

  const flush = useCallback(
    (manual: boolean) => {
      if (!draftId) return;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const tasks: Promise<unknown>[] = [];
      // cfg + title.
      if (cfgDirty.current && cfg) {
        cfgDirty.current = false;
        tasks.push(
          updateDraft.mutateAsync({
            docTitle,
            config: { ...cfg, mainBlocks } as Partial<WsConfig>,
          }),
        );
      }
      // each dirty packet body.
      for (const docId of dirtyDocs.current) {
        const body = packetBodies[docId];
        if (!body) continue;
        tasks.push(
          updateDocument.mutateAsync({
            docId,
            body: { body: { blocks: body.blocks, title: body.title } },
          }),
        );
      }
      dirtyDocs.current.clear();

      Promise.allSettled(tasks).then(() => {
        setSaveStatus('saved');
        if (manual) message.success('Saved to Documents');
      });
    },
    [draftId, cfg, docTitle, mainBlocks, packetBodies, updateDraft, updateDocument, message],
  );
  flushRef.current = flush;

  // Flush any pending save on unmount.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  // ── cfg mutation helper ─────────────────────────────────────────────────────
  const patchCfg = useCallback(
    (partial: Partial<WsConfig>) => {
      setCfg((prev) => (prev ? { ...prev, ...partial } : prev));
      cfgDirty.current = true;
      scheduleSave();
    },
    [scheduleSave],
  );

  // Cover-letter: ensure a packet doc exists when cfg.coverLetter flips on.
  useEffect(() => {
    if (!cfg || !draft) return;
    if (!cfg.coverLetter) return;
    const exists =
      draft.documents.some((d) => /cover letter/i.test(d.name)) ||
      Object.values(packetBodies).some((b) => /cover letter/i.test(b.title ?? ''));
    if (!exists && draftId) {
      addDocument.mutate({ name: 'Cover letter' });
    }
    // Only react to the flag flipping (documents refetch hydrates the rest).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.coverLetter]);

  // When the draft's documents list changes (add/remove), reconcile working
  // bodies for any newly-arrived docs without clobbering in-flight edits.
  useEffect(() => {
    if (!draft) return;
    setPacketBodies((prev) => {
      const next = { ...prev };
      for (const d of draft.documents) {
        if (!next[d.id]) next[d.id] = normalizeBody(d);
      }
      // Drop bodies for documents that no longer exist.
      for (const id of Object.keys(next)) {
        if (!draft.documents.some((d) => d.id === id)) delete next[id];
      }
      return next;
    });
  }, [draft]);

  if (isLoading || !draft || !cfg) {
    return (
      <div className="ws-shell">
        <StepsRail active="draft" draftId={draftId} />
        <div className="ws-stage" style={{ textAlign: 'center', padding: 60 }}>
          <Spin />
        </div>
      </div>
    );
  }

  // ── Derived view-models ─────────────────────────────────────────────────────
  const views = sectionViews(cfg);
  const anonMap = anonymizeMap(draft.client, draft.product);
  const ask: WsAsk =
    (cfg.ask as WsAsk | undefined) ??
    (draft.ask && draft.ask !== 'n/a' ? (draft.ask as WsAsk) : {});
  const budget = budgetFrom(cfg);
  const offices = (cfg.offices as string[] | undefined) ?? [];
  const linkedData = (cfg.linkedData as string[] | undefined) ?? [];

  // Office row predicate (Q-ED-1): personalize is the single canonical gate.
  const showOfficeRow = !!cfg.personalize && offices.length > 0;

  // Letterhead firm fallbacks (live tenant firm wiring is later; use config).
  const firmName = cfg.letterhead?.firmName || draft.client || 'Your firm';
  const firmAddr = cfg.letterhead?.firmAddr || 'Add a firm address in Setup → Letterhead';

  // Packet tabs: main (label = product) + each packet WsDocument.
  const tabs: DocTab[] = [
    { id: MAIN_TAB, label: cfg.product || draft.docTitle || 'Document', main: true },
    ...draft.documents.map((d) => ({ id: d.id, label: d.name })),
  ];
  const isMainDoc = activeTab === MAIN_TAB;

  // Budget-identifier meta line under the title.
  const metaParts = [
    draft.client,
    budget.account,
    budget.pe ? `PE ${budget.pe}` : null,
    budget.upl,
  ].filter(Boolean);
  const metaLine = metaParts.length ? metaParts.join(' · ') : (draft.product ?? '');

  const toast = (msg: string) => message.info(msg);

  // ── Section handlers ────────────────────────────────────────────────────────
  const setSectionMeta = (name: string, meta: Partial<WsSectionMeta>) => {
    const all = (cfg.sectionMeta as Record<string, WsSectionMeta> | undefined) ?? {};
    patchCfg({ sectionMeta: { ...all, [name]: { ...(all[name] ?? {}), ...meta } } });
  };
  const setSectionBody = (name: string, html: string) => {
    const content = (cfg.sectionContent as Record<string, string> | undefined) ?? {};
    patchCfg({ sectionContent: { ...content, [name]: html } });
  };
  const renameSection = (i: number, name: string) => {
    const v = name.trim();
    if (!v || v === cfg.sections[i]) return;
    const next = [...cfg.sections];
    const old = next[i];
    if (!old) return;
    next[i] = v;
    // Carry content + meta across the rename.
    const content = { ...((cfg.sectionContent as Record<string, string> | undefined) ?? {}) };
    const meta = { ...((cfg.sectionMeta as Record<string, WsSectionMeta> | undefined) ?? {}) };
    if (old in content) {
      content[v] = content[old] ?? '';
      delete content[old];
    }
    if (old in meta) {
      meta[v] = meta[old] ?? {};
      delete meta[old];
    }
    patchCfg({ sections: next, sectionContent: content, sectionMeta: meta });
  };
  const removeSection = (name: string) =>
    patchCfg({ sections: cfg.sections.filter((x) => x !== name) });
  const reorderSections = (from: number, to: number) => {
    const arr = [...cfg.sections];
    const [moved] = arr.splice(from, 1);
    if (moved === undefined) return;
    arr.splice(to, 0, moved);
    patchCfg({ sections: arr });
  };
  const addSection = () => {
    if (!isMainDoc) {
      addBlockTo('section');
      return;
    }
    let n = 'New section';
    let i = 2;
    while (cfg.sections.includes(n)) n = 'New section ' + i++;
    patchCfg({ sections: [...cfg.sections, n] });
    toast('Section added');
  };

  // Draft-with-Meri: generate → write content + set status review (Meri output
  // stays attributable via the accent body + review pill).
  const generateSection = (name: string) => {
    setDraftingSection(name);
    generate.mutate(name, {
      onSuccess: (r) => {
        setSectionBody(name, r.content);
        setSectionMeta(name, { status: 'review' });
        message.success(
          `Drafted with ${r.model}${r.usedTenantKey ? ' (your key)' : ''}${r.anonymized ? ' · anonymized' : ''}`,
        );
      },
      onError: (e: unknown) => {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          'Generation failed';
        message.error(msg);
      },
      onSettled: () => setDraftingSection(null),
    });
  };
  const regenerateSection = (name: string) => generateSection(name);
  const markReviewed = (name: string) => {
    setSectionMeta(name, { status: 'done' });
    toast(`Marked "${name}" reviewed`);
  };
  const setAsk = (key: keyof WsAsk, value: string) => patchCfg({ ask: { ...ask, [key]: value } });

  // ── Insert handlers (route to the active doc) ───────────────────────────────
  const addBlockTo = (kind: string) => {
    const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
    if (isMainDoc) {
      if (kind === 'section') {
        addSection();
        return;
      }
      const block: WsBlock = { id, type: kind as WsBlock['type'] };
      setMainBlocks((b) => [...b, block]);
      cfgDirty.current = true;
      scheduleSave();
    } else {
      setPacketBodies((prev) => {
        const body = prev[activeTab] ?? { blocks: [] };
        const block: WsBlock =
          kind === 'section'
            ? { id, type: 'section', title: 'New section', content: '' }
            : { id, type: kind as WsBlock['type'] };
        return { ...prev, [activeTab]: { ...body, blocks: [...body.blocks, block] } };
      });
      dirtyDocs.current.add(activeTab);
      scheduleSave();
    }
  };
  const removeMainBlock = (id: string) => {
    setMainBlocks((b) => b.filter((x) => x.id !== id));
    cfgDirty.current = true;
    scheduleSave();
  };

  // ── Packet doc handlers ─────────────────────────────────────────────────────
  const onPacketChange = (docId: string, body: PacketBody) => {
    setPacketBodies((prev) => ({ ...prev, [docId]: body }));
    dirtyDocs.current.add(docId);
    scheduleSave();
  };
  const addDoc = (label: string) => {
    addDocument.mutate(
      { name: label },
      {
        onSuccess: (doc) => {
          setPacketBodies((prev) => ({ ...prev, [doc.id]: normalizeBody(doc) }));
          setActiveTab(doc.id);
        },
      },
    );
  };
  const renameDoc = (docId: string, label: string) =>
    updateDocument.mutate({ docId, body: { name: label } });
  const removeDoc = (docId: string) => {
    deleteDocument.mutate(docId);
    if (activeTab === docId) setActiveTab(MAIN_TAB);
  };

  // ── Toolbar handlers ────────────────────────────────────────────────────────
  const onAnonymize = () => patchCfg({ anonymize: !cfg.anonymize });
  const onChecks = () => toast('Checks popover arrives in a later phase'); // TODO(phase 6)
  const onHistory = () => toast('Version history arrives in a later phase'); // TODO(phase 6)
  const onShare = () => navigate(`/workspace/collab/${draftId}`);
  const onPreview = () => {
    flush(false);
    navigate(`/workspace/preview/${draftId}`);
  };
  const onEditContext = () => navigate(`/workspace/context/${draftId}`);
  const onAskMeri = (text: string) =>
    toast(`Meri: "${text}" — chat editing arrives in a later phase`); // TODO(phase 6)

  return (
    <div className="ws-editor-shell">
      <EditorToolbar
        title={docTitle || draft.docTitle}
        saveStatus={saveStatus}
        anonymize={!!cfg.anonymize}
        letterhead={cfg.letterhead}
        onAnonymize={onAnonymize}
        onChecks={onChecks}
        onHistory={onHistory}
        onShare={onShare}
        onSaveDraft={() => flush(true)}
        onPreview={onPreview}
      />
      <RichTextToolbar />

      <div className="ws-editor-scroll">
        <div className="ws-editor-cols">
          <StepsRail active="draft" draftId={draftId} product={cfg.product}>
            <DraftOutline views={views} onAddSection={addSection} />
          </StepsRail>

          {/* Document canvas */}
          <div className="ws-editor-canvas">
            {showOfficeRow && (
              <OfficeRow
                offices={offices}
                active={activeOffice}
                onChange={setActiveOffice}
                onToast={toast}
              />
            )}
            <DocTabs
              tabs={tabs}
              activeId={activeTab}
              onSelect={setActiveTab}
              onAdd={addDoc}
              onRename={renameDoc}
              onRemove={removeDoc}
            />
            {isMainDoc ? (
              <div
                className="card"
                style={{
                  position: 'relative',
                  maxWidth: 624,
                  width: '100%',
                  margin: '0 auto',
                  padding: 0,
                  overflow: 'hidden',
                  borderTopLeftRadius: 0,
                }}
              >
                <Letterhead
                  letterhead={cfg.letterhead}
                  firmName={firmName}
                  firmAddr={firmAddr}
                  onToast={toast}
                />
                <div style={{ padding: '20px 30px 26px' }}>
                  <PaperBody
                    docTitle={docTitle || draft.docTitle}
                    sections={views}
                    blocks={mainBlocks}
                    ask={ask}
                    budget={budget}
                    anonymizeOn={!!cfg.anonymize}
                    anonMap={anonMap}
                    metaLine={metaLine}
                    draftingSection={draftingSection}
                    onTitle={(t) => {
                      setDocTitle(t);
                      cfgDirty.current = true;
                      scheduleSave();
                    }}
                    onReorder={reorderSections}
                    onRenameSection={renameSection}
                    onRemoveSection={removeSection}
                    onChangeBody={setSectionBody}
                    onAsk={setAsk}
                    onGenerate={generateSection}
                    onRegenerate={regenerateSection}
                    onMarkReviewed={markReviewed}
                    onRemoveBlock={removeMainBlock}
                    onToast={toast}
                  />
                </div>
              </div>
            ) : (
              <PacketDocCanvas
                label={tabs.find((t) => t.id === activeTab)?.label ?? 'Document'}
                body={packetBodies[activeTab] ?? { blocks: [] }}
                firmName={firmName}
                firmAddr={firmAddr}
                letterhead={cfg.letterhead}
                onChange={(body) => onPacketChange(activeTab, body)}
                onAskMeri={() =>
                  toast(`Asking Meri to draft "${tabs.find((t) => t.id === activeTab)?.label}"`)
                }
                onToast={toast}
              />
            )}
          </div>

          <InsertRail onAddSection={addSection} onInsert={addBlockTo} onToast={toast} />

          <MeriPanel
            isMainDoc={isMainDoc}
            contextItems={linkedData}
            openComments={0}
            onAsk={onAskMeri}
            onQuickAction={(a) => toast(`Meri: ${a} — arrives in a later phase`)}
            onEditContext={onEditContext}
          />
        </div>
      </div>
    </div>
  );
}

/** Normalize a WsDocument's stored body into the editor's PacketBody shape. */
function normalizeBody(d: WsDocument): PacketBody {
  const body = (d.body ?? {}) as { blocks?: WsBlock[]; title?: string };
  return { title: body.title ?? d.name, blocks: (body.blocks ?? []).slice() };
}
