import * as pricing from './pricing.engine';
import * as hsn from '../../utils/hsnDetector';

const fixture = require('../../test-utils/fixtures/pricing-parity.json');

describe('pricing and HSN parity with the bot and frontend', () => {
  it.each(fixture.hsn)('detects HSN for $product', (c: any) => {
    expect(hsn.detectHsnCode(c.product) || null).toBe(c.hsn);
    expect(hsn.normalizeProductToCatalog(c.product).catalogName ?? null).toBe(
      c.catalogName,
    );
  });

  it.each(fixture.units)('normalizes unit "$input"', (c: any) => {
    expect(pricing.normalizeUnit(c.input)).toBe(c.unit);
  });

  it.each(fixture.lineItems)('calculates line item %#', (c: any) => {
    const r = pricing.calculateLineItem(c.input);
    expect({
      quantity: r.quantity,
      unit: r.unit,
      rate: r.rate,
      amount: r.amount,
    }).toEqual({
      quantity: c.quantity,
      unit: c.unit,
      rate: c.rate,
      amount: c.amount,
    });
  });

  it('calculates the pricing summary', () => {
    const s = pricing.calculatePricingSummary(fixture.pricingSummary.input);
    expect([s.subtotal, s.gstAmount, s.grandTotal]).toEqual([
      fixture.pricingSummary.subtotal,
      fixture.pricingSummary.gstAmount,
      fixture.pricingSummary.grandTotal,
    ]);
  });

  it.each(fixture.quotationBreakdown)(
    'calculates the quotation breakdown for $baseAmount',
    (c: any) => {
      // The backend breakdown takes only the base amount; fixture line items
      // carry the same flat 9% CGST/SGST.
      const r: any = pricing.calculateQuotationBreakdown(c.baseAmount);
      expect({
        subtotal: r.subtotal,
        CGST: r.CGST,
        SGST: r.SGST,
        rounding: r.rounding,
        grandTotal: r.grandTotal,
      }).toEqual({
        subtotal: c.subtotal,
        CGST: c.CGST,
        SGST: c.SGST,
        rounding: c.rounding,
        grandTotal: c.grandTotal,
      });
    },
  );

  it('calculates GST at the default rate', () => {
    expect(pricing.calculateGst(fixture.gst.baseAmount)).toBe(fixture.gst.gst);
    expect(pricing.calculateGrandTotal(fixture.gst.baseAmount)).toBe(
      fixture.gst.grandTotal,
    );
  });

  for (const divergence of fixture.knownDivergences) {
    it.todo(`known divergence ${divergence.id}: ${divergence.summary}`);
  }
});
