/**
 * The Pond's end of the setup channel, for tests: a `SetupLink` whose other side reassembles the
 * phone's writes, runs CPace as the initiator, seals as pond-setup-channel.md says, and answers
 * `status`, `wifi_scan` and `wifi_join` from its options.
 *
 * Built from the same primitives as the client, so it proves the two halves agree with each other,
 * not with the Pond. Byte-for-byte agreement waits for the Pond's `setup-channel-vectors.json`.
 */
import { concatBytes, equalBytes } from '@noble/curves/utils.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { randomBytes } from 'node:crypto';

import {
  calculateGenerator,
  channelIdentifier,
  channelLabel,
  CLIENT_CONFIRM_LABEL,
  confirmationKey,
  confirmationTag,
  intermediateSessionKey,
  sampleScalar,
  scalarMult,
  scalarMultVfy,
  SERVER_CONFIRM_LABEL,
} from '../../cpace';
import { chunk, encodeFrame, FrameReader } from '../../setup-channel/framing';
import { channelKeys, openMessage, SealedDirection, sealMessage } from '../../setup-channel/sealing';
import type { SetupLink } from '../../setup-channel/session';

type Message = Record<string, unknown>;

const NO_AD = new Uint8Array(0);
const random = (n: number) => new Uint8Array(randomBytes(n));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

export const POND_PIN = `sha256/${Buffer.alloc(32, 7).toString('base64')}`;
export const SETUP_CODE = '12345678903';

export interface FakePondOptions {
  pin?: string;
  /** The card id `hello` reports as `pond_id`. */
  pondId?: string;
  /** What `hello` claims the pin is; a relay substituting its own. */
  helloPin?: string;
  setupCode?: string;
  pairingCode?: string;
  claimed?: boolean;
  protocol?: number;
  /** The phone's largest write, ATT_MTU - 3. */
  writeSize?: number;
  /** The Pond's largest notification. */
  notifySize?: number;
  network?: { state: string; ssid?: string; ipv4?: string };
  networks?: Message[];
  /** How `wifi_join` answers; the default joins at 192.168.1.40:4443. */
  join?: (request: Message) => Message;
  /** Answers a request type with this instead, before anything else is checked. */
  refuse?: Partial<Record<string, Message>>;
  /** Rewrites any answer before it is framed, sealed or not: for a Pond that sends what it should not. */
  rewrite?: (type: string, answer: Message) => Message;
  /** Sends nothing back for these types. */
  silent?: string[];
}

export interface FakePond {
  link: SetupLink;
  /** Every request the Pond read, opened. */
  requests: Message[];
  /** Every frame the phone wrote, as it crossed the air: sealed envelopes stay sealed here. */
  wire: Message[];
  /** Every write the phone made, by length. */
  writes: number[];
  /** Drop the link from the Pond's end. */
  drop: () => void;
  /** Push raw bytes at the phone, as if the Pond had notified them. */
  notify: (bytes: Uint8Array) => void;
  /** The last sealed envelope the Pond sent, for a replay. */
  lastSealed: () => Message | null;
  closed: () => boolean;
}

/** As the Pond refuses a verify: `ok: false`, the reason in both `error` and `rejection_reason`. */
function refusedVerify(base: Message, reason: string): Message {
  return { ...base, ok: false, accepted: false, error: reason, rejection_reason: reason };
}

export function fakePond(options: FakePondOptions = {}): FakePond {
  const pin = options.pin ?? POND_PIN;
  const dataListeners = new Set<(bytes: Uint8Array) => void>();
  const closeListeners = new Set<(error?: Error) => void>();
  const reader = new FrameReader();
  const requests: Message[] = [];
  const wire: Message[] = [];
  const writes: number[] = [];
  let run: { ya: bigint; share: Uint8Array; sid: Uint8Array; setup: boolean; clientId: string } | null = null;
  let toPhone: SealedDirection | null = null;
  let fromPhone: SealedDirection | null = null;
  let isClosed = false;
  let lastSealed: Message | null = null;
  let inits = 0;

  const deliver = (bytes: Uint8Array) => {
    setTimeout(() => {
      if (!isClosed) dataListeners.forEach((l) => l(bytes));
    }, 0);
  };

  const send = (type: string, answer: Message, sealWith: SealedDirection | null) => {
    const shaped = options.rewrite ? options.rewrite(type, answer) : answer;
    const envelope = sealWith ? sealMessage(sealWith, shaped) : shaped;
    if (sealWith) lastSealed = envelope;
    for (const part of chunk(encodeFrame(envelope), options.notifySize ?? 182)) deliver(part.slice());
  };

  const answerTo = (request: Message): Message => {
    const { id, type } = request;
    const base = { id, type };
    const refused = options.refuse?.[String(type)];
    if (refused) return { ...base, ...refused };
    switch (type) {
      case 'hello':
        return { ...base, ok: true, protocol: options.protocol ?? 1, pond_id: options.pondId ?? 'c1cd', claimed: options.claimed ?? false,
          pin: options.helloPin ?? pin, capabilities: ['wifi_scan', 'wifi_join', 'spoken_code'] };
      case 'spoken_code':
        return { ...base, ok: true, spoken: true, expires_at: '2026-10-17T12:10:00Z' };
      case 'pake_init': {
        // The contract's limit: a fourth run on one connection is refused and the session ends.
        if (++inits > 3) {
          setTimeout(shut, 20);
          return { ...base, ok: false, error: 'too_many_attempts' };
        }
        const setup = request.credential === 'setup';
        const challenge = random(32);
        const sid = concatBytes(challenge, unb64(String(request.client_nonce)));
        const secret = setup ? options.setupCode ?? SETUP_CODE : options.pairingCode ?? '';
        const credential = setup ? 'setup' : 'pairing';
        const g = calculateGenerator(utf8ToBytes(secret), channelIdentifier(pin, String(request.client_id), channelLabel(credential)), sid);
        const ya = sampleScalar(random);
        run = { ya, share: scalarMult(ya, g), sid, setup, clientId: String(request.client_id) };
        return { ...base, ok: true, challenge_id: 'c1', challenge: b64(challenge), expires_at: '',
          suite: 'CPACE-RISTR255-SHA512', share: b64(run.share) };
      }
      case 'pake_verify': {
        if (!run || request.challenge_id !== 'c1') return refusedVerify(base, 'unknown_challenge');
        const { ya, share, sid } = run;
        run = null;
        const yb = unb64(String(request.share));
        const k = scalarMultVfy(ya, yb);
        const isk = intermediateSessionKey(sid, k, share, NO_AD, yb, NO_AD);
        const macKey = confirmationKey(sid, isk);
        if (!equalBytes(hexToBytes(String(request.confirm)), confirmationTag(CLIENT_CONFIRM_LABEL, macKey, share, yb))) {
          return refusedVerify(base, 'invalid_confirmation');
        }
        const keys = channelKeys(isk, sid);
        toPhone = new SealedDirection(keys.pondToPhone);
        fromPhone = new SealedDirection(keys.phoneToPond);
        const sealed = sealMessage(toPhone, { session_token: 'session', refresh_token: 'refresh', expires_at: '2026-10-18T00:00:00Z' });
        return { ...base, ok: true, accepted: true, server_proof: bytesToHex(confirmationTag(SERVER_CONFIRM_LABEL, macKey, share, yb)), ...sealed };
      }
      case 'status':
        if (!fromPhone) return { ...base, ok: false, error: 'wrong_phase' };
        return { ...base, ok: true, claimed: true, onboarded: false,
          network: options.network ?? { state: 'disconnected' }, https_port: 4443, hostname: 'nano' };
      case 'wifi_scan':
        return { ...base, ok: true, networks: options.networks ?? [
          { ssid: 'Home', security: 'wpa2', signal: 80, known: false },
          { ssid: 'Cafe', security: 'open', signal: 30, known: false },
        ] };
      case 'wifi_join':
        return { ...base, ...(options.join ? options.join(request) : { ok: true, address: '192.168.1.40', https_port: 4443, hostname: 'nano' }) };
      default:
        return { ...base, ok: false, error: 'unknown_type' };
    }
  };

  const shut = () => {
    if (isClosed) return;
    isClosed = true;
    closeListeners.forEach((l) => l(new Error('pond closed the session')));
  };

  const receive = (bytes: Uint8Array) => {
    writes.push(bytes.length);
    let messages: unknown[];
    try {
      messages = reader.push(bytes);
    } catch {
      shut();
      return;
    }
    for (const raw of messages) {
      wire.push(raw as Message);
      let request: Message;
      try {
        request = fromPhone ? openMessage(fromPhone, raw) : (raw as Message);
      } catch {
        shut();
        return;
      }
      requests.push(request);
      if (options.silent?.includes(String(request.type))) continue;
      const answer = answerTo(request);
      // pake_verify's answer is in the clear, carrying its own sealed field; every answer after it is sealed.
      const sealWith = request.type === 'pake_verify' || !fromPhone ? null : toPhone;
      send(String(request.type), answer, sealWith);
    }
  };

  const link: SetupLink = {
    writeSize: options.writeSize ?? 182,
    async write(bytes) {
      if (isClosed) throw new Error('link closed');
      if (bytes.length > (options.writeSize ?? 182)) throw new Error('write longer than the link takes');
      receive(bytes.slice());
    },
    onData(listener) {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    async close() {
      isClosed = true;
    },
  };

  return {
    link,
    requests,
    wire,
    writes,
    drop: shut,
    notify: deliver,
    lastSealed: () => lastSealed,
    closed: () => isClosed,
  };
}
