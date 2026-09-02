import { Product } from '../lib/api';

export interface ProductListResponse {
  products: Product[];
  count: number;
  limit: number;
  offset: number;
}

export interface PriceRule {
  id: string;
  name: string;
  vatRate: number;
  targetMargin: number;
  fixedSurchargeNet: number;
  mode: 'netto' | 'brutto';
  charmPricing: boolean;
  includeFreightInVk: boolean;
}