import { create } from 'zustand';
import type { ProductStatus } from './api';

interface UIState {
  filters: {
    status: ProductStatus | null;
    brand: string | null;
    categoryId: string | null;
    search: string;
    limit: number;
    offset: number;
  };
  setFilters: (filters: Partial<UIState['filters']>) => void;
  clearFilters: () => void;
  selectedProductId: string | null;
  setSelectedProductId: (id: string | null) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

const initialFilters: UIState['filters'] = {
  status: null,
  brand: null,
  categoryId: null,
  search: '',
  limit: 50,
  offset: 0,
};

export const useUIStore = create<UIState>((set) => ({
  filters: initialFilters,
  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
  clearFilters: () => set({ filters: initialFilters }),
  selectedProductId: null,
  setSelectedProductId: (id) => set({ selectedProductId: id }),
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}));
