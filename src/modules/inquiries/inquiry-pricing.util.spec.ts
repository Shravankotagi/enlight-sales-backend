import {
  anonymizeInquiry,
  deriveProcurementLines,
  gstSplit,
  procurementStatus,
} from './inquiry-pricing.util';

describe('inquiry pricing', () => {
  it('marks a blank base price unavailable and a positive price ready', () => {
    const lines = deriveProcurementLines(
      [],
      [
        { line_key: 'a', base_price_per_mt: 61000 },
        { line_key: 'b', base_price_per_mt: null },
      ],
    );
    expect(lines[0].line_status).toBe('priced');
    expect(lines[1].line_status).toBe('cannot_price');
    expect(procurementStatus(lines)).toBe('price_ready');
    expect(
      procurementStatus(
        lines.map((line) => ({ ...line, line_status: 'cannot_price' })),
      ),
    ).toBe('unavailable');
  });

  it('uses IGST outside Maharashtra and CGST plus SGST inside it', () => {
    expect(gstSplit(1000, 'Pune, Maharashtra').igst_amount).toBe(0);
    expect(gstSplit(1000, 'Pune, Maharashtra').cgst_amount).toBe(90);
    expect(gstSplit(1000, 'Ahmedabad, Gujarat').igst_amount).toBe(180);
  });

  it('removes customer identity from procurement payloads', () => {
    const hidden = anonymizeInquiry({
      customer_name: 'Mehta',
      sender_phone: '9000000000',
      raw_text: 'Need coil for Mehta',
      ai_extraction_json: {
        customer_name: 'Mehta',
        line_items: [{ sku_text: 'Coil' }],
      },
    });
    expect(hidden.customer_name).toBeUndefined();
    expect(hidden.raw_text).toBeUndefined();
    expect(hidden.ai_extraction_json.customer_name).toBeUndefined();
    expect(hidden.ai_extraction_json.line_items).toHaveLength(1);
  });
});
