import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useUIStore } from '../lib/store';
import { productApi, type ProductListParams } from '../lib/api';
import { ProductCard } from '../components/ProductCard';
import { ProductDetail } from './ProductDetail';

export function ProductList() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { filters, setFilters, clearFilters, setSelectedProductId } = useUIStore();

  const params: ProductListParams = {
    status: filters.status ?? undefined,
    brand: filters.brand || undefined,
    categoryId: filters.categoryId || undefined,
    search: filters.search.trim() || undefined,
    limit: filters.limit,
    offset: filters.offset,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['products', params],
    queryFn: () => productApi.list(params),
    placeholderData: (previousData) => previousData,
  });

  const openProduct = (productId: string) => {
    setSelectedProductId(productId);
    navigate(`/product/${encodeURIComponent(productId)}`);
  };

  const closeProduct = () => {
    setSelectedProductId(null);
    navigate('/');
  };

  return (
    <div className="h-screen flex overflow-hidden">
      <section className={id ? 'w-[42%] min-w-[360px] border-r border-gray-200 flex flex-col' : 'w-full flex flex-col'}>
        <div className="bg-white border-b border-gray-200 p-4 flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Suche</label>
            <input
              type="search"
              value={filters.search}
              onChange={(event) => setFilters({ search: event.target.value, offset: 0 })}
              placeholder="Produktname, Marke..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div className="min-w-[150px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filters.status || ''}
              onChange={(event) => setFilters({ status: event.target.value ? event.target.value as typeof filters.status : null, offset: 0 })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">Alle</option>
              <option value="imported">Importiert</option>
              <option value="reviewed">In Review</option>
              <option value="approved">Freigegeben</option>
              <option value="synced">Synchronisiert</option>
              <option value="rejected">Abgelehnt</option>
            </select>
          </div>
          <div className="min-w-[150px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Marke</label>
            <input
              type="text"
              value={filters.brand || ''}
              onChange={(event) => setFilters({ brand: event.target.value || null, offset: 0 })}
              placeholder="Marke filtern"
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div className="flex items-end">
            <button onClick={clearFilters} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Filter zurücksetzen
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent" />
            </div>
          )}

          {error && <div className="text-red-500 p-4">Fehler beim Laden der Produkte: {error.message}</div>}

          {!isLoading && !error && data?.products.length === 0 && (
            <div className="text-center py-12 text-gray-500">Keine Produkte gefunden</div>
          )}

          {!isLoading && !error && data && data.products.length > 0 && (
            <div className={id ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'}>
              {data.products.map((product) => (
                <ProductCard
                  key={product.supplierProductId}
                  product={product}
                  onClick={() => openProduct(product.supplierProductId)}
                />
              ))}
            </div>
          )}

          <div className="flex justify-center items-center gap-4 mt-4">
            <button
              onClick={() => setFilters({ offset: Math.max(0, filters.offset - filters.limit) })}
              disabled={filters.offset === 0}
              className="px-4 py-2 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Vorherige
            </button>
            <span className="text-sm text-gray-600">
              Seite {Math.floor(filters.offset / filters.limit) + 1} von {Math.max(1, Math.ceil((data?.count || 0) / filters.limit))}
            </span>
            <button
              onClick={() => setFilters({ offset: filters.offset + filters.limit })}
              disabled={!data || filters.offset + filters.limit >= data.count}
              className="px-4 py-2 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Nächste
            </button>
          </div>
        </div>
      </section>

      {id && (
        <section className="flex-1 min-w-0">
          <ProductDetail productId={id} onClose={closeProduct} />
        </section>
      )}
    </div>
  );
}
