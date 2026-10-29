import { redactCustomerProfile } from './customers.service';

describe('redactCustomerProfile', () => {
  const full = {
    deals: [{ id: 'd1' }],
    payments: [{ id: 'p1' }],
    inquiries: [{ id: 'i1' }],
    visits: [{ id: 'v1' }],
    complaints: [{ id: 'c1' }],
    total_orders: 2,
    total_tonnage: 65,
    last_order_date: '2026-09-21',
    days_since_order: 37,
    lifetime_value: 1000,
    avg_order_value: 500,
    t12m_revenue: 800,
    avg_order_frequency_days: 30,
    open_complaints: 1,
    total_complaints: 2,
    churn_risk: 'at_risk',
    segment: 'growth',
  };

  it('keeps the profile when access is omitted', () => {
    expect(redactCustomerProfile(full)).toEqual(full);
  });

  it('clears orders and inquiries for a customer-only view', () => {
    const out = redactCustomerProfile(full, {
      orders: false,
      inquiries: false,
    });
    expect(out.deals).toEqual([]);
    expect(out.payments).toEqual([]);
    expect(out.inquiries).toEqual([]);
    expect(out.total_orders).toBe(0);
    expect(out.total_tonnage).toBe(0);
    expect(out.last_order_date).toBeNull();
    expect(out.visits).toEqual(full.visits);
    expect(out.complaints).toEqual(full.complaints);
    expect(out.churn_risk).toBe('at_risk');
    expect(out.segment).toBe('growth');
  });

  it('clears visits and complaints when those views are off', () => {
    const out = redactCustomerProfile(full, {
      visits: false,
      complaints: false,
    });
    expect(out.visits).toEqual([]);
    expect(out.complaints).toEqual([]);
    expect(out.open_complaints).toBe(0);
    expect(out.total_complaints).toBe(0);
    expect(out.deals).toEqual(full.deals);
  });
});
