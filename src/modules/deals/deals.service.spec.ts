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
});
