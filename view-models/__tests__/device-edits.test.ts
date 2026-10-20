/**
 * One device's name and room, saved through `PUT /devices/{id}`.
 *
 * Pinned: the request carries the trimmed name and room and leaves the hostname to the Pond, a
 * device leaves every room through a blank room, and a refusal always comes back as words, because
 * the sheet stays open on a failure only if there is something to show.
 */

import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { Device } from '@/services/types';
import { applyEdits, describeEditOutcome, editRequest } from '@/view-models/use-devices';

function device(id: string, room?: string, over: Partial<Device> = {}): Device {
  return { id, name: `Device ${id}`, is_online: true, room, ...over };
}

describe('editing one device', () => {
  it('sends the trimmed name and room, and leaves the hostname to the Pond', () => {
    const req = editRequest({ device: device('lamp', 'Kitchen', { hostname: 'lamp.local' }), name: ' Desk lamp ', room: ' Study ' });
    expect(req).toEqual({ name: 'Desk lamp', room: 'Study' });
    expect('hostname' in req).toBe(false);
  });

  it('sends a blank room to take a device out of every room', () => {
    expect(editRequest({ device: device('lamp', 'Kitchen'), name: 'Lamp', room: null }).room).toBe('');
  });

  it('reports why the Pond refused it', async () => {
    const client = { updateDevice: jest.fn().mockRejectedValue(new ApiError('PUT', 400, null, 'name_required')) };
    const outcome = await applyEdits(client, [{ device: device('lamp'), name: 'x', room: null }]);
    expect(describeEditOutcome(outcome, 1)).toBe(i18n.t('errors.deviceNameRequired'));
  });

  it('says something even when the Pond never answered', async () => {
    const client = { updateDevice: jest.fn().mockRejectedValue(new TypeError('Network request failed')) };
    const outcome = await applyEdits(client, [{ device: device('lamp'), name: 'Lamp', room: null }]);
    expect(describeEditOutcome(outcome, 1)).toBe(i18n.t('errors.deviceNotSaved'));
  });
});
