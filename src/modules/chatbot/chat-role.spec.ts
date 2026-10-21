import { mapChatRole } from './chat-role';

describe('mapChatRole', () => {
  it('keeps procurement roles ahead of the manager substring', () => {
    expect(mapChatRole('procurement_manager')).toBe('procurement_manager');
    expect(mapChatRole('procurement_person')).toBe('procurement_person');
    expect(mapChatRole('sales_manager')).toBe('manager');
    expect(mapChatRole('salesperson')).toBe('salesperson');
  });
});
