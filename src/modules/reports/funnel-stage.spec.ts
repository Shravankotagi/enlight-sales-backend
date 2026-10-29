import { displayStage } from '../inquiries/inquiry-pricing.util';
import { resolveInquiryPipelineStage } from './reports.service';

describe('resolveInquiryPipelineStage', () => {
  it('uses the inquiry list stage for quote and won', () => {
    const quoted = { id: 'inq-1', status: 'quoted' };
    const won = {
      id: 'inq-2',
      status: 'confirmed',
      inquiry_type: 'purchase_order',
    };
    const deals = [
      { inquiry_id: 'inq-1', stage: 'new_inquiry', created_at: '2026-10-01' },
      {
        inquiry_id: 'other',
        customer_name: 'Same Mills',
        stage: 'quoted',
        created_at: '2026-10-02',
      },
    ];
    const named = {
      id: 'inq-3',
      status: 'new',
      customer_name: 'Same Mills',
    };

    expect(resolveInquiryPipelineStage(quoted, deals)).toBe(
      displayStage(quoted, deals, quoted.id),
    );
    expect(resolveInquiryPipelineStage(quoted, deals)).toBe('quoted');
    expect(resolveInquiryPipelineStage(won, [])).toBe('won');
    expect(resolveInquiryPipelineStage(named, deals)).toBe('new_inquiry');
  });
});
