import { ConflictException } from '@nestjs/common';
import { DealsService } from './deals.service';

describe('DealsService system PO resolution', () => {
  const createService = (
    availability: { available: boolean; reason?: string } = {
      available: true,
    },
  ) => {
    const rpc = jest.fn(async (name: string) => {
      if (name === 'allocate_system_po') {
        return { data: 'EM/PO/1', error: null };
      }
      if (name === 'check_po_availability') {
        return { data: availability, error: null };
      }
      if (name === 'release_po_reservation') {
        return {
          data: {
            released: true,
            po_number: 'EM/PO/42',
          },
          error: null,
        };
      }
      return { data: { claimed: true }, error: null };
    });

    const supabaseService = {
      getAdminClient: () => ({ rpc }),
    };
    const service = new DealsService(
      supabaseService as any,
      {} as any,
      {} as any,
    );

    return { service, rpc };
  };

  it('allocates a canonical PO and keeps a customer PO as reference', async () => {
    const { service } = createService();

    await expect(
      service.resolvePoNumbers({
        referencePo: 'PO-CUSTOMER-42',
        reservationToken: 'test-draft',
      }),
    ).resolves.toMatchObject({
      poNumber: 'EM/PO/1',
      generatedPoNumber: 'EM/PO/1',
      referencePoNumber: 'PO-CUSTOMER-42',
      poSource: 'generated',
    });
  });

  it('migrates a legacy canonical PO to reference data when winning an order', async () => {
    const { service } = createService();

    await expect(
      service.resolvePoNumbers({
        existingDeal: {
          id: 'deal-id',
          po_number: 'PO-LEGACY-7',
          generated_po_number: null,
        },
        reservationToken: 'legacy-order',
        dealId: 'deal-id',
      }),
    ).resolves.toMatchObject({
      poNumber: 'EM/PO/1',
      referencePoNumber: 'PO-LEGACY-7',
    });
  });

  it('rejects a duplicate editable system PO before persistence', async () => {
    const { service } = createService({
      available: false,
      reason: 'PO number is already allocated',
    });

    await expect(
      service.resolvePoNumbers({
        requestedPo: 'EM/PO/9',
        generatedPo: 'EM/PO/1',
        reservationToken: 'duplicate-edit',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('preserves the generated value when the canonical PO is edited', async () => {
    const { service } = createService();

    await expect(
      service.resolvePoNumbers({
        requestedPo: 'PO-INTERNAL-42',
        generatedPo: 'EM/PO/41',
        referencePo: 'PO-CUSTOMER-42',
        reservationToken: 'editable-test',
      }),
    ).resolves.toMatchObject({
      poNumber: 'PO-INTERNAL-42',
      generatedPoNumber: 'EM/PO/41',
      referencePoNumber: 'PO-CUSTOMER-42',
      poSource: 'user_edit',
    });
  });

  it('releases only the matching unclaimed reservation context', async () => {
    const { service, rpc } = createService();

    await expect(
      service.releasePoReservation(
        'dashboard:reservation',
        'EM/PO/42',
        'deal-id',
      ),
    ).resolves.toEqual({
      released: true,
      po_number: 'EM/PO/42',
    });

    expect(rpc).toHaveBeenCalledWith('release_po_reservation', {
      p_reservation_token: 'dashboard:reservation',
      p_po_number: 'EM/PO/42',
      p_deal_id: 'deal-id',
    });
  });

  it('does not call the database when a reservation token is missing', async () => {
    const { service, rpc } = createService();

    await expect(service.releasePoReservation()).resolves.toEqual({
      released: false,
      reason: 'Reservation token is required',
    });
    expect(rpc).not.toHaveBeenCalledWith(
      'release_po_reservation',
      expect.anything(),
    );
  });

  it('reuses a released allocation through the backend service', async () => {
    const allocations = new Map<
      string,
      { po: string; claimed: boolean }
    >();
    const rpc = jest.fn(async (name: string, args: any) => {
      if (name === 'allocate_system_po') {
        let number = 1;
        while (
          [...allocations.values()].some(
            allocation => allocation.po === `EM/PO/${number}`,
          )
        ) {
          number += 1;
        }
        const po = `EM/PO/${number}`;
        allocations.set(args.p_reservation_token, { po, claimed: false });
        return { data: po, error: null };
      }

      if (name === 'release_po_reservation') {
        const allocation = allocations.get(args.p_reservation_token);
        if (!allocation || allocation.claimed) {
          return {
            data: {
              released: false,
              reason: 'No matching unclaimed PO reservation found',
            },
            error: null,
          };
        }
        allocations.delete(args.p_reservation_token);
        return {
          data: { released: true, po_number: allocation.po },
          error: null,
        };
      }

      return { data: { available: true }, error: null };
    });
    const service = new DealsService(
      { getAdminClient: () => ({ rpc }) } as any,
      {} as any,
      {} as any,
    );

    const first = await service.allocatePoNumber('cancelled-draft');
    const release = await service.releasePoReservation(
      first.po_reservation_token,
      first.po_number,
    );
    const reused = await service.allocatePoNumber('replacement-draft');

    expect(release).toEqual({
      released: true,
      po_number: first.po_number,
    });
    expect(reused.po_number).toBe(first.po_number);
  });
});
