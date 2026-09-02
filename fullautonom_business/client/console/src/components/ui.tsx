import { useCallback, useEffect, useState } from 'react';

export function useModuleData<T>(fetcher: () => Promise<T>, deps: unknown[] = [], intervalMs = 10000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetcher());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
    const iv = setInterval(load, intervalMs);
    return () => clearInterval(iv);
  }, [load, intervalMs]);

  return { data, error, loading, reload: load };
}

export function PanelCard({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="panel-card">
      <div className="panel-card-head">
        <span>{title}</span>
        {accent && <span className="panel-accent">{accent}</span>}
      </div>
      <div className="panel-card-body">{children}</div>
    </div>
  );
}

export function Metric({ label, value, unit, ok }: { label: string; value: number | string; unit?: string; ok?: boolean }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className={`metric-value ${ok === true ? 'ok' : ok === false ? 'warn' : ''}`}>
        {value}{unit && <small> {unit}</small>}
      </span>
    </div>
  );
}

export function LoadingOrError({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <div className="hint">Lade Daten …</div>;
  if (error) return <div className="hint warn">Modul offline: {error}</div>;
  return null;
}