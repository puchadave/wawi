import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { shopwareApi, type ShopwareMapping, type SyncAttempt } from '../lib/api';
import { clsx } from 'clsx';

export function ShopwarePage() {
  const qc = useQueryClient();
  const [mappingFilter, setMappingFilter] = useState('');
  const [retryId, setRetryId] = useState('');
  const [retryMsg, setRetryMsg] = useState<string | null>(null);

  const statusQ = useQuery({
    queryKey: ['shopware-status'],
    queryFn: () => shopwareApi.getStatus(),
    refetchInterval: 15000,
  });

  const mappingsQ = useQuery({
    queryKey: ['shopware-mappings', mappingFilter],
    queryFn: () => shopwareApi.listMappings(mappingFilter ? { supplierProductId: mappingFilter } : {}).then((r) => r),
  });

  const attemptsQ = useQuery({
    queryKey: ['shopware-attempts'],
    queryFn: () => shopwareApi.listAttempts({ limit: 20 }).then((r) => r),
  });

  const queueQ = useQuery({
    queryKey: ['shopware-queue'],
    queryFn: () => shopwareApi.getQueue(),
  });

  const retryMut = useMutation({
    mutationFn: (id: string) => shopwareApi.retry(id),
    onSuccess: (data) => {
      setRetryMsg(`Retry queued: ${ (data as any).attemptId }`);
      qc.invalidateQueries({ queryKey: ['shopware-attempts'] });
      qc.invalidateQueries({ queryKey: ['shopware-queue'] });
    },
    onError: (e: any) => setRetryMsg(e?.response?.data?.error || e.message || 'Fehler'),
  });

  const mappings: ShopwareMapping[] = (mappingsQ.data as any)?.mappings ?? [];
  const attempts: SyncAttempt[] = (attemptsQ.data as any)?.attempts ?? statusQ.data?.stats?.recentAttempts ?? [];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Shopware</h1>
        <p className="text-sm text-gray-500">Verbindungen, Mappings-Historie, Sync-Versuche und Queue. Kein interner Shop — externe Shopware Instanz.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 text-sm">ENV Status</h3>
          <div className={clsx('mt-2 inline-flex px-2 py-1 rounded text-xs font-medium', statusQ.data?.envConfigured ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
            {statusQ.data ? (statusQ.data.envConfigured ? 'SHOPWARE_API_URL konfiguriert' : 'ENV nicht konfiguriert') : 'Laedt...'}
          </div>
          {statusQ.data?.queueError && <div className="mt-2 text-xs text-red-600">Queue: {statusQ.data.queueError}</div>}
          {statusQ.data?.queue && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              {Object.entries(statusQ.data.queue).map(([k, v]) => (
                <div key={k} className="bg-gray-50 border rounded p-2 text-center">
                  <div className="font-medium text-gray-900">{String(v)}</div>
                  <div className="text-gray-500">{k}</div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-xs text-gray-500">Mappings: {statusQ.data?.stats?.mappingsTotal ?? '—'} · Attempts: {statusQ.data?.stats?.attemptsTotal ?? '—'}</div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 text-sm">Shopware Integrationen</h3>
          {statusQ.isLoading && <div className="mt-2 text-xs text-gray-500">Laedt...</div>}
          {statusQ.data?.integrations && statusQ.data.integrations.length === 0 && <div className="mt-2 text-xs text-gray-500">Keine shopware-Integrationen. Lege unter Integrationen eine vom Typ shopware an.</div>}
          {statusQ.data?.integrations && statusQ.data.integrations.length > 0 && (
            <div className="mt-2 space-y-2">
              {statusQ.data.integrations.map((r) => (
                <div key={r.id} className="border rounded p-2 text-xs">
                  <div className="font-medium">{r.name} <span className={clsx('ml-1 px-1.5 py-0.5 rounded text-[10px]', r.isEnabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>{r.isEnabled ? 'aktiv' : 'off'}</span></div>
                  <div className="text-gray-500 truncate">{r.endpoint || '—'}</div>
                  <div className="text-gray-400">Creds: {Object.entries(r.credentials).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}</div>
                  {r.lastTestResult && <div className={clsx(r.lastTestResult.ok ? 'text-green-600' : 'text-red-600')}>Test: {r.lastTestResult.ok ? 'OK' : 'FAIL'} {r.lastTestResult.message}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 text-sm">Queue</h3>
          {queueQ.isLoading && <div className="mt-2 text-xs text-gray-500">Laedt...</div>}
          {queueQ.data && (
            <div className="mt-2 space-y-2 text-xs">
              <div className="flex flex-wrap gap-2">
                {Object.entries((queueQ.data as any).counts || {}).map(([k, v]) => (
                  <span key={k} className="px-2 py-1 bg-gray-100 rounded">{k}: {String(v)}</span>
                ))}
              </div>
              {(queueQ.data as any).sample?.failed?.length > 0 && (
                <div>
                  <div className="font-medium text-red-700">Failed sample</div>
                  {(queueQ.data as any).sample.failed.slice(0, 3).map((j: any) => (
                    <div key={j.id} className="border rounded p-1 mt-1 truncate">{j.id}: {j.failedReason || '—'}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {queueQ.isError && <div className="mt-2 text-xs text-red-600">Queue nicht erreichbar.</div>}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900">Sync erneut anstossen (Retry)</h3>
        <p className="text-xs text-gray-500 mt-1">Produkt muss approved/synced sein oder einen fehlgeschlagenen Versuch haben. Nutzt <span className="font-mono">POST /api/products/:id/sync/retry</span> und <span className="font-mono">POST /api/admin/shopware/retry/:id</span>.</p>
        <div className="mt-3 flex gap-2">
          <input value={retryId} onChange={(e) => setRetryId(e.target.value)} placeholder="supplierProductId (z. B. MH-12345)" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <button onClick={() => { setRetryMsg(null); if (retryId.trim()) retryMut.mutate(retryId.trim()); }} disabled={retryMut.isPending || !retryId.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {retryMut.isPending ? '...' : 'Retry'}
          </button>
        </div>
        {retryMsg && <div className="mt-2 text-xs rounded p-2 border bg-gray-50">{retryMsg}</div>}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
          <h2 className="font-semibold text-gray-900">Sync Attempts (Historie)</h2>
          <span className="text-xs text-gray-500">{attempts.length} letzte</span>
        </div>
        {attemptsQ.isLoading && <div className="p-6 text-sm text-gray-500">Laedt...</div>}
        {attempts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr><th className="text-left px-4 py-2">Produkt</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Job</th><th className="text-left px-4 py-2">Fehler</th><th className="text-left px-4 py-2">Zeit</th><th className="px-4 py-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {attempts.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{a.supplierProductId}</td>
                    <td className="px-4 py-2"><span className={clsx('px-2 py-0.5 rounded text-xs font-medium', a.status === 'completed' ? 'bg-green-100 text-green-700' : a.status === 'failed' ? 'bg-red-100 text-red-700' : a.status === 'running' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-700')}>{a.status}</span></td>
                    <td className="px-4 py-2 font-mono text-xs">{a.jobId || '—'}</td>
                    <td className="px-4 py-2 text-xs text-red-600 truncate max-w-[28ch]">{a.error || '—'}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{new Date(a.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2"><button onClick={() => { setRetryId(a.supplierProductId); setRetryMsg(null); }} className="text-xs text-blue-600 hover:underline">Retry</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="p-6 text-sm text-gray-500">Keine Attempts vorhanden.</div>}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
          <h2 className="font-semibold text-gray-900">Shopware Mappings</h2>
          <input value={mappingFilter} onChange={(e) => setMappingFilter(e.target.value)} placeholder="Filter supplierProductId" className="ml-auto rounded border border-gray-300 px-2 py-1 text-xs" />
        </div>
        {mappingsQ.isLoading && <div className="p-6 text-sm text-gray-500">Laedt...</div>}
        {mappings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr><th className="text-left px-4 py-2">Produkt</th><th className="text-left px-4 py-2">Typ</th><th className="text-left px-4 py-2">Shopware UUID</th><th className="text-left px-4 py-2">Synced</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mappings.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2"><span className="font-mono text-xs">{m.supplierProductId}</span>{m.productName && <span className="ml-2 text-xs text-gray-500">{m.productName}</span>}</td>
                    <td className="px-4 py-2 text-xs">{m.entityType}</td>
                    <td className="px-4 py-2 font-mono text-xs">{m.shopwareUuid}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{new Date(m.syncedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="p-6 text-sm text-gray-500">Keine Mappings vorhanden.</div>}
      </div>
    </div>
  );
}
