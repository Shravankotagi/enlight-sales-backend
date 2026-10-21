// Issue: <add GitHub issue link>
// A salesperson can mark their own visit follow-up done, and cannot edit the visit.
import { KraController } from '../modules/kra/kra.controller';

describe('salesperson visit follow-up', () => {
  const salesperson = { role: 'salesperson', phone: '9822012345' };

  function controller() {
    const updateVisit = jest.fn().mockResolvedValue({ id: 'visit-1' });
    const getAccessibleSalespersonPhones = jest
      .fn()
      .mockResolvedValue({ phones: ['9822012345'] });
    return {
      updateVisit,
      getAccessibleSalespersonPhones,
      api: new KraController(
        { updateVisit } as any,
        { getAccessibleSalespersonPhones } as any,
      ),
    };
  }

  it('lets a salesperson set the follow-up status on their own visit', async () => {
    const { api, updateVisit, getAccessibleSalespersonPhones } = controller();
    await api.updateVisit(salesperson, 'visit-1', {
      follow_up_status: 'completed',
    });
    expect(getAccessibleSalespersonPhones).toHaveBeenCalledWith(salesperson);
    expect(updateVisit).toHaveBeenCalledWith(
      'visit-1',
      { follow_up_status: 'completed' },
      ['9822012345'],
    );
  });

  it('rejects a salesperson visit edit that is not only the follow-up status', async () => {
    const { api, updateVisit } = controller();
    await expect(
      api.updateVisit(salesperson, 'visit-1', {
        follow_up_status: 'completed',
        customer_name: 'Acme',
      }),
    ).rejects.toThrow(
      'Access Denied: Field visits can only be updated by Sales Managers and Administrators.',
    );
    expect(updateVisit).not.toHaveBeenCalled();
  });
});
