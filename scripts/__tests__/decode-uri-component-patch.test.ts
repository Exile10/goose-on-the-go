import queryString from 'query-string';

// expo-router reads every link's query with query-string 7, whose decode-uri-component 0.2.2 is
// patched in patches/ with 0.5.1's single-pass decoder; unpatched, this input overflows the stack.
describe('decoding a malformed link query', () => {
  it('keeps truncated sequences as they were, without recursing', () => {
    const run = '%E0%A4'.repeat(6400);
    expect(queryString.parse(`q=${run}`).q).toBe(run);
  });

  it('still decodes what it can around them', () => {
    expect(queryString.parse('q=caf%C3%A9+au+lait&x=%')).toEqual({ q: 'café au lait', x: '%' });
    expect(queryString.parse('q=%C3%A9%E0%A4').q).toBe('é%E0%A4');
  });
});
