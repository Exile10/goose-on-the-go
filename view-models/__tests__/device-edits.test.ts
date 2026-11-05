/**
 * One device's name and room, saved through `PUT /devices/{id}`.
 *
 * Pinned: the request carries the trimmed name and the room's id and leaves the hostname to the
 * Pond, a device leaves every room through a null room, and a refusal always comes back as words, because
 * the sheet stays open on a failure only if there is something to show.
 */

import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { Device } from '@/services/types';
import { applyEdits, describeEditOutcome, editRequest } from '@/view-models/use-devices';

function device(id: string, roomId?: string, over: Partial<Device> = {}): Device {
  return { id, name: `Device ${id}`, is_online: true, room_id: roomId, ...over };
}

describe('editing one device', () => {
  it('sends the trimmed name and the room id, and leaves the hostname to the Pond', () => {
    const req = editRequest({ device: device('lamp', 'kitchen', { hostname: 'lamp.local' }), name: ' Desk lamp ', roomId: 'study' });
    expect(req).toEqual({ name: 'Desk lamp', room_id: 'study' });
    expect('hostname' in req).toBe(false);
  });

  it('sends a null room to take a device out of every room', () => {
    const req = editRequest({ device: device('lamp', 'kitchen'), name: 'Lamp', roomId: null });
    // Present and null, which the Pond reads as "none"; left out, it would keep the room.
    expect('room_id' in req && req.room_id === null).toBe(true);
  });

  it('reports why the Pond refused it', async () => {
    const client = { updateDevice: jest.fn().mockRejectedValue(new ApiError('PUT', 400, null, 'name_required')) };
    const outcome = await applyEdits(client, [{ device: device('lamp'), name: 'x', roomId: null }]);
    expect(describeEditOutcome(outcome, 1)).toBe(i18n.t('errors.deviceNameRequired'));
  });

  it('says something even when the Pond never answered', async () => {
    const client = { updateDevice: jest.fn().mockRejectedValue(new TypeError('Network request failed')) };
    const outcome = await applyEdits(client, [{ device: device('lamp'), name: 'Lamp', roomId: null }]);
    expect(describeEditOutcome(outcome, 1)).toBe(i18n.t('errors.deviceNotSaved'));
  });
});
