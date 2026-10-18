/**
 * The setup channel's advertisement, keys, sealing and framing, byte for byte against the Pond's own vectors.
 *
 * `vectors/setup-channel-vectors.json` is a byte-identical copy of goose-in-a-pond's
 * `crates/pond-connect/tests/fixtures/setup-channel-vectors.json`. Its ISK and sid are the setup run's
 * outputs in `cpace-vectors.json`, so this suite and `pairing-exchange.test.ts` together cover a
 * claim from the first share to the first sealed Wi-Fi request.
 */
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { extract } from '@noble/hashes/hkdf.js';
import { sha512 } from '@noble/hashes/sha2.js';

import { cardIdFromService, cardIdOf, SETUP_ADVERT_PREFIX, setupAdvertUuid } from '@/models/nearby-pond';
import { SETUP_SERVICE_UUID } from '../ble';
import { chunk, encodeFrame, FrameReader } from '../setup-channel/framing';
import {
  channelKeys,
  counterNonce,
  openMessage,
  PHONE_TO_POND_INFO,
  POND_TO_PHONE_INFO,
  SealedDirection,
  sealMessage,
} from '../setup-channel/sealing';
import cpace from './vectors/cpace-vectors.json';
import vectors from './vectors/setup-channel-vectors.json';

const { advertisement, inputs, outputs, kdf, sealed, framed, wire } = vectors;
const isk = () => hexToBytes(inputs.ISK);
const sid = () => hexToBytes(inputs.sid);
const keyFor = (name: string) => hexToBytes(name === 'k_p2c' ? outputs.k_p2c : outputs.k_c2p);

describe('the Pond’s setup-channel vectors', () => {
  it('advertise the card id in the service UUID, and connect to the unchanged GATT service', () => {
    expect(advertisement.prefix).toBe(SETUP_ADVERT_PREFIX);
    expect(setupAdvertUuid(advertisement.pond_id)).toBe(advertisement.service_uuid);
    expect(cardIdFromService(advertisement.service_uuid)).toBe(advertisement.pond_id);
    expect(cardIdOf({ services: [advertisement.service_uuid], name: advertisement.local_name })).toBe(advertisement.pond_id);
    expect(advertisement.gatt_service_uuid).toBe(SETUP_SERVICE_UUID);
  });

  it('put the UUID on the air as one complete 128-bit list, least significant byte first', () => {
    const uuid = hexToBytes(advertisement.service_uuid.replaceAll('-', '')).reverse();
    expect(bytesToHex(new Uint8Array([uuid.length + 1, 0x07, ...uuid]))).toBe(advertisement.uuid_ad_structure);
  });

  it('start from the setup run’s own ISK and sid', () => {
    expect(inputs.ISK).toBe(cpace.setup.outputs.ISK);
    expect(inputs.sid).toBe(cpace.setup.outputs.sid);
    expect(wire.pake_verify_answer.server_proof).toBe(cpace.setup.outputs.T_server);
  });

  it('draw prk and both channel keys as the phone does', () => {
    expect(kdf.info_p2c).toBe(POND_TO_PHONE_INFO);
    expect(kdf.info_c2p).toBe(PHONE_TO_POND_INFO);
    expect(bytesToHex(extract(sha512, isk(), sid()))).toBe(outputs.prk);
    const keys = channelKeys(isk(), sid());
    expect(bytesToHex(keys.pondToPhone)).toBe(outputs.k_p2c);
    expect(bytesToHex(keys.phoneToPond)).toBe(outputs.k_c2p);
  });

  it.each(sealed.map((s) => [`${s.direction} ${s.counter}`, s] as const))('seal %s byte for byte', (_name, s) => {
    expect(bytesToHex(counterNonce(s.counter))).toBe(s.nonce);
    const ciphertext = new SealedDirection(keyFor(s.key), s.counter).seal(utf8ToBytes(s.plaintext));
    expect(bytesToHex(ciphertext)).toBe(s.ciphertext);
    expect(Buffer.from(ciphertext).toString('base64')).toBe(s.sealed);
    if ('envelope' in s && s.envelope) {
      expect(JSON.stringify(sealMessage(new SealedDirection(keyFor(s.key), s.counter), JSON.parse(s.plaintext)))).toBe(s.envelope);
    }
  });

  it('count each direction on its own, in session order', () => {
    const fromPond = new SealedDirection(keyFor('k_p2c'));
    const toPond = new SealedDirection(keyFor('k_c2p'));
    const order = sealed.map((s) => ({ ...s, direction: s.direction as 'pond_to_phone' | 'phone_to_pond' }));
    for (const s of order) {
      if (s.direction === 'pond_to_phone') {
        expect(openMessage(fromPond, { sealed: s.sealed })).toEqual(JSON.parse(s.plaintext));
      } else {
        expect(sealMessage(toPond, JSON.parse(s.plaintext)).sealed).toBe(s.sealed);
      }
    }
    expect(fromPond.counter).toBe(2);
    expect(toPond.counter).toBe(2);
  });

  it('open pake_verify’s tokens as they arrive on the wire', () => {
    const tokens = openMessage(new SealedDirection(keyFor('k_p2c')), { sealed: wire.pake_verify_answer.sealed });
    expect(tokens).toEqual(JSON.parse(sealed[0].plaintext));
    expect(wire.pake_verify_answer).toMatchObject({ ok: true, accepted: true, type: 'pake_verify' });
  });

  it.each(framed.messages.map((m, i) => [i, m] as const))('frame message %i and cut it at ATT_MTU 23', (_i, m) => {
    expect(framed.chunk_bytes).toBe(framed.att_mtu - 3);
    const frame = encodeFrame(JSON.parse(m.message));
    expect(bytesToHex(frame)).toBe(m.frame);
    expect(chunk(frame, framed.chunk_bytes).map(bytesToHex)).toEqual(m.chunks);
  });

  it('read the notifications back as the messages, one message per chunk run', () => {
    const reader = new FrameReader();
    const read = framed.notifications.flatMap((n) => reader.push(hexToBytes(n)));
    expect(read).toEqual(framed.messages.map((m) => JSON.parse(m.message)));
    expect(reader.midMessage).toBe(false);
  });
});
