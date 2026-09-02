export interface MatterhornProduct {
  id: string;
  name: string;
  brand: string;
  categoryPath: string;
  categoryId: string;
  color: string;
  type: string;
  descriptionHtml: string;
  images: string[];
  prices: Record<string, number>;
  options: MatterhornOption[];
}

export interface MatterhornOption {
  id: string;
  name: string; // e.g. size
  stock: number;
  availableIn: number;
  ean: string;
}

export interface ProductData {
  title: string;
  description: string;
  metaTitle?: string;
  metaDescription?: string;
}

export interface WaWiProduct {
  id: string; // Matterhorn ID
  matterhornData: MatterhornProduct;
  aiData?: Partial<ProductData>;
  manualData?: Partial<ProductData>;
  status: 'imported' | 'reviewed' | 'approved' | 'synced' | 'rejected';
  createdAt: string;
  updatedAt: string;
}
