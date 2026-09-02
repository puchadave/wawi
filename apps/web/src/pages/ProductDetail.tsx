import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { CheckCircle, ChevronLeft, Euro, Image, RotateCcw, Save, Send, Truck, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { pricingApi, productApi, type PriceRule, type PricingCalculationResult, type ProductContent } from '../lib/api';

interface ProductDetailProps {
  productId: string;
  onClose: () => void;
}

export function ProductDetail({ productId, onClose }: ProductDetailProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'overview' | 'pricing' | 'images' | 'seo'>('overview');
  const [manualData, setManualData] = useState<ProductContent>({});
  const [selectedRuleId, setSelectedRuleId] = useState('');

  const productQuery = useQuery({
    queryKey: ['product', productId],
    queryFn: () => productApi.getById(productId),
  });

  const rulesQuery = useQuery({
    queryKey: ['pricingRules'],
    queryFn: pricingApi.getRules,
  });

  const priceEUR = productQuery.data?.prices.EUR || 0;

  useEffect(() => {
    if (productQuery.data) {
      setManualData(productQuery.data.manualData || {});
    }
  }, [productQuery.data]);

  useEffect(() => {
    if (!selectedRuleId && rulesQuery.data?.length) {
      setSelectedRuleId(rulesQuery.data[0].id);
    }
  }, [rulesQuery.data, selectedRuleId]);

  const priceQuery = useQuery({
    queryKey: ['price-preview', productId, selectedRuleId, priceEUR],
    queryFn: () => pricingApi.calculate({ supplierNet: priceEUR, priceRuleId: selectedRuleId }),
    enabled: priceEUR > 0 && selectedRuleId.length > 0,
  });

  const saveMutation = useMutation({
    mutationFn: (content: ProductContent) => productApi.saveManualData(productId, content),
    onSuccess: (product) => {
      queryClient.setQueryData(['product', productId], product);
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const statusMutation = useMutation<{ status: string; id: string }, Error, 'reviewed' | 'approved' | 'rejected'>({
    mutationFn: (status) => {
      if (status === 'approved') return productApi.approve(productId);
      if (status === 'rejected') return productApi.reject(productId);
      return productApi.review(productId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', productId] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => productApi.sync(productId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', productId] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  if (productQuery.isLoading) {
    return <div className="h-full flex items-center justify-center"><div className="spinner" /></div>;
  }

  if (productQuery.error || !productQuery.data) {
    return <div className="h-full flex items-center justify-center text-red-600">Produkt konnte nicht geladen werden.</div>;
  }

  const product = productQuery.data;
  const selectedRule = rulesQuery.data?.find((rule) => rule.id === selectedRuleId);
  const description = product.descriptionHtml || '';

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex flex-wrap items-center gap-4">
        <button onClick={onClose} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg" aria-label="Produkt schließen">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-gray-900 truncate">{product.name}</h1>
          <p className="text-sm text-gray-500">{product.brand} · {product.categoryPath}</p>
        </div>
        <span className={clsx('px-3 py-1 rounded-full text-xs font-medium', {
          'bg-gray-100 text-gray-700': product.status === 'imported',
          'bg-yellow-100 text-yellow-700': product.status === 'reviewed',
          'bg-green-100 text-green-700': product.status === 'approved',
          'bg-blue-100 text-blue-700': product.status === 'synced',
          'bg-red-100 text-red-700': product.status === 'rejected',
        })}>{product.status}</span>
        <button onClick={() => statusMutation.mutate('rejected')} disabled={statusMutation.isPending} className="action-button danger"><XCircle className="w-4 h-4" /> Ablehnen</button>
        <button onClick={() => statusMutation.mutate('reviewed')} disabled={statusMutation.isPending} className="action-button warning"><RotateCcw className="w-4 h-4" /> Review</button>
        <button onClick={() => statusMutation.mutate('approved')} disabled={statusMutation.isPending} className="action-button success"><CheckCircle className="w-4 h-4" /> Freigeben</button>
        <button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || (product.status !== 'approved' && product.status !== 'synced')} className="action-button sync"><Send className="w-4 h-4" /> Shopware Sync</button>
        <button onClick={() => saveMutation.mutate(manualData)} disabled={saveMutation.isPending} className="action-button primary"><Save className="w-4 h-4" /> Speichern</button>
      </header>

      {(product.syncAttempt || product.shopwareMapping || syncMutation.error) && (
        <div className={clsx('sync-banner', product.syncAttempt?.status === 'failed' || syncMutation.error ? 'failed' : 'active')}>
          <strong>Shopware:</strong>
          <span>{syncMutation.isPending ? 'Wird eingeplant' : product.syncAttempt?.status || 'synchronisiert'}</span>
          {product.shopwareMapping && <span>ID {product.shopwareMapping.shopwareUuid}</span>}
          {(syncMutation.error || product.syncAttempt?.error) && <span>{syncMutation.error?.message || product.syncAttempt?.error}</span>}
        </div>
      )}

      <nav className="bg-white border-b border-gray-200 px-6 flex gap-6">
        {(['overview', 'pricing', 'images', 'seo'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={clsx('py-3 border-b-2 text-sm font-medium', activeTab === tab ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500')}>
            {{ overview: 'Übersicht', pricing: 'Preise', images: 'Bilder', seo: 'SEO' }[tab]}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'overview' && (
          <div className="detail-grid">
            <OriginalPanel product={product} description={description} />
            <EditPanel product={product} manualData={manualData} onChange={setManualData} />
          </div>
        )}

        {activeTab === 'pricing' && (
          <PricingPanel
            rules={rulesQuery.data || []}
            selectedRuleId={selectedRuleId}
            onRuleChange={setSelectedRuleId}
            rule={selectedRule}
            result={priceQuery.data}
            supplierNet={priceEUR}
            loading={priceQuery.isFetching}
          />
        )}

        {activeTab === 'images' && (
          <div className="panel">
            <h2 className="panel-title"><Image className="w-5 h-5" /> Produktbilder ({product.images.length})</h2>
            <div className="image-grid">
              {product.images.map((image, index) => <img key={image} src={image} alt={`${product.name} ${index + 1}`} />)}
              {!product.images.length && <p className="muted">Keine Bilder vorhanden.</p>}
            </div>
          </div>
        )}

        {activeTab === 'seo' && (
          <div className="panel form-stack">
            <Field label="Meta Title" value={manualData.metaTitle ?? product.aiData.metaTitle ?? ''} maxLength={60} onChange={(value) => setManualData({ ...manualData, metaTitle: value })} />
            <TextArea label="Meta Description" value={manualData.metaDescription ?? product.aiData.metaDescription ?? ''} maxLength={160} rows={4} onChange={(value) => setManualData({ ...manualData, metaDescription: value })} />
          </div>
        )}
      </div>
    </div>
  );
}

function OriginalPanel({ product, description }: { product: Awaited<ReturnType<typeof productApi.getById>>; description: string }) {
  return (
    <section className="panel">
      <h2 className="panel-title">Matterhorn Original</h2>
      <dl className="data-list">
        <dt>Produktname</dt><dd>{product.name}</dd>
        <dt>Marke</dt><dd>{product.brand}</dd>
        <dt>Kategorie</dt><dd>{product.categoryPath}</dd>
        <dt>Farbe</dt><dd>{product.color || '—'}</dd>
        <dt>Typ</dt><dd>{product.type || '—'}</dd>
        <dt>Matterhorn ID</dt><dd>{product.supplierProductId}</dd>
      </dl>
      <h3 className="section-title">Beschreibung</h3>
      <div className="html-preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(description) }} />
      <h3 className="section-title"><Truck className="w-4 h-4" /> Varianten & Bestand</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Variante</th><th>Bestand</th><th>Lieferzeit</th><th>EAN</th></tr></thead>
          <tbody>
            {(product.variants || []).map((variant) => (
              <tr key={variant.supplierVariantId}><td>{variant.name}</td><td>{variant.stock}</td><td>{variant.availableIn} Tage</td><td>{variant.ean || '—'}</td></tr>
            ))}
          </tbody>
        </table>
        {!product.variants?.length && <p className="muted">Keine Varianten vorhanden.</p>}
      </div>
    </section>
  );
}

function EditPanel({ product, manualData, onChange }: { product: Awaited<ReturnType<typeof productApi.getById>>; manualData: ProductContent; onChange: (data: ProductContent) => void }) {
  return (
    <section className="panel form-stack">
      <h2 className="panel-title">Shopware-Daten</h2>
      <Field label="Produkt-Titel" value={manualData.title ?? product.aiData.title ?? product.name} onChange={(value) => onChange({ ...manualData, title: value })} />
      <TextArea label="Produktbeschreibung" value={manualData.description ?? product.aiData.description ?? product.descriptionHtml ?? ''} rows={16} onChange={(value) => onChange({ ...manualData, description: value })} />
      <p className="muted">Manuelle Inhalte überschreiben KI- und Lieferantendaten.</p>
    </section>
  );
}

function PricingPanel({ rules, selectedRuleId, onRuleChange, rule, result, supplierNet, loading }: { rules: PriceRule[]; selectedRuleId: string; onRuleChange: (id: string) => void; rule?: PriceRule; result?: PricingCalculationResult; supplierNet: number; loading: boolean }) {
  return (
    <section className="panel">
      <h2 className="panel-title"><Euro className="w-5 h-5" /> Live-Preiskalkulation</h2>
      <label className="field-label" htmlFor="price-rule">Preisregel</label>
      <select id="price-rule" value={selectedRuleId} onChange={(event) => onRuleChange(event.target.value)} className="field-control">
        <option value="">Preisregel auswählen</option>
        {rules.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {!rules.length && <p className="muted">Keine Preisregeln vorhanden.</p>}
      {rule && <p className="muted">Marge: {(rule.targetMargin * 100).toFixed(0)} % · MwSt: {(rule.vatRate * 100).toFixed(0)} %</p>}
      {loading && <p className="muted">Berechnung läuft...</p>}
      {result && (
        <div className="metrics-grid">
          <Metric label="EK Netto" value={supplierNet} />
          <Metric label="Shop EK Netto" value={result.shopEkNet} />
          <Metric label="VK Netto" value={result.shopVkNet} />
          <Metric label="VK Brutto" value={result.shopVkGross} />
          <Metric label="Marge Netto" value={result.marginAmountNet} />
          <Metric label="Marge" value={result.marginPercent} suffix=" %" />
        </div>
      )}
    </section>
  );
}

function Field({ label, value, onChange, maxLength }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number }) {
  return <label><span className="field-label">{label}</span><input className="field-control" value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} /></label>;
}

function TextArea({ label, value, onChange, maxLength, rows }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number; rows: number }) {
  return <label><span className="field-label">{label}</span><textarea className="field-control" value={value} maxLength={maxLength} rows={rows} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Metric({ label, value, suffix = ' €' }: { label: string; value: number; suffix?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value.toFixed(2)}{suffix}</strong></div>;
}
