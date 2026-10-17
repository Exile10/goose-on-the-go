/**
 * The setup card's parser and its code, held to the Pond's own cases in
 * `crates/pond-core/src/network/domain/setup_card.rs` and `setup_code.rs`, so a card one
 * side accepts the other does not refuse.
 */
import { URL as ExpoURL } from 'whatwg-url-minimum';

import {
  formatSetupCode,
  InvalidSetupCardError,
  isSetupCardLink,
  isValidSetupCode,
  luhnCheckDigit,
  parseSetupCard,
  readSetupCode,
  type SetupCardProblem,
} from '@/models/setup-card';

const QR = 'pond://setup?v=1&code=79927398713&id=7f3a';
const CARD = { code: '79927398713', id: '7f3a' };

function problem(raw: string): SetupCardProblem | 'parsed' {
  try {
    parseSetupCard(raw);
    return 'parsed';
  } catch (e) {
    if (!(e instanceof InvalidSetupCardError)) throw e;
    return e.problem;
  }
}

describe('the Luhn check digit', () => {
  it('matches the classic vector and the Pond\'s own', () => {
    expect(luhnCheckDigit('7992739871')).toBe(3);
    expect(luhnCheckDigit('0000000000')).toBe(0);
    expect(luhnCheckDigit('1234567890')).toBe(3);
    expect(luhnCheckDigit('3497011233')).toBe(9);
  });

  it('accepts the card codes the contract names', () => {
    expect(isValidSetupCode('79927398713')).toBe(true);
    expect(isValidSetupCode('34970112339')).toBe(true);
    expect(isValidSetupCode('00000000000')).toBe(true);
  });

  it('refuses anything but eleven bare ASCII digits', () => {
    for (const bad of ['', '3497011233', '349701123390', '3497-011-2339', '3497 011 2339', '\uFF134970112339']) {
      expect(isValidSetupCode(bad)).toBe(false);
    }
  });

  it('notices every single-digit substitution', () => {
    const digits = '79927398713';
    for (let position = 0; position < digits.length; position++) {
      for (const replacement of '0123456789') {
        if (replacement === digits[position]) continue;
        const typo = `${digits.slice(0, position)}${replacement}${digits.slice(position + 1)}`;
        expect(isValidSetupCode(typo)).toBe(false);
      }
    }
  });

  // Luhn's documented blind spot is a swapped 0 and 9; the Pond's test pins the same.
  it('notices every adjacent transposition except 09 and 90', () => {
    let blindSpots = 0;
    for (const valid of ['79927398713', '34970112339', '09123456783', '90550928643']) {
      expect(isValidSetupCode(valid)).toBe(true);
      for (let i = 0; i < valid.length - 1; i++) {
        if (valid[i] === valid[i + 1]) continue;
        const swapped = `${valid.slice(0, i)}${valid[i + 1]}${valid[i]}${valid.slice(i + 2)}`;
        const pair = `${valid[i]}${valid[i + 1]}`;
        if (pair === '09' || pair === '90') {
          blindSpots++;
          expect(isValidSetupCode(swapped)).toBe(true);
        } else {
          expect(isValidSetupCode(swapped)).toBe(false);
        }
      }
    }
    expect(blindSpots).toBeGreaterThan(0);
  });
});

describe('a typed setup code', () => {
  it('is grouped 4-3-4 as far as it goes', () => {
    expect(formatSetupCode('')).toBe('');
    expect(formatSetupCode('349')).toBe('349');
    expect(formatSetupCode('3497')).toBe('3497');
    expect(formatSetupCode('34970')).toBe('3497-0');
    expect(formatSetupCode('3497011')).toBe('3497-011');
    expect(formatSetupCode('34970112')).toBe('3497-011-2');
    expect(formatSetupCode('34970112339')).toBe('3497-011-2339');
  });

  it('keeps only digits, capped at eleven, so the dashes it shows can be typed over', () => {
    expect(readSetupCode('3497-011-2339')).toEqual({ digits: '34970112339', display: '3497-011-2339', status: 'valid' });
    expect(readSetupCode(' 3497 011 2339 ')).toMatchObject({ digits: '34970112339', status: 'valid' });
    expect(readSetupCode('3497-011-23391')).toMatchObject({ digits: '34970112339', status: 'valid' });
    expect(readSetupCode('3497-0l1-2339').digits).toBe('3497012339');
  });

  it('reads as incomplete until all eleven digits are in, then as a typo or valid', () => {
    expect(readSetupCode('').status).toBe('incomplete');
    expect(readSetupCode('3497-011-233').status).toBe('incomplete');
    expect(readSetupCode('3497-011-2338').status).toBe('typo');
    expect(readSetupCode('3497-011-2339').status).toBe('valid');
    // Two digits swapped, the commonest slip in copying a code off a card.
    expect(readSetupCode('3479-011-2339').status).toBe('typo');
  });
});

// Expo installs whatwg-url-minimum as the app's URL, so the parser must agree under both.
describe.each([
  ['Node', globalThis.URL],
  ['Expo', ExpoURL as unknown as typeof URL],
])('parseSetupCard under %s\'s URL', (_name, Impl) => {
  const original = globalThis.URL;
  beforeAll(() => { globalThis.URL = Impl; });
  afterAll(() => { globalThis.URL = original; });

  it('reads the documented shape, and tolerates whitespace from the decoder', () => {
    expect(parseSetupCard(QR)).toEqual(CARD);
    expect(parseSetupCard(`  ${QR}\n`)).toEqual(CARD);
    expect(parseSetupCard('pond://setup?v=1&code=34970112339&id=00be')).toEqual({ code: '34970112339', id: '00be' });
  });

  it('ignores parameter order and unknown parameters', () => {
    expect(parseSetupCard('pond://setup?id=7f3a&code=79927398713&v=1')).toEqual(CARD);
    expect(parseSetupCard(`${QR}&label=Kitchen&future=x`)).toEqual(CARD);
  });

  it('takes the id in either case and keeps it lowercase', () => {
    expect(parseSetupCard('pond://setup?v=1&code=79927398713&id=7F3A').id).toBe('7f3a');
  });

  it.each([
    ['3497-011-2339', 'not_a_url'],
    ['just some text', 'not_a_url'],
    ['https://setup?v=1&code=79927398713&id=7f3a', 'wrong_scheme'],
    ['pond://pair?v=1&code=79927398713&id=7f3a', 'wrong_host'],
    ['pond:setup?v=1&code=79927398713&id=7f3a', 'wrong_host'],
    ['pond://SETUP?v=1&code=79927398713&id=7f3a', 'wrong_host'],
    ['pond://setup/?v=1&code=79927398713&id=7f3a', 'unexpected_component'],
    ['pond://setup/x?v=1&code=79927398713&id=7f3a', 'unexpected_component'],
    ['pond://setup:80?v=1&code=79927398713&id=7f3a', 'unexpected_component'],
    ['pond://me@setup?v=1&code=79927398713&id=7f3a', 'unexpected_component'],
    ['pond://me:pw@setup?v=1&code=79927398713&id=7f3a', 'unexpected_component'],
    ['pond://setup?v=1&code=79927398713&id=7f3a#x', 'unexpected_component'],
    ['pond://setup?v=1&code=79927398713&id=7f3a#', 'unexpected_component'],
    ['pond://setup?v=1&code=79927398713&code=79927398713&id=7f3a', 'repeated_parameter'],
    ['pond://setup?v=1&v=1&code=79927398713&id=7f3a', 'repeated_parameter'],
    ['pond://setup?v=1&code=79927398713&id=7f3a&id=0001', 'repeated_parameter'],
    ['pond://setup?v=1&code=79927398713&id=7f3a&x=1&x=2', 'repeated_parameter'],
    ['pond://setup?code=79927398713&id=7f3a', 'missing_parameter'],
    ['pond://setup?v=1&id=7f3a', 'missing_parameter'],
    ['pond://setup?v=1&code=79927398713', 'missing_parameter'],
    ['pond://setup?v=2&code=79927398713&id=7f3a', 'unsupported_version'],
    ['pond://setup?v=01&code=79927398713&id=7f3a', 'unsupported_version'],
    ['pond://setup?v=1&code=7992-739-8713&id=7f3a', 'bad_code'],
    ['pond://setup?v=1&code=7992739871&id=7f3a', 'bad_code'],
    ['pond://setup?v=1&code=799273987130&id=7f3a', 'bad_code'],
    ['pond://setup?v=1&code=&id=7f3a', 'bad_code'],
    ['pond://setup?v=1&code=79927398714&id=7f3a', 'check_digit'],
    ['pond://setup?v=1&code=79927398713&id=7f3', 'bad_id'],
    ['pond://setup?v=1&code=79927398713&id=7f3a0', 'bad_id'],
    ['pond://setup?v=1&code=79927398713&id=7g3a', 'bad_id'],
    ['pond://setup?v=1&code=79927398713&id=+f3a', 'bad_id'],
  ] as const)('refuses %s as %s', (raw, expected) => {
    expect(problem(raw)).toBe(expected);
  });

  it('never puts the code in what it throws', () => {
    for (const raw of ['pond://setup?v=1&code=79927398714&id=7f3a', 'pond://setup?v=1&code=79927398713&id=zz']) {
      try { parseSetupCard(raw); } catch (e) {
        expect(String(e)).not.toMatch(/7992739871/);
      }
    }
  });

  it('tells a broken setup card from some other QR', () => {
    expect(isSetupCardLink(QR)).toBe(true);
    expect(isSetupCardLink('pond://setup?v=2&code=79927398713&id=7f3a')).toBe(true);
    expect(isSetupCardLink('pond://setup?v=1&code=79927398714&id=7f3a')).toBe(true);
    expect(isSetupCardLink('pond://pair?v=2&scheme=https&code=123456')).toBe(false);
    expect(isSetupCardLink('MT:Y.K9042C00KA0648G00')).toBe(false);
  });
});
