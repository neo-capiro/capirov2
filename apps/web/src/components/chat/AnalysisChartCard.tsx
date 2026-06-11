import { useEffect, useState } from 'react';
import { useApi } from '../../lib/use-api.js';

interface AnalysisChartCardProps {
  artifactId: string;
  title: string;
}

/**
 * Inline chart card for `analysis_chart` artifacts (F4). These stream with an
 * empty bodyText; the PNG body is served by the authenticated
 * GET /api/clio/artifacts/:id/image endpoint. An <img src> can't carry the
 * bearer token, so the image is lazy-fetched as a blob via the axios client
 * and rendered through an object URL (revoked on unmount).
 */
export function AnalysisChartCard({ artifactId, title }: AnalysisChartCardProps) {
  const api = useApi();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setFailed(false);
    void (async () => {
      try {
        const res = await api.get<Blob>(`/api/clio/artifacts/${artifactId}/image`, {
          responseType: 'blob',
        });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, artifactId]);

  return (
    <figure className="chat-chart-card">
      {failed ? (
        <div className="chat-chart-card-error" role="status">
          Chart unavailable
        </div>
      ) : src ? (
        <img className="chat-chart-card-img" src={src} alt={title} />
      ) : (
        <div className="chat-chart-card-loading" aria-label="Loading chart" />
      )}
      <figcaption className="chat-chart-card-caption">{title}</figcaption>
    </figure>
  );
}
