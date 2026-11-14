import { latexToUnicode } from '../latex';

describe('latexToUnicode', () => {
  it.each([
    ['x^2 + y^2 = z^2', 'x² + y² = z²'],
    ['\\frac{1}{2}', '½'],
    ['\\frac{a+b}{c}', '(a + b)/c'],
    ['\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', '∑ᵢ₌₁ⁿ i = (n(n + 1))/2'],
    ['\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}', '∫₀^∞ e^(−x²) dx = √π/2'],
    ['\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1', 'lim_(x → 0) (sin x)/x = 1'],
    ['\\sqrt[3]{x+1}', '³√(x + 1)'],
    ['v = \\sqrt{2gh}', 'v = √(2gh)'],
    ['\\sqrt{392} \\approx 19.8', '√392 ≈ 19.8'],
    ['E = mc^2', 'E = mc²'],
    ['\\alpha + \\beta \\leq \\gamma', 'α + β ≤ γ'],
    ['x \\in \\mathbb{R}^n', 'x ∈ ℝⁿ'],
    ['30^\\circ', '30°'],
    ['10^{-3}', '10⁻³'],
    ['x^10', 'x¹⁰'],
    ['A^T', 'Aᵀ'],
    ['a \\cdot b \\times c', 'a · b × c'],
    ['\\left( \\frac{a}{b} \\right)', '(a/b)'],
    ['\\hat{x}', 'x\u0302'],
    ['x = -1', 'x = −1'],
  ])('sets %s as %s', (tex, text) => {
    expect(latexToUnicode(tex)).toBe(text);
  });

  it('keeps the characters TeX escapes, dollar and percent among them', () => {
    expect(latexToUnicode('\\$5 \\% \\{x\\} \\& \\#1 \\_')).toBe('$5 % {x} & #1 _');
  });

  it('keeps words in \\text as typed', () => {
    expect(latexToUnicode('\\text{cost-free, if } x > 0')).toBe('cost-free, if x > 0');
  });

  it('keeps a command it has no character for as written, rather than dropping it', () => {
    expect(latexToUnicode('\\unknown{x} + \\weird')).toBe('\\unknown{x} + \\weird');
  });

  it('lays a matrix and a case split out in rows', () => {
    expect(latexToUnicode('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}')).toBe('⎛1\u20032⎞\n⎝3\u20034⎠');
    expect(latexToUnicode('|x| = \\begin{cases} x & x \\ge 0 \\\\ -x & \\text{otherwise} \\end{cases}')).toBe(
      '|x| =\n⎧x\u2003x ≥ 0\n⎩−x\u2003otherwise',
    );
  });

  it('never throws on TeX cut off mid-stream', () => {
    for (const tex of ['\\frac{a', '\\sqrt[', 'x^', '\\begin{cases} x &', '{{{', '\\']) {
      expect(() => latexToUnicode(tex)).not.toThrow();
    }
  });
});
