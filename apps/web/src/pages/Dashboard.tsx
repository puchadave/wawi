import { useQuery } from '@tanstack/react-query';
import { adminStatsApi, productApi, matterhornApi } from '../lib/api';
import { aiApi } from '../lib/ai';

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue' }) {
  const tones: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-blue-100 text-blue-700',
  };
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Dashboard() {
  const statsQ = useQuery({ queryKey: ['admin-stats'], queryFn: () => adminStatsApi.get() });
  const productsQ = useQuery({ queryKey: ['dashboard-products'], queryFn: () => productApi.list({ limit: 5 }) });
  const matterhornQ = useQuery({ queryKey: ['dashboard-matterhorn'], queryFn: () => matterhornApi.listConnections() });
  const importJobsQ = useQuery({ queryKey: ['dashboard-import-jobs'], queryFn: () => matterhornApi.listJobs({ limit: 5 }) });
  const aiProvidersQ = useQuery({ queryKey: ['dashboard-ai-providers'], queryFn: () => aiApi.listProviders() });

  if (statsQ.isLoading) {
    return <div className="p-6 text-gray-500">Lade Dashboard …</div>;
  }
  if (statsQ.isError) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-700">
          Fehler beim Laden der Stats: {(statsQ.error as Error).message}
        </div>
      </div>
    );
  }

  const s = statsQ.data!;
  const queues = s.queues as Record<string, Record<string, number>> | undefined;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        <div className="text-xs text-gray-400">Stand: {new Date(s.generatedAt).toLocaleString('de-DE')}</div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Produkte" value={s.products.total} sub={Object.entries(s.products.byStatus).map(([k, v]) => `${k}:${v}`).join(' · ') || '—'} />
        <StatCard label="Varianten" value={s.variants.total} />
        <StatCard label="Sync failed / total" value={`${s.sync.failed} / ${s.sync.total}`} sub={`Mappings: ${s.sync.mappings}`} />
        <StatCard label="Integrationen" value={s.integrations.total} sub={`Provider: ${s.ai.providers} · Matterhorn: ${s.imports.matterhornConnections}`} />
      </div>

      {/* Split-Inspector: Product / AI / Sync parallel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Product */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Produkte</h2>
            <Badge tone="blue">{s.products.total} gesamt</Badge>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(s.products.byStatus).map(([status, count]) => (
                <Badge key={status} tone={status === 'synced' ? 'green' : status === 'approved' ? 'blue' : status === 'rejected' ? 'red' : status === 'reviewed' ? 'amber' : 'gray'}>
                  {status}: {String(count)}
                </Badge>
              ))}
              {Object.keys(s.products.byStatus).length === 0 && <span className="text-xs text-gray-400">Keine Produkte</span>}
            </div>
            {productsQ.data?.products?.length ? (
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded">
                {productsQ.data.products.slice(0, 5).map((p) => (
                  <li key={p.supplierProductId} className="px-3 py-2 flex items-center justify-between">
                    <span className="text-sm text-gray-900 truncate pr-2">{p.name}</span>
                    <Badge tone={p.status === 'synced' ? 'green' : p.status === 'approved' ? 'blue' : 'gray'}>{p.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-400">Keine Vorschau verfügbar.</p>
            )}
            <div className="text-xs text-gray-500">
              Queues — Sync: {queues?.sync ? JSON.stringify(queues.sync) : '—'} · Media: {queues?.media ? JSON.stringify(queues.media) : '—'}
            </div>
          </div>
        </div>

        {/* AI */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">AI Pipeline</h2>
            <Badge tone="blue">{s.ai.providers} Provider</Badge>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(s.ai.byStatus).map(([status, count]) => (
                <Badge key={status} tone={status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'running' ? 'amber' : 'gray'}>
                  {status}: {String(count)}
                </Badge>
              ))}
              {Object.keys(s.ai.byStatus).length === 0 && <span className="text-xs text-gray-400">Keine Runs</span>}
            </div>
            <div className="text-xs text-gray-500">
              Provider: {aiProvidersQ.data?.length ?? '—'} konfiguriert · Prompt/Pipeline in <span className="font-medium">AI Engine</span>
            </div>
            <div className="text-xs text-gray-400">byStatus spiegelt ai_processing_runs wider.</div>
          </div>
        </div>

        {/* Sync / Imports */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Sync & Import</h2>
            <Badge tone={s.sync.failed > 0 ? 'red' : 'green'}>{s.sync.failed} failed</Badge>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(s.imports.byStatus).map(([status, count]) => (
                <Badge key={status} tone={status === 'completed' ? 'green' : status === 'failed' ? 'red' : 'amber'}>
                  {status}: {String(count)}
                </Badge>
              ))}
              {Object.keys(s.imports.byStatus).length === 0 && <span className="text-xs text-gray-400">Keine Import-Jobs</span>}
            </div>
            <div className="text-xs text-gray-500">Matterhorn Connections: {(matterhornQ.data as { connections: unknown[] })?.connections?.length ?? '—'} · Mappings: {s.sync.mappings}</div>
            {(importJobsQ.data as { jobs: { id: string; status: string; createdAt: string }[] })?.jobs?.length ? (
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded">
                {(importJobsQ.data as { jobs: { id: string; status: string; createdAt: string }[] }).jobs.slice(0, 5).map((j) => (
                  <li key={j.id} className="px-3 py-2 flex items-center justify-between">
                    <span className="text-xs font-mono text-gray-700 truncate pr-2">{j.id.slice(0, 8)}…</span>
                    <Badge tone={j.status === 'completed' ? 'green' : j.status === 'failed' ? 'red' : 'amber'}>{j.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-400">Keine Jobs.</p>
            )}
          </div>
        </div>
      </div>

      {/* Service health hint */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-900">Service Health</h3>
        <p className="text-xs text-gray-500 mt-1">Stats-Endpoint ist best-effort. Queues werden via BullMQ getJobCounts gelesen — bei Redis-Ausfall bleibt das Dashboard erreichbar (queues: {}).</p>
        <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-auto max-h-40">{JSON.stringify(s, null, 2)}</pre>
      </div>
    </div>
  );
}
