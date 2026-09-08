import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { matterhornApi, type MatterhornConnection } from '../lib/api';
import { clsx } from 'clsx';

const TYPE_OPTIONS: Array<MatterhornConnection['type']> = ['xml', 'matterhorn', 'csv', 'json', 'api', 'ftp', 'sftp'];

function ConnectionForm({ onCreated }: { onCreated: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<MatterhornConnection['type']>('xml');
  const [endpoint, setEndpoint] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => matterhornApi.createConnection({ name: name.trim(), type, endpoint: endpoint.trim() || null }),
    onSuccess: () => {
      setName(''); setEndpoint(''); setError(null);
      qc.invalidateQueries({ queryKey: ['matterhorn-connections'] });
      onCreated();
    },
    onError: (e: any) => setError(e?.response?.data?.error || e.message || 'Fehler'),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
      className="bg-white rounded-lg border border-gray-200 p-4 space-y-3"
    >
      <h3 className="font-semibold text-gray-900">Neue Verbindung</h3>
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
      <div>
        <label className="block text-sm font-medium text-gray-700">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Matterhorn Hauptfeed" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required minLength={2} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Typ</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Endpoint (optional)</label>
          <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://lieferant.example/feed.xml" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <button type="submit" disabled={mut.isPending} className="action-button primary disabled:opacity-50">{mut.isPending ? 'Anlegen …' : 'Verbindung anlegen'}</button>
      <p className="text-xs text-gray-500">CSV/JSON/API/FTP/SFTP nur Typ-Platzhalter in P0 — Import nur für xml/matterhorn.</p>
    </form>
  );
}

function ImportDrop({ connectionId }: { connectionId: string }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (file: File) => matterhornApi.importXml(connectionId, file),
    onSuccess: (data) => {
      const d = data as unknown as { importedCount: number; failedCount: number; jobId: string };
      setResult(`${d.importedCount} importiert, ${d.failedCount} Fehler (Job ${d.jobId.slice(0, 8)})`);
      qc.invalidateQueries({ queryKey: ['matterhorn-jobs'] });
    },
    onError: (e: any) => setResult(e?.response?.data?.error || e.message || 'Import fehlgeschlagen'),
  });

  return (
    <div>
      <label className={clsx('block rounded-lg border-2 border-dashed p-4 text-center text-sm cursor-pointer', mut.isPending ? 'border-blue-300 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100')}>
        <input
          type="file"
          accept=".xml,application/xml,text/xml"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) mut.mutate(f); e.target.value = ''; }}
          disabled={mut.isPending}
        />
        {mut.isPending ? 'Import läuft …' : 'XML wählen oder hier ablegen'}
      </label>
      {result && <p className="mt-2 text-xs text-gray-600 break-words">{result}</p>}
    </div>
  );
}

export function MatterhornPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['matterhorn-connections'],
    queryFn: () => matterhornApi.listConnections(),
  });
  const { data: jobsData } = useQuery({
    queryKey: ['matterhorn-jobs'],
    queryFn: () => matterhornApi.listJobs({ limit: 20 }),
  });

  const connections = data?.connections ?? [];
  const jobs = jobsData?.jobs ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, any>>({});

  const testMut = useMutation({
    mutationFn: (id: string) => matterhornApi.testConnection(id),
    onSuccess: (res, id) => {
      setTestResult((prev) => ({ ...prev, [id as unknown as string]: (res as any).result }));
      qc.invalidateQueries({ queryKey: ['matterhorn-connections'] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => matterhornApi.deleteConnection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matterhorn-connections'] }),
  });

  const detailJobQuery = useQuery({
    queryKey: ['matterhorn-job', selectedId],
    queryFn: () => matterhornApi.getJob(selectedId!),
    enabled: !!selectedId,
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Matterhorn</h1>
        <p className="text-sm text-gray-500">Verbindungen, Import-Jobs, Mapping · Kanonisch → Canonical WaWi</p>
      </header>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{String((error as any)?.message || (error as any))}</div>}
      {isLoading && <div className="text-sm text-gray-500">Lade …</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <ConnectionForm onCreated={() => {}} />

          <div className="bg-white rounded-lg border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200 font-medium text-sm text-gray-900">Verbindungen ({connections.length})</div>
            <div className="divide-y divide-gray-100">
              {connections.length === 0 && <div className="p-4 text-sm text-gray-500">Noch keine Verbindung.</div>}
              {connections.map((c) => (
                <div key={c.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-gray-900">{c.name} <span className="text-xs text-gray-500">· {c.type}</span> {c.isEnabled ? '' : <span className="text-xs text-amber-600">(deaktiviert)</span>}</div>
                      <div className="text-xs text-gray-500 break-all">{c.endpoint || '—'}</div>
                      {c.lastTestResult && <div className={clsx('text-xs mt-1', c.lastTestResult.ok ? 'text-green-600' : 'text-red-600')}>Letzter Test: {c.lastTestResult.ok ? 'OK' : 'Fehler'} · {c.lastTestResult.latencyMs} ms · {c.lastTestResult.message}</div>}
                      {testResult[c.id] && <div className={clsx('text-xs', testResult[c.id].ok ? 'text-green-600' : 'text-red-600')}>Test: {testResult[c.id].ok ? 'OK' : 'Fehler'} · {testResult[c.id].latencyMs} ms · {testResult[c.id].message}</div>}
                    </div>
                    <span className={clsx('text-xs px-2 py-1 rounded', c.isEnabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600')}>{c.isEnabled ? 'aktiv' : 'inaktiv'}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => testMut.mutate(c.id)} disabled={testMut.isPending} className="text-xs px-3 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50">Testen</button>
                    <button onClick={() => deleteMut.mutate(c.id)} disabled={deleteMut.isPending} className="text-xs px-3 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50">Löschen</button>
                  </div>
                  {(c.type === 'xml' || c.type === 'matterhorn') ? <ImportDrop connectionId={c.id} /> : <p className="text-xs text-gray-400">Import für Typ &quot;{c.type}&quot; in P0 nicht aktiv.</p>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200 font-medium text-sm text-gray-900 flex items-center justify-between">
              <span>Import-Historie ({jobs.length})</span>
              <button onClick={() => qc.invalidateQueries({ queryKey: ['matterhorn-jobs'] })} className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">Neu laden</button>
            </div>
            <div className="divide-y divide-gray-100 max-h-[420px] overflow-auto">
              {jobs.length === 0 && <div className="p-4 text-sm text-gray-500">Noch keine Jobs.</div>}
              {jobs.map((j) => (
                <button key={j.id} onClick={() => setSelectedId(j.id)} className={clsx('w-full text-left p-3 text-sm hover:bg-gray-50', selectedId === j.id && 'bg-blue-50')}>
                  <div className="flex items-center justify-between"><span className="font-medium">{j.status}</span><span className="text-xs text-gray-500">{new Date(j.createdAt).toLocaleString()}</span></div>
                  <div className="text-xs text-gray-600">importiert {j.importedCount} · Fehler {j.failedCount} · gesamt {j.totalProducts}</div>
                  {j.error && <div className="text-xs text-red-600 truncate">{j.error}</div>}
                </button>
              ))}
            </div>
          </div>

          {selectedId && (
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="px-4 py-3 border-b border-gray-200 font-medium text-sm">Job {selectedId.slice(0, 8)} Logs</div>
              <div className="p-3 max-h-[320px] overflow-auto space-y-1">
                {detailJobQuery.isLoading && <div className="text-xs text-gray-500">Lade Logs …</div>}
                {detailJobQuery.data?.logs.length === 0 && <div className="text-xs text-gray-500">Keine Logs.</div>}
                {detailJobQuery.data?.logs.map((l: any) => (
                  <div key={l.id} className={clsx('text-xs rounded px-2 py-1', l.level === 'error' ? 'bg-red-50 text-red-700' : l.level === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-700')}>
                    <span className="font-medium">[{l.level}]</span> {l.message}
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 border-t flex justify-end"><button onClick={() => setSelectedId(null)} className="text-xs px-3 py-1 rounded border">Schließen</button></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
