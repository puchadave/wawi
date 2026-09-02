import { Product } from '../lib/api';
import { useUIStore } from '../lib/store';
import { Image, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';

interface ProductCardProps {
  product: Product;
  onClick: () => void;
}

export function ProductCard({ product, onClick }: ProductCardProps) {
  const { selectedProductId } = useUIStore();
  const isSelected = selectedProductId === product.supplierProductId;

  const statusColors: Record<string, string> = {
    imported: 'bg-gray-100 text-gray-700',
    reviewed: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    synced: 'bg-blue-100 text-blue-700',
    rejected: 'bg-red-100 text-red-700',
  };

  const statusLabels: Record<string, string> = {
    imported: 'Importiert',
    reviewed: 'In Review',
    approved: 'Freigegeben',
    synced: 'Synchronisiert',
    rejected: 'Abgelehnt',
  };

  const firstImage = product.images[0];
  const priceEUR = product.prices.EUR || 0;

  return (
    <div
      className={clsx(
        'bg-white border rounded-lg overflow-hidden cursor-pointer transition-all duration-200',
        isSelected
          ? 'ring-2 ring-blue-500 border-blue-500 shadow-lg'
          : 'border-gray-200 hover:shadow-md hover:border-gray-300'
      )}
      onClick={onClick}
    >
      {/* Image */}
      <div className="aspect-square relative bg-gray-50 overflow-hidden">
        {firstImage ? (
          <img
            src={firstImage}
            alt={product.name}
            className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <Image className="w-12 h-12" />
          </div>
        )}
        {/* Status Badge */}
        <div className="absolute top-2 right-2">
          <span className={clsx('px-2 py-1 text-xs font-medium rounded-full', statusColors[product.status])}>
            {statusLabels[product.status]}
          </span>
        </div>
        {/* Whitelist Indicator */}
        {product.isWhitelisted && (
          <div className="absolute top-2 left-2">
            <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
              ⚪ Whitelist
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 flex-1">
            {product.name}
          </h3>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <span className="font-medium text-gray-700">{product.brand}</span>
          <span>•</span>
          <span>{product.categoryPath?.split('/').pop() || product.categoryId}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-lg font-bold text-gray-900">
            {priceEUR.toFixed(2)} €
          </div>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
            className="px-3 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-300 rounded"
          >
            Prüfen
          </button>
        </div>
      </div>
    </div>
  );
}