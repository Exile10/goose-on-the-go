// Help & Feedback's email: the details sit below the person's own words, and every character
// survives the trip through a mailto link.

import { mailtoUrl, supportBody } from '@/models/help';

describe('the support email', () => {
  it('leaves room to write first, then lists the details below a rule', () => {
    const body = supportBody('What happened?', [
      { label: 'App version', value: '1.4.0' },
      { label: 'Pond version', value: 'Not known' },
    ]);
    expect(body).toBe('What happened?\n\n\n—\nApp version: 1.4.0\nPond version: Not known');
  });

  it('writes a link a mail app reads back to the same subject and body', () => {
    const subject = 'A problem & a question?';
    const body = 'Line one\nLine two: 100% = done';
    const url = new URL(mailtoUrl('support@jarida.io', subject, body));
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe('support@jarida.io');
    expect(url.searchParams.get('subject')).toBe(subject);
    expect(url.searchParams.get('body')).toBe(body);
  });
});
