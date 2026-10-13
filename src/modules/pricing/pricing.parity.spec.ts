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

  it('resolves customer state from GSTIN and Place of Supply priority', () => {
    expect(pricing.resolveStateFromGstin('27AAICE5263E1ZN')?.code).toBe('27');
    expect(pricing.resolveStateFromGstin('24ABCDE1234F1Z5')?.code).toBe('24');
    expect(pricing.resolveStateFromGstin('29ABCDE1234F1Z5')?.code).toBe('29');

    const maha = pricing.resolvePlaceOfSupply({ gstin: '27AAICE5263E1ZN' });
    expect(maha.stateCode).toBe('27');
    expect(maha.isInterState).toBe(false);

    const gujaratByGstin = pricing.resolvePlaceOfSupply({
      gstin: '24ABCDE1234F1Z5',
    });
    expect(gujaratByGstin.stateCode).toBe('24');
    expect(gujaratByGstin.isInterState).toBe(true);

    const deliveryOverride = pricing.resolvePlaceOfSupply({
      deliveryLocation: 'Bengaluru, Karnataka',
      gstin: '27AAICE5263E1ZN',
    });
    expect(deliveryOverride.stateCode).toBe('29');
    expect(deliveryOverride.isInterState).toBe(true);
  });

  it('splits CGST (9%) + SGST (9%) for intra-state and IGST (18%) for inter-state', () => {
    const intraLine = pricing.calculateLineItem(
      { quantity: 10, rate: 50000, unit: 'MT' },
      { isInterState: false },
    );
    expect(intraLine.cgst_percent).toBe(9);
    expect(intraLine.sgst_percent).toBe(9);
    expect(intraLine.igst_percent).toBe(0);
    expect(intraLine.cgst_amount).toBe(45000);
    expect(intraLine.sgst_amount).toBe(45000);
    expect(intraLine.igst_amount).toBe(0);
    expect(intraLine.total_gst).toBe(90000);
    expect(intraLine.line_total).toBe(590000);

    const interLine = pricing.calculateLineItem(
      { quantity: 10, rate: 50000, unit: 'MT' },
      { isInterState: true },
    );
    expect(interLine.cgst_percent).toBe(0);
    expect(interLine.sgst_percent).toBe(0);
    expect(interLine.igst_percent).toBe(18);
    expect(interLine.cgst_amount).toBe(0);
    expect(interLine.sgst_amount).toBe(0);
    expect(interLine.igst_amount).toBe(90000);
    expect(interLine.total_gst).toBe(90000);
    expect(interLine.line_total).toBe(590000);

    const intraBreakdown = pricing.calculateQuotationBreakdown(
      500000,
      undefined,
      { isInterState: false },
    );
    expect(intraBreakdown.CGST).toBe(45000);
    expect(intraBreakdown.SGST).toBe(45000);
    expect(intraBreakdown.IGST).toBe(0);
    expect(intraBreakdown.grandTotal).toBe(590000);

    const interBreakdown = pricing.calculateQuotationBreakdown(
      500000,
      undefined,
      { isInterState: true },
    );
    expect(interBreakdown.CGST).toBe(0);
    expect(interBreakdown.SGST).toBe(0);
    expect(interBreakdown.IGST).toBe(90000);
    expect(interBreakdown.grandTotal).toBe(590000);
  });

  it('calculates total amount strictly as total MT * rate per MT + 18% GST', () => {
    // 39897.63 KG = 39.89763 MT @ Rs. 1/MT
    const interLine = pricing.calculateLineItem(
      { quantity: 39897.63, unit: 'KG', rate: 1 },
      { isInterState: true },
    );
    expect(interLine.amount).toBe(39.9);
    expect(interLine.igst_amount).toBe(7.18);
    expect(interLine.final_amount).toBe(47.08);

    const intraLine = pricing.calculateLineItem(
      { quantity: 39897.63, unit: 'KG', rate: 1 },
      { isInterState: false },
    );
    expect(intraLine.amount).toBe(39.9);
    expect(intraLine.cgst_amount).toBe(3.59);
    expect(intraLine.sgst_amount).toBe(3.59);
    expect(intraLine.final_amount).toBe(47.08);
  });

  for (const divergence of fixture.knownDivergences) {
    it.todo(`known divergence ${divergence.id}: ${divergence.summary}`);
  }
});
