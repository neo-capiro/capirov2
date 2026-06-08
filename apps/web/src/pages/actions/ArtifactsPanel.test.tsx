import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { ArtifactsPanel } from './ArtifactsPanel.js';
import type { GeneratedArtifact } from './artifacts-api.js';

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
const apiPatchMock = vi.fn();

vi.mock('../../lib/use-api.js', () => ({
  useApi: () => ({
    get: apiGetMock,
    post: apiPostMock,
    patch: apiPatchMock,
  }),
}));

function setupBrowserMocks() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);

  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  }
}

const clipboardWriteMock = vi.fn().mockResolvedValue(undefined);

const BODY_V1 =
  'House Armed Services Committee marked PE 0603270A at $537M, +$50M over request.\n\nSources\n[c1] Budget delta — HASC markup p.42\n\nCaveats\nProgram match is high confidence.';

function artifact(overrides: Partial<GeneratedArtifact> = {}): GeneratedArtifact {
  return {
    id: 'art-1',
    title: 'HASC adds $50M to PE 0603270A',
    kind: 'artifact_committee_staff_memo',
    bodyText: BODY_V1,
    metadata: {
      actionId: 'act-1',
      claimIds: ['c1'],
      verification: { ok: true, rejected: [] },
      version: 1,
      artifactType: 'committee_staff_memo',
    },
    ...overrides,
  };
}

function renderPanel(opts: { existing?: GeneratedArtifact[] } = {}) {
  const existing = opts.existing ?? [];
  apiGetMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/artifacts')) return { data: existing };
    return { data: [] };
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AntApp>
        <ArtifactsPanel actionId="act-1" suggestedArtifactType="committee_staff_memo" enabled />
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('ArtifactsPanel', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    apiPatchMock.mockReset();
    clipboardWriteMock.mockClear();
    setupBrowserMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteMock },
    });
  });

  test('honest empty state when there are no artifacts', async () => {
    renderPanel({ existing: [] });
    await waitFor(() =>
      expect(screen.getByText(/No artifacts generated yet/i)).toBeInTheDocument(),
    );
  });

  test('generating an artifact posts {type}, renders it, and opens the viewer with bodyText', async () => {
    apiPostMock.mockResolvedValue({ data: artifact() });
    renderPanel({ existing: [] });

    await waitFor(() => expect(screen.getByText(/No artifacts generated yet/i)).toBeInTheDocument());

    // The convenience "Generate <suggested>" button posts the suggested type.
    const generateBtn = screen.getByRole('button', { name: /Generate Committee Staff Memo/i });
    fireEvent.click(generateBtn);

    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith('/api/intelligence/actions/act-1/artifacts', {
        type: 'committee_staff_memo',
      }),
    );

    // The freshly generated artifact opens straight into the viewer with its bodyText.
    const body = await screen.findByTestId('artifact-body');
    expect(body.textContent).toContain('House Armed Services Committee marked PE 0603270A');
    expect(body.textContent).toContain('Sources');
    expect(body.textContent).toContain('Caveats');
  });

  test('lists existing artifacts (type badge + version); clicking one opens the viewer + copy works', async () => {
    renderPanel({ existing: [artifact()] });

    // Row in the list
    const row = await screen.findByText('HASC adds $50M to PE 0603270A');
    expect(screen.getByText('v1')).toBeInTheDocument();

    fireEvent.click(row);

    // Viewer shows the bodyText
    const body = await screen.findByTestId('artifact-body');
    expect(body.textContent).toContain('+$50M over request');

    // Copy-to-clipboard (the icon contributes its own aria-label, so match loosely)
    const copyBtn = screen.getByRole('button', { name: /Copy/i });
    fireEvent.click(copyBtn);
    await waitFor(() => expect(clipboardWriteMock).toHaveBeenCalledTimes(1));
    expect(clipboardWriteMock.mock.calls[0]?.[0]).toContain('+$50M over request');
  });

  test('edit mode PATCHes bodyText', async () => {
    apiPatchMock.mockResolvedValue({
      data: artifact({ bodyText: 'Edited body', metadata: { ...artifact().metadata, version: 2 } }),
    });
    renderPanel({ existing: [artifact()] });

    fireEvent.click(await screen.findByText('HASC adds $50M to PE 0603270A'));
    await screen.findByTestId('artifact-body');

    // Enter edit mode (the icon contributes its own aria-label, so match loosely)
    fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
    const editor = await screen.findByLabelText('Artifact body');
    fireEvent.change(editor, { target: { value: 'Edited body' } });

    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(apiPatchMock).toHaveBeenCalledWith('/api/intelligence/artifacts/art-1', {
        bodyText: 'Edited body',
      }),
    );
  });

  test('shows a subtle "dropped as unsourced" note when verification rejected paragraphs', async () => {
    const dropped = artifact({
      id: 'art-2',
      metadata: {
        actionId: 'act-1',
        claimIds: ['c1'],
        verification: { ok: false, rejected: [{ index: 2, reason: 'unsourced numeral' }] },
        version: 1,
        artifactType: 'committee_staff_memo',
      },
    });
    renderPanel({ existing: [dropped] });

    fireEvent.click(await screen.findByText('HASC adds $50M to PE 0603270A'));
    const viewer = await screen.findByTestId('artifact-body');
    const drawer = viewer.closest('.ant-drawer-content') ?? document.body;
    expect(within(drawer as HTMLElement).getByText(/1 paragraph dropped as unsourced/i)).toBeInTheDocument();
  });
});
