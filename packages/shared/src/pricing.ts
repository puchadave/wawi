export interface PriceRule {
  id: string;
  name: string;
  vatRate: number;            // e.g., 0.19 for 19%
  targetMargin: number;       // e.g., 0.40 for 40% margin
  fixedSurchargeNet: number;  // Fixed fee in EUR net
  mode: 'netto' | 'brutto';    // Display mode
  charmPricing: boolean;      // Round to .90
  includeFreightInVk: boolean;// Add allocated freight to VK (Gratisversand)
}

export interface PricingCalculationInput {
  supplierNet: number;
  dropshippingFeeNet?: number;
  freightAllocatedNet?: number;
  priceRule: PriceRule;
}

export interface PricingCalculationResult {
  supplierNet: number;
  dropshippingFeeNet: number;
  freightAllocatedNet: number;
  fixedSurchargeNet: number;
  shopEkNet: number;
  shopVkNet: number;
  shopVkGross: number;
  vatAmount: number;
  marginAmountNet: number;
  marginPercent: number;
  uvpGross?: number;
}

export function calculateProductPrice(input: PricingCalculationInput): PricingCalculationResult {
  const {
    supplierNet,
    dropshippingFeeNet = 0,
    freightAllocatedNet = 0,
    priceRule,
  } = input;

  const fixedSurchargeNet = priceRule.fixedSurchargeNet || 0;

  // 1. Shop-EK Netto = supplierNet + dropshipFee + fixedSurcharge + freight (if applicable)
  const freightToAdd = priceRule.includeFreightInVk ? freightAllocatedNet : 0;
  const shopEkNet = supplierNet + dropshippingFeeNet + fixedSurchargeNet + freightToAdd;

  // 2. VK Netto based on target margin: Margin = (VK - EK) / VK  =>  VK = EK / (1 - Margin)
  const marginFactor = 1 - priceRule.targetMargin;
  let shopVkNet = marginFactor > 0 ? shopEkNet / marginFactor : shopEkNet * 1.5;

  // 3. MwSt & Brutto
  const vatRate = priceRule.vatRate || 0.19;
  let shopVkGross = shopVkNet * (1 + vatRate);

  // 4. Charm pricing (.90) if enabled
  if (priceRule.charmPricing) {
    const integerPart = Math.floor(shopVkGross);
    shopVkGross = integerPart + 0.90;
    if (shopVkGross < shopEkNet * (1 + vatRate)) {
      // Prevent selling below EK gross after charm rounding
      shopVkGross += 1.0;
    }
    shopVkNet = shopVkGross / (1 + vatRate);
  }

  const vatAmount = shopVkGross - shopVkNet;
  const marginAmountNet = shopVkNet - shopEkNet;
  const marginPercent = shopVkNet > 0 ? (marginAmountNet / shopVkNet) * 100 : 0;

  return {
    supplierNet: roundTwoDecimals(supplierNet),
    dropshippingFeeNet: roundTwoDecimals(dropshippingFeeNet),
    freightAllocatedNet: roundTwoDecimals(freightAllocatedNet),
    fixedSurchargeNet: roundTwoDecimals(fixedSurchargeNet),
    shopEkNet: roundTwoDecimals(shopEkNet),
    shopVkNet: roundTwoDecimals(shopVkNet),
    shopVkGross: roundTwoDecimals(shopVkGross),
    vatAmount: roundTwoDecimals(vatAmount),
    marginAmountNet: roundTwoDecimals(marginAmountNet),
    marginPercent: roundTwoDecimals(marginPercent),
  };
}

function roundTwoDecimals(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}
