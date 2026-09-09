import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { integrationsApi, type Integration } from '../lib/api';
import { clsx } from 'clsx';

const TYPE_OPTIONS: Array<Integration['type']> = ['shopware', 'ai', 'matterhorn', 'marketplace', 'custom'];

function IntegrationForm({ onCreated }: { onCreated: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<Integration['type']>('custom');
  const [endpoint, setEndpoint] = useState('');
  const [credKey, setCredKey] = useState('');
  const [credVal, setCredVal] = useState('');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const addCred = () => {
    const k = credKey.trim();
    const v = credVal.trim();
    if (!k) return;
    setCreds((prev) => ({ ...prev, [k]: v }));
    setCredKey('');
    setCredVal('');
  };

  const mut = useMutation({
    mutationFn: () => integrationsApi.create({ name: name.trim(), type, endpoint: endpoint.trim() || null, credentials: creds }),
    onSuccess: () => {
      setName(''); setEndpoint(''); setCreds({}); setError(null);
      qc.invalidateQueries({ queryKey: ['integrations'] });
      onCreated();
    },
    onError: (e: any) => setError(e?.response?.data?.error || e.message || 'Fehler'),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">Neue Integration</h3>
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shopware Live / OpenAI Key ..." className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required minLength={2} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Typ</label>
          <select value={type} onChange={(e) => setType(e.target.value as Integration['type'])} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Endpoint (optional)</label>
        <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://shop.example.com" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <div className="border rounded-lg p-3 bg-gray-50 space-y-2">
        <div className="text-sm font-medium text-gray-700">Credentials (Keys werden maskiert gespeichert, nie im Klartext angezeigt)</div>
        {Object.keys(creds).length > 0 && (
          <div className="text-xs space-y-1">
            {Object.entries(creds).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="font-mono bg-white border px-2 py-1 rounded">{k}: ****{v.slice(-4)}</span>
                <button type="button" onClick={() => setCreds((p) => { const n = { ...p }; delete n[k]; return n; })} className="text-red-600 text-xs">entfernen</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={credKey} onChange={(e) => setCredKey(e.target.value)} placeholder="Key (z. B. clientId, apiKey, token)" className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm" />
          <input value={credVal} onChange={(e) => setCredVal(e.target.value)} placeholder="Value" className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm" />
          <button type="button" onClick={addCred} className="px-3 py-1 text-sm bg-gray-900 text-white rounded hover:bg-black">+</button>
        </div>
      </div>
      <button type="submit" disabled={mut.isPending} className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
        {mut.isPending ? 'Speichert...' : 'Integration anlegen'}
      </button>
    </form>
  );
}

export function IntegrationsPage() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [testResult, setTestResult] = useState<Record<string, any>>({});

  const listQ = useQuery({
    queryKey: ['integrations', typeFilter],
    queryFn: () => integrationsApi.list(typeFilter || undefined).then((r) => r.integrations),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => integrationsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) => integrationsApi.update(id, { isEnabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => integrationsApi.test(id),
    onSuccess: (data, id) => setTestResult((prev) => ({ ...prev, [id as string]: (data as any).result })),
    onError: (e: any, id) => setTestResult((prev) => ({ ...prev, [id as string]: { ok: false, message: e?.response?.data?.error || e.message } })),
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Integrationen & API Keys</h1>
          <p className="text-sm text-gray-500">Zentrale Verwaltung aller externen Verbindungen. Credentials werden maskiert, Test-Button prueft Erreichbarkeit.</p>
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Alle Typen</option>
          {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <IntegrationForm onCreated={() => {}} />

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Konfigurierte Integrationen</h2>
          <span className="text-xs text-gray-500">{listQ.data?.length ?? 0} Eintraege</span>
        </div>
        {listQ.isLoading && <div className="p-6 text-sm text-gray-500">Laedt...</div>}
        {listQ.isError && <div className="p-6 text-sm text-red-600">Fehler beim Laden.</div>}
        {listQ.data && listQ.data.length === 0 && <div className="p-6 text-sm text-gray-500">Keine Integrationen vorhanden. Lege oben eine an.</div>}
        {listQ.data && listQ.data.length > 0 && (
          <div className="divide-y divide-gray-100">
            {listQ.data.map((row) => (
              <div key={row.id} className="p-4 flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{row.name}</span>
                    <span className={clsx('px-2 py-0.5 rounded text-xs font-medium', row.type === 'shopware' ? 'bg-blue-100 text-blue-700' : row.type === 'ai' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700')}>{row.type}</span>
                    <span className={clsx('px-2 py-0.5 rounded text-xs', row.isEnabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>{row.isEnabled ? 'aktiv' : 'deaktiviert'}</span>
                  </div>
                  {row.endpoint && <div className="text-sm text-gray-500 truncate">{row.endpoint}</div>}
                  <div className="text-xs text-gray-400 mt-1">Credentials: {Object.keys(row.credentials).length ? Object.entries(row.credentials).map(([k, v]) => `${k}=${v}`).join(', ') : '—'} {row.lastTestResult && <span className={clsx('ml-2', row.lastTestResult.ok ? 'text-green-600' : 'text-red-600')}>Letzter Test: {row.lastTestResult.ok ? 'OK' : 'FAIL'} {row.lastTestResult.message ? `(${row.lastTestResult.message})` : ''}</span>}</div>
                  {testResult[row.id] && (
                    <div className={clsx('mt-2 text-xs rounded p-2 border', testResult[row.id].ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700')}>
                      Test: {testResult[row.id].ok ? 'OK' : 'FAIL'} — {testResult[row.id].message} {testResult[row.id].latencyMs ? `(${testResult[row.id].latencyMs} ms)` : ''}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => testMut.mutate(row.id)} disabled={testMut.isPending} className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">Test</button>
                  <button onClick={() => toggleMut.mutate({ id: row.id, isEnabled: !row.isEnabled })} disabled={toggleMut.isPending} className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50">{row.isEnabled ? 'Deaktivieren' : 'Aktivieren'}</button>
                  <button onClick={() => { if (confirm(`Integration "${row.name}" loeschen?`)) deleteMut.mutate(row.id); }} className="px-3 py-1.5 text-xs bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100">Loeschen</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-400 border rounded-lg p-3 bg-gray-50">
        Hinweis: Shopware ENV (SHOPWARE_API_URL / CLIENT_ID / SECRET) bleibt parallel aktiv. Trage zusaetzlich eine Integration vom Typ <span className="font-mono">shopware</span> an, um Verbindungen UI-gefuehrt zu testen und zu verwalten. AI Provider referenzieren Integrations via <span className="font-mono">authSecretId</span>.
      </div>
    </div>
  );
}
