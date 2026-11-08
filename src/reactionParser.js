export const EMOJI_MAP = {
  // Regional indicators (Unicode A-Z)
  '🇦': 'a', '🇧': 'b', '🇨': 'c', '🇩': 'd', '🇪': 'e', '🇫': 'f', '🇬': 'g',
  '🇭': 'h', '🇮': 'i', '🇯': 'j', '🇰': 'k', '🇱': 'l', '🇲': 'm', '🇳': 'n',
  '🇴': 'o', '🇵': 'p', '🇶': 'q', '🇷': 'r', '🇸': 's', '🇹': 't', '🇺': 'u',
  '🇻': 'v', '🇼': 'w', '🇽': 'x', '🇾': 'y', '🇿': 'z',

  // Regional indicators (:regional_indicator_x:)
  ':regional_indicator_a:': 'a', ':regional_indicator_b:': 'b', ':regional_indicator_c:': 'c',
  ':regional_indicator_d:': 'd', ':regional_indicator_e:': 'e', ':regional_indicator_f:': 'f',
  ':regional_indicator_g:': 'g', ':regional_indicator_h:': 'h', ':regional_indicator_i:': 'i',
  ':regional_indicator_j:': 'j', ':regional_indicator_k:': 'k', ':regional_indicator_l:': 'l',
  ':regional_indicator_m:': 'm', ':regional_indicator_n:': 'n', ':regional_indicator_o:': 'o',
  ':regional_indicator_p:': 'p', ':regional_indicator_q:': 'q', ':regional_indicator_r:': 'r',
  ':regional_indicator_s:': 's', ':regional_indicator_t:': 't', ':regional_indicator_u:': 'u',
  ':regional_indicator_v:': 'v', ':regional_indicator_w:': 'w', ':regional_indicator_x:': 'x',
  ':regional_indicator_y:': 'y', ':regional_indicator_z:': 'z',

  // Regional indicators (regional_indicator_x)
  'regional_indicator_a': 'a', 'regional_indicator_b': 'b', 'regional_indicator_c': 'c',
  'regional_indicator_d': 'd', 'regional_indicator_e': 'e', 'regional_indicator_f': 'f',
  'regional_indicator_g': 'g', 'regional_indicator_h': 'h', 'regional_indicator_i': 'i',
  'regional_indicator_j': 'j', 'regional_indicator_k': 'k', 'regional_indicator_l': 'l',
  'regional_indicator_m': 'm', 'regional_indicator_n': 'n', 'regional_indicator_o': 'o',
  'regional_indicator_p': 'p', 'regional_indicator_q': 'q', 'regional_indicator_r:': 'r',
  'regional_indicator_s': 's', 'regional_indicator_t': 't', 'regional_indicator_u': 'u',
  'regional_indicator_v': 'v', 'regional_indicator_w': 'w', 'regional_indicator_x': 'x',
  'regional_indicator_y': 'y', 'regional_indicator_z': 'z',

  // Squared letters & symbols
  '🅰️': 'a', '🅰': 'a',
  '🅱️': 'b', '🅱': 'b',
  '🅾️': 'o', '🅾': 'o',
  '🅿️': 'p', '🅿': 'p',
  'ℹ️': 'i', 'ℹ': 'i',
  'Ⓜ️': 'm', 'Ⓜ': 'm',
  '❌': 'x', '❎': 'x',
  '⭕': 'o', '➕': 't',
  '🆑': 'cl', '🆒': 'cool', '🆓': 'free', '🆔': 'id',
  '🆕': 'new', '🆖': 'ng', '🆗': 'ok', '🆘': 'sos',
  '🆙': 'up', '🆚': 'vs', '🔟': '10'
};

for (let i = 0; i <= 9; i++) {
  EMOJI_MAP[`${i}️⃣`] = String(i);
  EMOJI_MAP[`${i}\uFE0F\u20E3`] = String(i);
}

export function emojiToText(emoji) {
  if (!emoji) return '';
  let raw = '';
  if (typeof emoji === 'string') {
    raw = emoji;
  } else if (emoji.emoji?.name) {
    raw = emoji.emoji.name;
  } else if (emoji.name) {
    raw = emoji.name;
  }
  if (!raw) return '';

  if (EMOJI_MAP[raw]) return EMOJI_MAP[raw];

  const clean = raw.replace(/[\uFE0F\u20E3]/g, '').trim();
  if (EMOJI_MAP[clean]) return EMOJI_MAP[clean];

  const code = clean.codePointAt(0);
  if (code && code >= 0x1F1E6 && code <= 0x1F1FF) {
    return String.fromCharCode(97 + (code - 0x1F1E6));
  }

  const regMatch = raw.match(/^:?regional_indicator_([a-z]):?$/i);
  if (regMatch) return regMatch[1].toLowerCase();

  const letterMatch = raw.match(/^:?(?:letter|char|font)?[_-]?([a-z0-9]):?$/i);
  if (letterMatch) return letterMatch[1].toLowerCase();

  return '';
}

export function extractReactionStrings(reactions) {
  if (!Array.isArray(reactions) || reactions.length === 0) {
    return { candidates: [], chunks: [] };
  }

  const chunks = [];
  let currentChunk = '';
  let currentReactions = [];

  for (const r of reactions) {
    const char = emojiToText(r);
    if (char) {
      currentChunk += char;
      currentReactions.push(r);
    } else if (currentChunk) {
      chunks.push({
        text: currentChunk.toLowerCase(),
        reactions: currentReactions
      });
      currentChunk = '';
      currentReactions = [];
    }
  }
  if (currentChunk) {
    chunks.push({
      text: currentChunk.toLowerCase(),
      reactions: currentReactions
    });
  }

  return {
    candidates: chunks.map(c => c.text),
    chunks
  };
}

export function isBlockedReaction(reaction, badWords) {
  if (!reaction || !badWords || badWords.length === 0) return { matched: false };
  const rawName = (typeof reaction === 'string' ? reaction : (reaction.emoji?.name || reaction.name || '')).toLowerCase().trim();
  const rawId = reaction.emoji?.id || reaction.id || '';
  const colonName = `:${rawName}:`;

  for (const w of badWords) {
    const word = (typeof w === 'string' ? w : w.word || '').toLowerCase().trim();
    if (!word) continue;
    if (word === rawName || word === colonName || (rawId && word === rawId)) {
      return { matched: true, word: w };
    }
  }
  return { matched: false };
}

export function checkBadWords(items, badWords, matchMode = 'contains', regex = null) {
  if (!badWords || badWords.length === 0 || !items || items.length === 0) {
    return { matched: false };
  }

  const normalized = items.map(c =>
    typeof c === 'string' ? { text: c, reactions: [] } : c
  );

  if (matchMode === 'contains' && regex) {
    const matchedItem = normalized.find(c => regex.test(c.text));
    if (matchedItem) {
      const matchedWord = badWords.find(w => matchedItem.text.includes(w)) || matchedItem.text;
      return {
        matched: true,
        word: matchedWord,
        matchedIn: matchedItem.text,
        reactions: matchedItem.reactions
      };
    }
    return { matched: false };
  }

  for (const rawBadWord of badWords) {
    const badWord = (typeof rawBadWord === 'string' ? rawBadWord : rawBadWord.word || '')
      .trim()
      .toLowerCase();
    if (!badWord) continue;

    for (const item of normalized) {
      if (matchMode === 'exact') {
        if (item.text === badWord) {
          return {
            matched: true,
            word: badWord,
            matchedIn: item.text,
            reactions: item.reactions
          };
        }
      } else if (item.text.includes(badWord)) {
        return {
          matched: true,
          word: badWord,
          matchedIn: item.text,
          reactions: item.reactions
        };
      }
    }
  }

  return { matched: false };
}
