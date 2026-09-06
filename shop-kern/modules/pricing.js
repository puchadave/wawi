'use strict';
/**
 * WaWi-Preiskern (Port aus packages/shared/src/pricing.ts)
 * 1:1 Geschäftslogik — MwSt, Marge, Charm-Pricing, Fracht.
 * Mit kontinuierlichem Debug-Tracing.
 */

const { logger } = require('./logger');

/**
 * @typedef {Object} PriceRule
 * @property {string} id
 * @property {string} name
 * @property {number} vatRate
 * @property {number} targetMargin
 * @property {number} fixedSurchargeNet
 * @property {'netto'|'brutto'} mode
 * @property {boolean} charmPricing
 * @property {boolean} includeFreightInVk
 */

/**
 * @typedef {Object} PricingCalculationInput
 * @property {number} supplierNet
 * @property {number} [dropshippingFeeNet]
 * @property {number} [freightAllocatedNet]
 * @property {PriceRule} priceRule
 */

/**
 * Berechnet den Verkaufspreis nach den WaWi-Preisregeln.
 * @param {PricingCalculationInput} input
 */
function calculateProductPrice(input) {
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

  // 2. VK Netto aus Zielmarge: Marge = (VK - EK) / VK => VK = EK / (1 - Marge)
  const marginFactor = 1 - priceRule.targetMargin;
  let shopVkNet = marginFactor > 0 ? shopEkNet / marginFactor : shopEkNet * 1.5;

  // 3. MwSt & Brutto
  const vatRate = priceRule.vatRate !== undefined ? priceRule.vatRate : 0.19;
  let shopVkGross = shopVkNet * (1 + vatRate);

  // 4. Charm-Pricing (.90)
  if (priceRule.charmPricing) {
    shopVkGross = Math.floor(shopVkGross) + 0.90;
    shopVkNet = shopVkGross / (1 + vatRate);
  }

  // 5. Runden auf 2 Dezimalstellen
  const r2 = (n) => Math.round(n * 100) / 100;

  const vatAmount = r2(shopVkGross - shopVkNet);
  const marginAmountNet = r2(shopVkNet - shopEkNet);
  const marginPercent = shopVkNet > 0 ? marginAmountNet / shopVkNet : 0;

  const result = {
    supplierNet: r2(supplierNet),
    dropshippingFeeNet: r2(dropshippingFeeNet),
    freightAllocatedNet: r2(freightAllocatedNet),
    fixedSurchargeNet: r2(fixedSurchargeNet),
    shopEkNet: r2(shopEkNet),
    shopVkNet: r2(shopVkNet),
    shopVkGross: r2(shopVkGross),
    vatAmount,
    marginAmountNet,
    marginPercent: r2(marginPercent),
  };

  logger.debug('PRICING', `Kalkulation: EK=${supplierNet}€ -> VK=${result.shopVkGross}€ (Marge: ${(marginPercent * 100).toFixed(1)}%)`, {
    input: { supplierNet, targetMargin: priceRule.targetMargin },
    output: result,
  });

  return result;
}

module.exports = { calculateProductPrice };
