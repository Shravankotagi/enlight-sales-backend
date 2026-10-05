import { BadRequestException } from '@nestjs/common';
import { KraService } from './kra.service';

describe('KraService complaint edit restrictions', () => {
  const existingComplaint = {
    id: 'complaint-1',
    reported_by: '919876543210',
    status: 'reported',
    resolution_notes: null,
    resolution_date: null,
  };

  function createService() {
    const single = jest.fn().mockResolvedValue({
      data: { ...existingComplaint, raised_by: 'Updated Contact' },
      error: null,
    });
    const select = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ single }),
    });
    const update = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ single }),
      }),
    });
    const client = { from: jest.fn().mockReturnValue({ select, update }) };
    const supabaseService = {
      getAdminClient: jest.fn().mockReturnValue(client),
    };
    const activityLogsService = { logActivity: jest.fn() };

    return {
      service: new KraService(
        supabaseService as any,
        activityLogsService as any,
      ),
      update,
    };
  }

  it('rejects locked post-log complaint fields before querying the database', async () => {
    const { service } = createService();

    await expect(
      service.updateComplaint('complaint-1', {
        complaint_date: '2026-09-30',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists an allowed post-log complaint field', async () => {
    const { service, update } = createService();

    await service.updateComplaint('complaint-1', {
      raised_by: 'Updated Contact',
    });

    expect(update).toHaveBeenCalledWith({ raised_by: 'Updated Contact' });
  });

  it('sets resolution timestamps internally when an allowed status change resolves a complaint', async () => {
    const { service, update } = createService();

    await service.updateComplaint('complaint-1', {
      status: 'resolved',
      resolution_notes: 'Replacement material accepted by the customer.',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'resolved',
        resolution_notes: 'Replacement material accepted by the customer.',
        resolved_at: expect.any(String),
        resolution_date: expect.any(String),
      }),
    );
  });
});
