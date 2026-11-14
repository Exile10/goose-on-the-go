/**
 * TeX, as the characters a phone can set in its own type.
 *
 * Models write their math in TeX. A KaTeX WebView would bring its own fonts and a native module,
 * while nearly everything a reply carries — Greek, operators, scripts, fractions, roots — has a
 * Unicode character of its own. A command with none is kept as written, never dropped.
 */

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο',
  pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ',
  Psi: 'Ψ', Omega: 'Ω',
  times: '×', div: '÷', cdot: '·', ast: '∗', star: '⋆', pm: '±', mp: '∓', circ: '∘', bullet: '•',
  oplus: '⊕', otimes: '⊗', odot: '⊙', wedge: '∧', land: '∧', vee: '∨', lor: '∨', neg: '¬', lnot: '¬',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', leqslant: '⩽', geqslant: '⩾', neq: '≠', ne: '≠', approx: '≈',
  equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫', mid: '∣', parallel: '∥',
  perp: '⊥', models: '⊨', vdash: '⊢', top: '⊤', bot: '⊥',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪',
  cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', nexists: '∄',
  to: '→', rightarrow: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔', Rightarrow: '⇒',
  Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹', impliedby: '⟸', iff: '⟺', mapsto: '↦',
  longrightarrow: '⟶', longleftarrow: '⟵', uparrow: '↑', downarrow: '↓',
  infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬',
  iiint: '∭', oint: '∮', ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
  angle: '∠', triangle: '△', square: '□', degree: '°', prime: '′', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ',
  Im: 'ℑ', aleph: 'ℵ', therefore: '∴', because: '∵', checkmark: '✓', dagger: '†',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', vert: '|', lvert: '|',
  rvert: '|', Vert: '‖', lVert: '‖', rVert: '‖', lbrace: '{', rbrace: '}', backslash: '\\',
  quad: ' ', qquad: '  ', euro: '€', pounds: '£',
};

/** `\,` and its kin: one character after the backslash. */
const SINGLE: Record<string, string> = {
  ',': ' ', ';': ' ', ':': ' ', '>': ' ', ' ': ' ', '!': '', '\\': '\n', '|': '‖',
};

const FUNCTIONS = new Set(
  'sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth log ln lg exp lim liminf limsup max min sup inf det gcd lcm arg deg dim ker hom Pr'.split(' '),
);

/** Read as math: a bold or upright letter is still the letter. */
const MATH_FONTS = new Set(
  'mathrm mathbf mathit mathsf mathtt mathnormal mathcal mathscr mathfrak boldsymbol bm operatorname boxed fbox overbrace underbrace'.split(' '),
);

/** Read as words, so spaces and hyphens stay as typed. */
const TEXT_FONTS = new Set('text textrm textbf textit textsf texttt textnormal textup mbox hbox emph'.split(' '));

/** Commands that only size or space what follows. */
const SILENT = new Set(
  'displaystyle textstyle scriptstyle scriptscriptstyle limits nolimits nonumber notag left right middle big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr Biggl Biggr'.split(' '),
);

const DROP_ARG = new Set('label phantom hphantom vphantom color'.split(' '));
const SPACE_ARG = new Set('hspace vspace kern mkern mskip hskip'.split(' '));

const ACCENTS: Record<string, string> = {
  hat: '̂', widehat: '̂', bar: '̄', overline: '̅', vec: '⃗', dot: '̇',
  ddot: '̈', tilde: '̃', widetilde: '̃', underline: '̲', cancel: '̶',
  bcancel: '̶', xcancel: '̶', sout: '̶',
};
/** Accents that run the whole width of what they mark. */
const SPANNING = new Set(['overline', 'underline', 'cancel', 'bcancel', 'xcancel', 'sout']);

const DOUBLE_STRUCK: Record<string, string> = { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' };

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ',
  n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
  A: 'ᴬ', B: 'ᴮ', D: 'ᴰ', E: 'ᴱ', G: 'ᴳ', H: 'ᴴ', I: 'ᴵ', J: 'ᴶ', K: 'ᴷ', L: 'ᴸ', M: 'ᴹ', N: 'ᴺ',
  O: 'ᴼ', P: 'ᴾ', R: 'ᴿ', T: 'ᵀ', U: 'ᵁ', V: 'ⱽ', W: 'ᵂ',
  'α': 'ᵅ', 'β': 'ᵝ', 'γ': 'ᵞ', 'δ': 'ᵟ', 'θ': 'ᶿ', 'ϕ': 'ᵠ', 'φ': 'ᵠ', 'χ': 'ᵡ',
  '∘': '°', '′': '′', "'": '′', '*': '*', '∗': '*', '†': '†', '⊤': 'ᵀ', ',': ',', '.': '.',
};

const SUBSCRIPT: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ',
  s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
  'β': 'ᵦ', 'γ': 'ᵧ', 'ρ': 'ᵨ', 'ϕ': 'ᵩ', 'φ': 'ᵩ', 'χ': 'ᵪ', ',': ',', '.': '.',
};

const VULGAR: Record<string, string> = {
  '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/5': '⅕', '1/6': '⅙', '1/8': '⅛',
  '3/8': '⅜', '5/8': '⅝', '7/8': '⅞',
};

/** Left and right pieces for one row, then for the top, middle and bottom of several. */
const DELIMITERS: Record<string, [string, string, string, string]> = {
  pmatrix: ['(', ')', '⎛⎜⎝', '⎞⎟⎠'],
  bmatrix: ['[', ']', '⎡⎢⎣', '⎤⎥⎦'],
  Bmatrix: ['{', '}', '⎧⎨⎩', '⎫⎬⎭'],
  vmatrix: ['|', '|', '|||', '|||'],
  Vmatrix: ['‖', '‖', '‖‖‖', '‖‖‖'],
  cases: ['{', '', '⎧⎨⎩', ''],
  dcases: ['{', '', '⎧⎨⎩', ''],
};
const GRIDS = new Set(['matrix', 'smallmatrix', 'array', ...Object.keys(DELIMITERS)]);

/** A column break inside an environment, until the environment decides what it becomes. */
const CELL = '';

const RELATIONS = '=≠≤≥<>≈≡∼≃≅∝→←↔⇒⇐⇔⟹⟸⟺⟶⟵↦∈∉∋⊂⊆⊃⊇×÷·≪≫⊨⊢⩽⩾';
const SIGNS = '+−±∓';
const OPENERS = '([{⟨⌊⌈';
/** After these a sign starts a term rather than joining two: the start of a matrix row or a case. */
const STARTS = `${OPENERS}⎛⎜⎝⎡⎢⎣⎧⎨⎩ `;

function script(text: string, map: Record<string, string>, mark: '^' | '_'): string {
  const plain = text.replace(/\s+/g, '');
  if (!plain) return '';
  const chars = Array.from(plain);
  if (chars.every((c) => c in map)) return chars.map((c) => map[c]).join('');
  return chars.length === 1 ? `${mark}${plain}` : `${mark}(${plain})`;
}

const atomic = (text: string) => !/[\s+\-−=<>±×÷·/]/.test(text);

function fraction(top: string, bottom: string): string {
  const a = top.trim();
  const b = bottom.trim();
  return VULGAR[`${a}/${b}`] ?? `${atomic(a) ? a : `(${a})`}/${atomic(b) ? b : `(${b})`}`;
}

function accent(text: string, mark: string, spanning: boolean): string {
  const chars = Array.from(text);
  if (chars.length === 0) return '';
  if (spanning) return chars.map((c) => (c === ' ' ? c : c + mark)).join('');
  return text + mark;
}

function grid(env: string, body: string): string {
  const rows = body
    .split('\n')
    .map((row) => row.split(CELL).map((cell) => cell.trim()))
    .filter((cells) => cells.some(Boolean));
  const join = GRIDS.has(env) ? ' ' : '';
  const lines = rows.map((cells) => cells.join(join));
  const pieces = DELIMITERS[env];
  if (!pieces) return lines.join('\n');
  const [left, right, lefts, rights] = pieces;
  if (lines.length === 1) return `${left}${lines[0]}${right}`;
  const piece = (set: string, i: number) => {
    const parts = Array.from(set);
    if (parts.length === 0) return '';
    return i === 0 ? parts[0] : i === lines.length - 1 ? parts[2] : parts[1];
  };
  return lines.map((line, i) => `${piece(lefts, i)}${line}${piece(rights, i)}`).join('\n');
}

class TexReader {
  private at = 0;

  constructor(private readonly src: string) {}

  read(): string {
    return this.sequence(null);
  }

  private peek(): string {
    return this.src[this.at] ?? '';
  }

  private skipSpace(): boolean {
    const from = this.at;
    while (this.at < this.src.length && /\s/.test(this.src[this.at])) this.at += 1;
    return this.at > from;
  }

  private sequence(close: '}' | null, env?: string): string {
    let out = '';
    while (this.at < this.src.length) {
      if (close && this.peek() === close) {
        this.at += 1;
        return out;
      }
      if (env) {
        const end = /^\\end\s*\{([^}]*)\}/.exec(this.src.slice(this.at, this.at + 40));
        if (end && end[1] === env) {
          this.at += end[0].length;
          return out;
        }
      }
      out += this.piece();
    }
    return out;
  }

  /** One argument: a braced group, a command, or a single character. */
  private arg(): string {
    this.skipSpace();
    const ch = this.peek();
    if (!ch) return '';
    if (ch === '{') {
      this.at += 1;
      return this.sequence('}');
    }
    if (ch === '\\') return this.command();
    const cp = String.fromCodePoint(this.src.codePointAt(this.at) ?? 0);
    this.at += cp.length;
    return cp === '-' ? '−' : cp;
  }

  /** A braced group read as words, with only TeX's escapes undone. */
  private words(): string {
    this.skipSpace();
    if (this.peek() !== '{') return this.arg();
    let depth = 0;
    let out = '';
    while (this.at < this.src.length) {
      const ch = this.src[this.at];
      this.at += 1;
      if (ch === '{') {
        if (depth++ > 0) out += ch;
      } else if (ch === '}') {
        if (--depth === 0) break;
        out += ch;
      } else if (ch === '\\' && /[%$&#_{}]/.test(this.peek())) {
        out += this.src[this.at];
        this.at += 1;
      } else {
        out += ch;
      }
    }
    return out;
  }

  private optional(): string | null {
    this.skipSpace();
    if (this.peek() !== '[') return null;
    const close = this.src.indexOf(']', this.at);
    if (close < 0) return null;
    const inner = new TexReader(this.src.slice(this.at + 1, close)).read();
    this.at = close + 1;
    return inner;
  }

  /** What a `^` or `_` raises: a run of digits is taken whole, since `x^10` means x to the tenth. */
  private script(): string {
    this.skipSpace();
    const digits = /^-?\d+/.exec(this.src.slice(this.at, this.at + 16));
    if (digits) {
      this.at += digits[0].length;
      return digits[0].replace('-', '−');
    }
    return this.arg();
  }

  private piece(): string {
    const ch = this.peek();
    if (/\s/.test(ch)) {
      this.skipSpace();
      return ' ';
    }
    switch (ch) {
      case '{':
        this.at += 1;
        return this.sequence('}');
      case '}':
        this.at += 1;
        return '';
      case '^':
      case '_': {
        this.at += 1;
        const raised = ch === '^' ? script(this.script(), SUPERSCRIPT, '^') : script(this.script(), SUBSCRIPT, '_');
        // A script written out as `^∞` needs a gap, or `∫₀^∞e` reads as one exponent.
        return raised.startsWith(ch) && /[\w\\]/.test(this.peek()) ? `${raised} ` : raised;
      }
      case '\\':
        return this.command();
      case '&':
        this.at += 1;
        return CELL;
      case '~':
        this.at += 1;
        return ' ';
      default: {
        const cp = String.fromCodePoint(this.src.codePointAt(this.at) ?? 0);
        this.at += cp.length;
        return cp === '-' ? '−' : cp;
      }
    }
  }

  private command(): string {
    const m = /^\\(?:([a-zA-Z]+)\*?|([\s\S]))/.exec(this.src.slice(this.at, this.at + 64));
    if (!m) {
      this.at += 1;
      return '\\';
    }
    this.at += m[0].length;
    if (m[2] !== undefined) return SINGLE[m[2]] ?? m[2];
    const name = m[1];
    if (name in SYMBOLS) {
      this.skipSpace();
      return SYMBOLS[name];
    }
    if (FUNCTIONS.has(name)) {
      this.skipSpace();
      return /^[(^_[]?$/.test(this.peek()) ? name : `${name} `;
    }
    if (MATH_FONTS.has(name)) return this.arg();
    if (TEXT_FONTS.has(name)) return this.words();
    if (SILENT.has(name)) {
      this.skipSpace();
      if (this.peek() === '.') this.at += 1;
      return '';
    }
    if (DROP_ARG.has(name)) {
      this.arg();
      return '';
    }
    if (SPACE_ARG.has(name)) {
      this.arg();
      return ' ';
    }
    if (name in ACCENTS) return accent(this.arg(), ACCENTS[name], SPANNING.has(name));
    switch (name) {
      case 'frac':
      case 'dfrac':
      case 'tfrac':
      case 'cfrac':
        return fraction(this.arg(), this.arg());
      case 'binom':
      case 'dbinom':
      case 'tbinom':
        return `C(${this.arg().trim()}, ${this.arg().trim()})`;
      case 'sqrt': {
        const index = this.optional();
        const body = this.arg().trim();
        // A bar covers the whole radicand in TeX; without one, `√2gh` reads as √2 times gh.
        const bare = Array.from(body).length === 1 || /^\d+(\.\d+)?$/.test(body);
        const root = `√${bare ? body : `(${body})`}`;
        return index ? script(index, SUPERSCRIPT, '^') + root : root;
      }
      case 'mathbb':
        return Array.from(this.arg()).map((c) => DOUBLE_STRUCK[c] ?? c).join('');
      case 'not':
        return `${this.arg()}̸`;
      case 'textcolor':
        this.arg();
        return this.arg();
      case 'overset':
      case 'stackrel': {
        const over = this.arg();
        return this.arg() + script(over, SUPERSCRIPT, '^');
      }
      case 'underset': {
        const under = this.arg();
        return this.arg() + script(under, SUBSCRIPT, '_');
      }
      case 'substack':
        return this.arg().replace(/\n/g, ',');
      case 'tag':
        return ` (${this.words()})`;
      case 'mod':
      case 'bmod':
        return ' mod ';
      case 'pmod':
        return ` (mod ${this.arg().trim()})`;
      case 'begin': {
        const env = this.words().trim();
        if (env === 'array') this.words();
        return `\n${grid(env, this.sequence(null, env))}\n`;
      }
      case 'end':
        this.words();
        return '';
      default: {
        if (this.peek() === '{') return `\\${name}{${this.arg()}}`;
        return `\\${name}${this.skipSpace() ? ' ' : ''}`;
      }
    }
  }
}

function binarySigns(text: string): string {
  return text.replace(/[ \t]*([+−±∓])[ \t]*/g, (match, sign: string, offset: number) => {
    const prev = text.slice(0, offset).replace(/[ \t]+$/, '').slice(-1);
    const unary = !prev || prev === '\n' || prev === ',' || STARTS.includes(prev) || RELATIONS.includes(prev) || SIGNS.includes(prev);
    if (!unary) return ` ${sign} `;
    return /^[ \t]/.test(match) && prev && prev !== '\n' ? ` ${sign}` : sign;
  });
}

/** Spaces where TeX would set them: around relations and binary signs, and not inside brackets. */
function tidy(text: string): string {
  const relation = new RegExp(`[ \\t]*([${RELATIONS}])[ \\t]*`, 'g');
  return binarySigns(text.replace(relation, ' $1 '))
    .replace(/([([{⟨⌊⌈])[ \t]+/g, '$1')
    .replace(/[ \t]+([)\]}⟩⌋⌉,])/g, '$1')
    .split(CELL)
    .join(' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{2,}/g, '\n');
}

export function latexToUnicode(tex: string): string {
  return tidy(new TexReader(tex).read());
}
