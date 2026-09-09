import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { aiApi, type AiProvider, type AiModel, type AiPrompt, type AiProcessorInfo } from '../lib/ai';

const PROVIDER_TYPES: Array<AiProvider['type']> = ['openai', 'openai-compatible', 'anthropic'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{title}</h3>
      {children}
    </section>
  );
}

function ProvidersPanel() {
  const qc = useQueryClient();
  const { data: providers, isLoading, error } = useQuery({ queryKey: ['ai-providers'], queryFn: aiApi.listProviders });
  const [name, setName] = useState('');
  const [type, setType] = useState<AiProvider['type']>('openai');
  const [endpoint, setEndpoint] = useState('');
  const [envVar, setEnvVar] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => aiApi.createProvider({ name: name.trim(), type, endpoint: endpoint.trim() || null, apiKeyEnvVar: envVar.trim() || null }),
    onSuccess: () => { setName(''); setEndpoint(''); setEnvVar(''); setFormError(null); qc.invalidateQueries({ queryKey: ['ai-providers'] }); },
    onError: (e: any) => setFormError(e?.response?.data?.error || e.message || 'Fehler'),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => aiApi.deleteProvider(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-providers'] }),
  });
  const testMut = useMutation({
    mutationFn: (id: string) => aiApi.testProvider(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-providers'] }),
  });

  if (isLoading) return <div className="text-sm text-gray-500">Lade Anbieter…</div>;
  if (error) return <div className="text-sm text-red-600">Fehler beim Laden der Anbieter</div>;

  return (
    <Section title="KI-Anbieter">
      <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-3">
        {formError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{formError}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenAI prod" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required minLength={2} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Typ</label>
            <select value={type} onChange={(e) => setType(e.target.value as AiProvider['type'])} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              {PROVIDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">Endpoint (optional)</label>
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.openai.com/v1" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">API-Key ENV Var</label>
            <input value={envVar} onChange={(e) => setEnvVar(e.target.value)} placeholder="OPENAI_API_KEY" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
        </div>
        <button type="submit" disabled={createMut.isPending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Anbieter anlegen</button>
      </form>

      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
        {!providers?.length && <div className="p-3 text-sm text-gray-500">Keine Anbieter konfiguriert.</div>}
        {providers?.map((p) => (
          <div key={p.id} className="flex items-center justify-between p-3 text-sm">
            <div>
              <div className="font-medium text-gray-900">{p.name} <span className="text-xs text-gray-500">({p.type})</span></div>
              <div className="text-xs text-gray-600">{p.endpoint || '—'} · ENV: {p.apiKeyEnvVar || '—'} · {p.isEnabled ? 'aktiv' : 'inaktiv'}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => testMut.mutate(p.id)} disabled={testMut.isPending} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Test</button>
              <button onClick={() => { if (confirm(`Anbieter "${p.name}" löschen?`)) delMut.mutate(p.id); }} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">Löschen</button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">API-Keys werden nie in der DB gespeichert — nur der Name der Env-Var (z. B. OPENAI_API_KEY). Secret bleibt in .env / Swarm-Secret.</p>
    </Section>
  );
}

function ModelsPanel() {
  const qc = useQueryClient();
  const { data: providers } = useQuery({ queryKey: ['ai-providers'], queryFn: aiApi.listProviders });
  const { data: models, isLoading } = useQuery({ queryKey: ['ai-models'], queryFn: aiApi.listModels });
  const [providerId, setProviderId] = useState('');
  const [modelName, setModelName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => aiApi.createModel({ providerId, modelName: modelName.trim() }),
    onSuccess: () => { setModelName(''); setError(null); qc.invalidateQueries({ queryKey: ['ai-models'] }); },
    onError: (e: any) => setError(e?.response?.data?.error || e.message || 'Fehler'),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => aiApi.deleteModel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-models'] }),
  });

  if (isLoading) return <div className="text-sm text-gray-500">Lade Modelle…</div>;

  return (
    <Section title="KI-Modelle">
      <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-3">
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">Anbieter</label>
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required>
              <option value="">— wählen —</option>
              {providers?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.type})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Model-Name</label>
            <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="gpt-4o-mini" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required minLength={1} />
          </div>
        </div>
        <button type="submit" disabled={createMut.isPending || !providerId} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Modell anlegen</button>
      </form>
      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
        {!models?.length && <div className="p-3 text-sm text-gray-500">Keine Modelle.</div>}
        {models?.map((m: AiModel) => (
          <div key={m.id} className="flex items-center justify-between p-3 text-sm">
            <div>
              <div className="font-medium">{m.modelName}</div>
              <div className="text-xs text-gray-600">Provider: {providers?.find((p) => p.id === m.providerId)?.name ?? m.providerId} · {m.isEnabled ? 'aktiv' : 'inaktiv'}</div>
            </div>
            <button onClick={() => { if (confirm(`Modell "${m.modelName}" löschen?`)) delMut.mutate(m.id); }} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">Löschen</button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function PromptsPanel() {
  const qc = useQueryClient();
  const { data: prompts, isLoading } = useQuery({ queryKey: ['ai-prompts'], queryFn: aiApi.listPrompts });
  const [name, setName] = useState('');
  const [version, setVersion] = useState('v1');
  const [template, setTemplate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => aiApi.createPrompt({ name: name.trim(), version: version.trim(), template }),
    onSuccess: () => { setName(''); setTemplate(''); setError(null); qc.invalidateQueries({ queryKey: ['ai-prompts'] }); },
    onError: (e: any) => setError(e?.response?.data?.error || e.message || 'Fehler'),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => aiApi.deletePrompt(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-prompts'] }),
  });

  if (isLoading) return <div className="text-sm text-gray-500">Lade Prompts…</div>;

  return (
    <Section title="KI-Prompts">
      <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-3">
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Titel-Optimierung" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Version</label>
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Template (mit Variablen wie {'{{name}}'}, {'{{brand}}'}, {'{{descriptionHtml}}'})</label>
          <textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={4} placeholder="Du bist ein E-Commerce Texter…" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required />
        </div>
        <button type="submit" disabled={createMut.isPending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Prompt anlegen</button>
      </form>
      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
        {!prompts?.length && <div className="p-3 text-sm text-gray-500">Keine Prompts.</div>}
        {prompts?.map((pr: AiPrompt) => (
          <div key={pr.id} className="flex items-start justify-between p-3 text-sm gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{pr.name} <span className="text-xs text-gray-500">· {pr.version}</span></div>
              <div className="text-xs text-gray-600 truncate">{pr.template.slice(0, 160)}</div>
            </div>
            <button onClick={() => { if (confirm(`Prompt "${pr.name}" löschen?`)) delMut.mutate(pr.id); }} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100 shrink-0">Löschen</button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ProcessorsPanel() {
  const { data: procs, isLoading } = useQuery({ queryKey: ['ai-processors'], queryFn: aiApi.listProcessors });
  if (isLoading) return <div className="text-sm text-gray-500">Lade Prozessoren…</div>;
  return (
    <Section title="Verfuegbare Prozessoren (Pipeline-Bausteine)">
      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
        {!procs?.length && <div className="p-3 text-sm text-gray-500">Keine Prozessoren registriert.</div>}
        {procs?.map((p: AiProcessorInfo) => (
          <div key={p.name} className="p-3 text-sm">
            <div className="font-medium text-gray-900">{p.label} <span className="text-xs text-gray-500">— {p.name}</span></div>
            <div className="text-xs text-gray-600">{p.description} · Felder: {p.fields.join(', ')}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">Die Pipeline kombiniert mehrere Prozessoren pro Lauf (z. B. title + description). Ergebnis landet ausschliesslich in aiData — Quelldaten/manualData bleiben unangetastet.</p>
    </Section>
  );
}

function RunsPanel() {
  const [productId, setProductId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [promptId, setPromptId] = useState('');
  const [processorNames, setProcessorNames] = useState('title');
  const { data: providers } = useQuery({ queryKey: ['ai-providers'], queryFn: aiApi.listProviders });
  const { data: models } = useQuery({ queryKey: ['ai-models'], queryFn: aiApi.listModels });
  const { data: prompts } = useQuery({ queryKey: ['ai-prompts'], queryFn: aiApi.listPrompts });
  const { data: processors } = useQuery({ queryKey: ['ai-processors'], queryFn: aiApi.listProcessors });
  const qc = useQueryClient();

  const { data: runs } = useQuery({
    queryKey: ['ai-runs', productId],
    queryFn: () => aiApi.listRuns(productId ? { productId } : { limit: 20 }),
  });

  const runMut = useMutation({
    mutationFn: () => aiApi.run({
      productId: productId.trim(),
      providerId,
      modelId,
      promptId: promptId || null,
      processorNames: processorNames.split(',').map((s) => s.trim()).filter(Boolean),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-runs'] }),
  });

  return (
    <Section title="KI-Pipeline ausfuehren & Historie">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        Pipeline schreibt nur in <code>aiData</code>. Prioritaet: manualData &gt; aiData &gt; Quelldaten. Kein API-Key verlässt die .env.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Produkt-ID (supplierProductId)</label>
          <input value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="z. B. MH-12345" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Prozessoren (komma-separiert)</label>
          <input value={processorNames} onChange={(e) => setProcessorNames(e.target.value)} placeholder="title,description" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <div className="text-xs text-gray-500 mt-1">verfuegbar: {processors?.map((p) => p.name).join(', ') || '—'}</div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Anbieter</label>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">— wählen —</option>
            {providers?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Modell</label>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">— wählen —</option>
            {models?.map((m) => <option key={m.id} value={m.id}>{m.modelName}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700">Prompt (optional)</label>
          <select value={promptId} onChange={(e) => setPromptId(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">— kein Prompt (nutzt Prozessor-Defaults) —</option>
            {prompts?.map((pr) => <option key={pr.id} value={pr.id}>{pr.name} ({pr.version})</option>)}
          </select>
        </div>
      </div>
      <button onClick={() => runMut.mutate()} disabled={runMut.isPending || !productId || !providerId || !modelId} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Pipeline starten</button>
      {runMut.isError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{(runMut.error as any)?.response?.data?.error || (runMut.error as Error).message}</div>}
      {runMut.isSuccess && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">Run {(runMut.data as any)?.runId || ''} — Status {(runMut.data as any)?.status || 'ok'} · Aenderungen: {((runMut.data as any)?.changes?.length ?? 0)}</div>}

      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden max-h-[380px] overflow-auto">
        {!runs?.length && <div className="p-3 text-sm text-gray-500">Keine Runs.</div>}
        {runs?.map((r) => (
          <div key={r.id} className="p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.runName}</span>
              <span className={r.status === 'completed' ? 'text-emerald-600' : r.status === 'failed' ? 'text-red-600' : 'text-amber-600'}>{r.status}</span>
            </div>
            <div className="text-xs text-gray-600">Produkt {r.productId || '—'} · {new Date(r.createdAt).toLocaleString()} · Änderungen: {r.changes?.length ?? 0}</div>
            {r.error && <div className="text-xs text-red-600">{r.error.slice(0, 400)}</div>}
            {r.changes?.length ? <div className="mt-1 text-xs text-gray-700 space-y-1">{r.changes.map((c, i) => <div key={i} className="rounded bg-gray-50 border border-gray-100 p-1"><span className="font-medium">{c.field}</span> via {c.processor}: <span className="text-gray-500 line-through">{String(c.originalValue ?? '∅').slice(0, 80)}</span> → {String(c.modifiedValue).slice(0, 120)}</div>)}</div> : null}
          </div>
        ))}
      </div>
    </Section>
  );
}

export function AdminAi() {
  const [tab, setTab] = useState<'providers' | 'models' | 'prompts' | 'processors' | 'runs'>('providers');

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">KI-Verwaltung</h1>
        <p className="text-sm text-gray-600">Anbieter · Modelle · Prompts · Pipeline. Secrets nur via ENV — nie in der DB.</p>
      </div>

      <div className="flex gap-2 border-b border-gray-200 pb-2 flex-wrap">
        {(['providers','models','prompts','processors','runs'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {t === 'providers' ? 'Anbieter' : t === 'models' ? 'Modelle' : t === 'prompts' ? 'Prompts' : t === 'processors' ? 'Prozessoren' : 'Runs'}
          </button>
        ))}
      </div>

      {tab === 'providers' && <ProvidersPanel />}
      {tab === 'models' && <ModelsPanel />}
      {tab === 'prompts' && <PromptsPanel />}
      {tab === 'processors' && <ProcessorsPanel />}
      {tab === 'runs' && <RunsPanel />}
    </div>
  );
}
