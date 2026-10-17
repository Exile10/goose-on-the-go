/** Ten random digits and a Luhn check digit, so a typo is caught before it costs the Pond a guess. */
export const SETUP_CODE_LENGTH = 11;

/** A Pond's printed setup card. It carries no pin: the setup exchange itself proves the Pond's. */
export interface SetupCard {
  /** The eleven digits with no separators, as the exchange uses them. */
  code: string;
  /** Four lowercase hex digits, matched against the `id` a Pond advertises over mDNS. */
  id: string;
}

/** Mirrors `SetupCardError` in the Pond's setup_card.rs, so both sides refuse the same cards. */
export type SetupCardProblem =
  | 'not_a_url'
  | 'wrong_scheme'
  | 'wrong_host'
  | 'unexpected_component'
  | 'repeated_parameter'
  | 'missing_parameter'
  | 'unsupported_version'
  | 'bad_code'
  | 'check_digit'
  | 'bad_id';

/** The message names the problem and never the code, so it is safe to log. */
export class InvalidSetupCardError extends Error {
  readonly problem: SetupCardProblem;

  constructor(problem: SetupCardProblem) {
    super(`not a usable setup card: ${problem}`);
    this.name = 'InvalidSetupCardError';
    this.problem = problem;
  }

  /** A `pond://setup` link that failed, as opposed to some other QR, which deserves its own sentence. */
  get isSetupLink(): boolean {
    return this.problem !== 'not_a_url' && this.problem !== 'wrong_scheme' && this.problem !== 'wrong_host';
  }
}

/** Luhn mod 10 over ASCII digits: the digit that makes the weighted sum a multiple of ten. */
export function luhnCheckDigit(payload: string): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const digit = payload.charCodeAt(payload.length - 1 - i) - 48;
    const weighted = i % 2 === 0 ? digit * 2 : digit;
    sum += weighted > 9 ? weighted - 9 : weighted;
  }
  return (10 - (sum % 10)) % 10;
}

/** Exactly eleven ASCII digits whose last is the Luhn check of the first ten. */
export function isValidSetupCode(digits: string): boolean {
  return /^[0-9]{11}$/.test(digits) &&
    luhnCheckDigit(digits.slice(0, SETUP_CODE_LENGTH - 1)) === Number(digits[SETUP_CODE_LENGTH - 1]);
}

/** The card's 4-3-4 grouping, applied as far as the digits go so the field reads like the card while typing. */
export function formatSetupCode(digits: string): string {
  return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7, SETUP_CODE_LENGTH)].filter(Boolean).join('-');
}

export type SetupCodeStatus = 'incomplete' | 'typo' | 'valid';

export interface SetupCodeEntry {
  digits: string;
  display: string;
  status: SetupCodeStatus;
}

/** Read a typed setup code, keeping only ASCII digits, as the six-digit field does. */
export function readSetupCode(typed: string): SetupCodeEntry {
  const digits = typed.replace(/[^0-9]/g, '').slice(0, SETUP_CODE_LENGTH);
  const status: SetupCodeStatus = digits.length < SETUP_CODE_LENGTH
    ? 'incomplete'
    : isValidSetupCode(digits) ? 'valid' : 'typo';
  return { digits, display: formatSetupCode(digits), status };
}

/** `pond://setup?v=1&code=<11 digits>&id=<4 hex>`, refused exactly where the Pond's parser refuses it. */
export function parseSetupCard(raw: string): SetupCard {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new InvalidSetupCardError('not_a_url'); }
  if (url.protocol !== 'pond:') throw new InvalidSetupCardError('wrong_scheme');
  if (url.hostname !== 'setup') throw new InvalidSetupCardError('wrong_host');
  // `hash` reads empty for a bare `#`, which the Pond still refuses as a fragment.
  if (url.pathname || url.port || url.username || url.password || url.href.includes('#')) {
    throw new InvalidSetupCardError('unexpected_component');
  }

  const seen = new Set<string>();
  for (const [name] of url.searchParams) {
    // Unknown names count too: two readers must not disagree on which value is meant.
    if (seen.has(name)) throw new InvalidSetupCardError('repeated_parameter');
    seen.add(name);
  }
  const version = url.searchParams.get('v');
  if (version === null) throw new InvalidSetupCardError('missing_parameter');
  if (version !== '1') throw new InvalidSetupCardError('unsupported_version');

  const code = url.searchParams.get('code');
  if (code === null) throw new InvalidSetupCardError('missing_parameter');
  // The card prints bare digits; separators are for people typing, not for a scanned code.
  if (!/^[0-9]{11}$/.test(code)) throw new InvalidSetupCardError('bad_code');
  if (!isValidSetupCode(code)) throw new InvalidSetupCardError('check_digit');

  const id = url.searchParams.get('id');
  if (id === null) throw new InvalidSetupCardError('missing_parameter');
  if (!/^[0-9a-fA-F]{4}$/.test(id)) throw new InvalidSetupCardError('bad_id');
  return { code, id: id.toLowerCase() };
}

/** Whether this text is a `pond://setup` link at all, valid or not, without throwing. */
export function isSetupCardLink(raw: string): boolean {
  try {
    parseSetupCard(raw);
    return true;
  } catch (e) {
    return e instanceof InvalidSetupCardError && e.isSetupLink;
  }
}
