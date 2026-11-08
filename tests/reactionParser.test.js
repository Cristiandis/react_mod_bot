import { describe, test, expect } from 'bun:test';
import { emojiToText, extractReactionStrings, checkBadWords, isBlockedReaction } from '../src/reactionParser.js';

describe('Reaction Parser', () => {
  test('contains all regional indicators A-Z in EMOJI_MAP', () => {
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(97 + i);
      const unicode = String.fromCodePoint(0x1F1E6 + i);
      const colonName = `:regional_indicator_${letter}:`;
      const plainName = `regional_indicator_${letter}`;

      expect(emojiToText(unicode)).toBe(letter);
      expect(emojiToText(colonName)).toBe(letter);
      expect(emojiToText(plainName)).toBe(letter);
    }
  });

  test('converts regional indicator emoji names into letters', () => {
    expect(emojiToText(':regional_indicator_h:')).toBe('h');
    expect(emojiToText('regional_indicator_i')).toBe('i');
    expect(emojiToText(':regional_indicator_z:')).toBe('z');
  });

  test('converts unicode regional indicator flags into letters', () => {
    expect(emojiToText('🇭')).toBe('h');
    expect(emojiToText('🇮')).toBe('i');
    expect(emojiToText('🇦')).toBe('a');
    expect(emojiToText('🇿')).toBe('z');
  });

  test('converts special letter emojis', () => {
    expect(emojiToText('🅰️')).toBe('a');
    expect(emojiToText('🅱️')).toBe('b');
    expect(emojiToText('🅾️')).toBe('o');
    expect(emojiToText('🅿️')).toBe('p');
    expect(emojiToText('ℹ️')).toBe('i');
    expect(emojiToText('Ⓜ️')).toBe('m');
    expect(emojiToText('🆘')).toBe('sos');
    expect(emojiToText('🆒')).toBe('cool');
  });

  test('converts custom emoji names', () => {
    expect(emojiToText('letter_a')).toBe('a');
    expect(emojiToText('char_b')).toBe('b');
    expect(emojiToText('font_x')).toBe('x');
    expect(emojiToText('h')).toBe('h');
    expect(emojiToText('i')).toBe('i');
    expect(emojiToText('random_dog_pic')).toBe('');
  });

  test('extracts formed words and tracks exact reaction objects', () => {
    const r1 = { emoji: { name: 'regional_indicator_h' } };
    const r2 = { emoji: { name: 'regional_indicator_i' } };
    const { candidates, chunks } = extractReactionStrings([r1, r2]);
    expect(candidates).toEqual(['hi']);
    expect(chunks[0].reactions).toEqual([r1, r2]);

    const match = checkBadWords(chunks, ['hi']);
    expect(match.matched).toBe(true);
    expect(match.reactions).toEqual([r1, r2]);
  });

  test('handles mixed emojis and word chunks', () => {
    const reactions = [
      { emoji: { name: '🇭' } },
      { emoji: { name: '🇮' } },
      { emoji: { name: '😂' } },
      { emoji: { name: '🅱️' } },
      { emoji: { name: 'regional_indicator_a' } },
      { emoji: { name: 'regional_indicator_d' } }
    ];
    const { candidates } = extractReactionStrings(reactions);
    expect(candidates).toEqual(['hi', 'bad']);
  });

  test('does not match when random emoji is in the middle', () => {
    const reactions = [
      { emoji: { name: '🇭' } },
      { emoji: { name: '😂' } },
      { emoji: { name: '🇮' } }
    ];
    const { candidates } = extractReactionStrings(reactions);
    expect(candidates).toEqual(['h', 'i']);
    const match = checkBadWords(candidates, ['hi']);
    expect(match.matched).toBe(false);
  });

  test('detects bad words matching formed strings', () => {
    const badWords = ['hi', 'toxic', 'ez'];
    
    const res1 = checkBadWords(['hi'], badWords);
    expect(res1.matched).toBe(true);
    expect(res1.word).toBe('hi');

    const res2 = checkBadWords(['thisishiplease'], badWords, 'contains');
    expect(res2.matched).toBe(true);
    expect(res2.word).toBe('hi');

    const res3 = checkBadWords(['welcome', 'good'], badWords);
    expect(res3.matched).toBe(false);
  });

  test('detects blocked individual emoji reactions', () => {
    const badWords = ['🖕', 'clown', ':toxic:', '1234567890'];

    expect(isBlockedReaction({ emoji: { name: '🖕' } }, badWords).matched).toBe(true);
    expect(isBlockedReaction({ emoji: { name: 'clown' } }, badWords).matched).toBe(true);
    expect(isBlockedReaction({ emoji: { name: 'toxic' } }, badWords).matched).toBe(true);
    expect(isBlockedReaction({ emoji: { name: 'custom', id: '1234567890' } }, badWords).matched).toBe(true);
    expect(isBlockedReaction({ emoji: { name: '👍' } }, badWords).matched).toBe(false);
  });
});
