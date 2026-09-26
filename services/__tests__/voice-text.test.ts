import {
  checkDismissal,
  getToolAnnouncement,
  isWhisperArtifact,
  normalizeForSpeech,
  splitSentences,
  stripMarkdown,
} from '@/services/voice-text';

describe('splitSentences', () => {
  it('returns nothing for blank input', () => {
    expect(splitSentences('   ')).toEqual([]);
    expect(splitSentences('')).toEqual([]);
  });

  it('splits on sentence-ending punctuation followed by whitespace', () => {
    expect(splitSentences('Hello there. How are you? Great!')).toEqual([
      'Hello there.',
      'How are you?',
      'Great!',
    ]);
  });

  it('keeps a trailing partial sentence as the last, unflushed element', () => {
    expect(splitSentences('The weather today is')).toEqual(['The weather today is']);
  });

  it('does not split on a period at the very end with no trailing space', () => {
    expect(splitSentences('That is final.')).toEqual(['That is final.']);
  });

  it('does not split on common abbreviations', () => {
    expect(splitSentences('I saw Dr. Smith yesterday.')).toEqual(['I saw Dr. Smith yesterday.']);
    expect(splitSentences('Meet me at St. Mary\'s at noon.')).toEqual([
      "Meet me at St. Mary's at noon.",
    ]);
  });

  it('force-flushes at 250 characters even mid-sentence', () => {
    const long = 'a'.repeat(260);
    const result = splitSentences(long);
    expect(result[0].length).toBe(250);
    expect(result[1]).toBe('a'.repeat(10));
  });
});

describe('stripMarkdown', () => {
  it('removes code fences entirely', () => {
    expect(stripMarkdown('before ```const x = 1;``` after')).toBe('before after');
  });

  it('strips heading, blockquote, and list markers', () => {
    expect(stripMarkdown('# Heading\n\n> quoted\n\n- item one\n\n1. first')).toBe(
      'Heading. quoted. item one. first',
    );
  });

  it('unwraps links and images to just their label', () => {
    expect(stripMarkdown('See [the docs](https://example.com) for more')).toBe(
      'See the docs for more',
    );
    expect(stripMarkdown('![a photo](https://example.com/x.png)')).toBe('a photo');
  });

  it('unwraps bold, italic, strikethrough, and inline code', () => {
    expect(stripMarkdown('**bold** and _italic_ and ~~gone~~ and `code`')).toBe(
      'bold and italic and gone and code',
    );
  });

  it('collapses blank lines and repeated spaces', () => {
    expect(stripMarkdown('para one\n\n\npara two   with   spaces')).toBe(
      'para one. para two with spaces',
    );
  });
});

describe('normalizeForSpeech', () => {
  it('spells out temperature symbols', () => {
    // No space is inserted before the replacement — matches the ported rule verbatim.
    expect(normalizeForSpeech('It is 20°C outside')).toBe('It is 20degrees Celsius outside');
  });

  it('spells out currency', () => {
    expect(normalizeForSpeech('It costs $5 and €3')).toBe('It costs 5 dollars and 3 euros');
  });

  it('expands common abbreviations', () => {
    expect(normalizeForSpeech('e.g. this, i.e. that')).toBe('for example this, that is that');
  });

  it('expands units', () => {
    expect(normalizeForSpeech('a 2kg weight and 500ms delay')).toBe(
      'a 2 kilograms weight and 500 milliseconds delay',
    );
  });

  it('spells out percent and math symbols', () => {
    expect(normalizeForSpeech('50% and ± 2 and π')).toBe('50 percent and plus or minus 2 and pi');
  });
});

describe('isWhisperArtifact', () => {
  it('rejects empty and very short transcripts', () => {
    expect(isWhisperArtifact('')).toBe(true);
    expect(isWhisperArtifact('  ')).toBe(true);
    expect(isWhisperArtifact('ok')).toBe(true);
  });

  it('rejects bracketed/parenthetical noise markers', () => {
    expect(isWhisperArtifact('[BLANK_AUDIO]')).toBe(true);
    expect(isWhisperArtifact('(inaudible)')).toBe(true);
  });

  it('rejects known hallucinated phrases case-insensitively', () => {
    expect(isWhisperArtifact('Thank you.')).toBe(true);
    expect(isWhisperArtifact('thanks for watching')).toBe(true);
  });

  it('rejects a repeated single word', () => {
    expect(isWhisperArtifact('uh uh uh')).toBe(true);
  });

  it('accepts a real transcript', () => {
    expect(isWhisperArtifact("What's the weather like today?")).toBe(false);
  });
});

describe('checkDismissal', () => {
  it('matches whole-utterance dismissal phrases', () => {
    expect(checkDismissal('bye')).toEqual({ dismissed: true, isExit: false });
    expect(checkDismissal('Goodbye!')).toEqual({ dismissed: true, isExit: false });
    expect(checkDismissal('  stop.  ')).toEqual({ dismissed: true, isExit: false });
  });

  it('matches whole-utterance exit phrases', () => {
    expect(checkDismissal('exit')).toEqual({ dismissed: true, isExit: true });
    expect(checkDismissal('Quit')).toEqual({ dismissed: true, isExit: true });
  });

  it('does not match a dismissal phrase used as a substring', () => {
    expect(checkDismissal('stop the kitchen timer')).toEqual({ dismissed: false, isExit: false });
  });

  it('does not flag ordinary speech', () => {
    expect(checkDismissal("what's on my schedule today")).toEqual({
      dismissed: false,
      isExit: false,
    });
  });
});

describe('getToolAnnouncement', () => {
  it('returns a known announcement for a recognized tool', () => {
    expect(getToolAnnouncement('weather')).toBe('Let me check the weather.');
  });

  it('falls back to a generic announcement for an unknown tool', () => {
    expect(getToolAnnouncement('some_unknown_tool')).toBe('Working on that.');
  });
});
