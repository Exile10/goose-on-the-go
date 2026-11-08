/**
 * The email Help & Feedback writes. Nothing is sent from here: the phone's mail app opens with the
 * whole email in view, and the person decides whether to send it.
 */

/** A problem report or a piece of feedback; the two differ only in their wording. */
export type SupportKind = 'problem' | 'feedback';

/** One line of the details at the foot of the email, already in the reader's language. */
export interface SupportDetail {
  label: string;
  value: string;
}

/** Room for the person to write first, then what they are running, set apart below a rule. */
export function supportBody(intro: string, details: SupportDetail[]): string {
  return [intro, '', '', '—', ...details.map((d) => `${d.label}: ${d.value}`)].join('\n');
}

/** A `mailto:` link the phone's mail app opens as a filled-in email. */
export function mailtoUrl(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
