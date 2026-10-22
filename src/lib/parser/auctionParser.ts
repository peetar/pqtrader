import tradeableLookupData from '@/data/tradeable_lookup.json';
import { CurrencyType, ListingType } from '@/types/pqtrader';

export interface ParsedListingCandidate {
  listingType: ListingType;
  itemId: number;
  itemName: string;
  actorName: string;
  currencyType: CurrencyType;
  pricePp: number | null;
  priceQuantity: number;
  tradeMetadata: string | null;
  rawMessage: string;
  discordMessageId?: string | null;
}

export interface MaybeReviewCandidate {
  channelName: string;
  authorName: string;
  rawMessage: string;
  reason: string;
  candidateTokens: string[];
  discordMessageId?: string | null;
}

export interface ParseAuctionMessageResult {
  isTradeRelated: boolean;
  actorName: string;
  listings: ParsedListingCandidate[];
  maybeLog: MaybeReviewCandidate | null;
}

interface LookupEntry {
  id: number;
  name: string;
  isSpell: boolean;
}

const rawTradeableMap = (
  tradeableLookupData as {
    tradeableByNormName: Record<string, LookupEntry>;
  }
).tradeableByNormName;

/**
 * Curated Project Quarm / EverQuest Community Abbreviations -> Canonical Normalized Name
 */
export const ITEM_ALIASES: Record<string, string> = {
  cof: 'cloak of flames',
  fbss: 'flowing black silk sash',
  fungi: 'fungus covered scale tunic',
  'fungi tunic': 'fungus covered scale tunic',
  'fungi staff': 'fungus covered great staff',
  rbb: 'runed bolster belt',
  tstaff: 'tranquil staff',
  't-staff': 'tranquil staff',
  cos: 'circlet of shadow',
  jbb: 'jaundiced bone bracer',
  ebs: 'ebon mace',
  'manna robe': 'mana robe',
  'eth parch': 'ethereal parchment',
  'ethereal parch': 'ethereal parchment',
  'spec parch': 'spectral parchment',
  'specteral parchment': 'spectral parchment',
  'specteral parch': 'spectral parchment',
  'spectral parch': 'spectral parchment',
  'glyphed word': 'glyphed rune word',
  'glyphed rune': 'glyphed rune word',
  'white scale': 'white dragon scales',
  'water scale': 'water dragon scales',
  'green scale': 'emerald dragon scales',
  'red scale': 'red dragon scales',
  'hierophant cloak': "hierophant's cloak",
  'hiero cloak': "hierophant's cloak",
  bds: 'blackened dragonscale boots',
};

const PARCHMENT_ITEM_IDS = new Set([29111, 29112, 29131, 29132]);

// Build fast first-word indexed phrase matcher
const PHRASE_INDEX = new Map<string, { words: string[]; entry: LookupEntry }[]>();
const SPELL_BARE_INDEX = new Map<string, { words: string[]; entry: LookupEntry }[]>();

function tokenizeWords(text: string): { word: string; start: number; end: number }[] {
  const tokens: { word: string; start: number; end: number }[] = [];
  const regex = /[a-z0-9'`-]+/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const clean = match[0]
      .toLowerCase()
      .replace(/`/g, "'")
      .replace(/^['-]+|['-]+$/g, '');
    if (clean) {
      tokens.push({
        word: clean,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return tokens;
}

function canonicalBucketKey(word: string): string {
  const lower = word
    .toLowerCase()
    .replace(/`/g, "'")
    .replace(/'s$/i, '')
    .replace(/s'$/i, 's')
    .replace(/'/g, '');

  // Strip trailing plural 's' on words >= 4 chars (e.g. "words" -> "word", "scales" -> "scale")
  // while preserving words ending in ss, us, is, as, os (e.g. "darkness", "terris", "focus")
  if (lower.length >= 4 && lower.endsWith('s') && !/(?:ss|us|is|as|os|es)$/i.test(lower)) {
    return lower.slice(0, -1);
  }
  return lower;
}

/**
 * Replaces Markdown PQDI links like:
 *   "[Glyphed Rune Word](https://www.pqdi.cc/item/0029132)"
 * with just the clean item text ("Glyphed Rune Word") so the URL never pollutes metadata,
 * while also returning a map of link labels -> explicit itemId from the PQDI URL.
 */
export function cleanPqdiLinksFromText(text: string): {
  cleanedText: string;
  explicitIdsByNormLabel: Map<string, number>;
} {
  const explicitIdsByNormLabel = new Map<string, number>();

  // 1) Replace [Label](https://www.pqdi.cc/item/0029132) -> Label
  let cleanedText = text.replace(
    /\[([^\]]+)\]\(\s*https?:\/\/(?:www\.)?pqdi\.cc\/item\/0*(\d+)[^)]*\)/gi,
    (_full, label: string, idStr: string) => {
      const cleanLabel = label.trim();
      const itemId = parseInt(idStr, 10);
      if (cleanLabel && !Number.isNaN(itemId) && itemId > 0) {
        explicitIdsByNormLabel.set(cleanLabel.toLowerCase().replace(/`/g, "'"), itemId);
      }
      return cleanLabel;
    }
  );

  // 2) Also strip any bare https://www.pqdi.cc/item/... URLs
  cleanedText = cleanedText.replace(/https?:\/\/(?:www\.)?pqdi\.cc\/item\/\d+\S*/gi, '').trim();

  return { cleanedText, explicitIdsByNormLabel };
}

/**
 * Checks if two words match after stripping apostrophes/possessives ('s) and simple plural s
 */
function isExactOrPossessiveMatch(tokenWord: string, dictWord: string): boolean {
  if (tokenWord === dictWord) return true;
  if (canonicalBucketKey(tokenWord) === canonicalBucketKey(dictWord)) return true;
  if (tokenWord.replace(/'/g, '') === dictWord.replace(/'/g, '')) return true;
  return false;
}

/**
 * Checks if two words have Levenshtein edit distance <= 1 (used only on words >= 5 chars
 * inside multi-word item/spell phrases where all other words in the phrase match exactly).
 */
function isCloseWordMatch(tokenWord: string, dictWord: string): boolean {
  if (isExactOrPossessiveMatch(tokenWord, dictWord)) return true;

  const tNoApos = canonicalBucketKey(tokenWord);
  const dNoApos = canonicalBucketKey(dictWord);

  if (tNoApos.length < 5 || dNoApos.length < 5) return false;
  if (tNoApos[0] !== dNoApos[0]) return false;
  if (Math.abs(tNoApos.length - dNoApos.length) > 1) return false;

  // Bounded Levenshtein distance <= 1 check
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < tNoApos.length && j < dNoApos.length) {
    if (tNoApos[i] === dNoApos[j]) {
      i++;
      j++;
    } else {
      edits++;
      if (edits > 1) return false;
      if (tNoApos.length > dNoApos.length) i++;
      else if (dNoApos.length > tNoApos.length) j++;
      else {
        i++;
        j++;
      }
    }
  }
  if (i < tNoApos.length || j < dNoApos.length) edits++;
  return edits <= 1;
}

function initMatcherIndexes() {
  if (PHRASE_INDEX.size > 0) return;

  const STOP_SINGLE_WORD_ITEMS = new Set([
    'water',
    'bread',
    'meat',
    'ale',
    'wine',
    'milk',
    'note',
    'book',
    'letter',
    'key',
    'ring',
    'club',
    'staff',
    'dagger',
    'sword',
    'shield',
    'cape',
    'cloak',
    'boots',
    'gloves',
    'pants',
    'tunic',
    'helm',
    'mask',
    'cap',
    'belt',
    'collar',
    'rock',
    'stone',
    'bone',
    'skin',
    'scale',
    'scroll',
  ]);

  const addPhrase = (
    targetMap: Map<string, { words: string[]; entry: LookupEntry }[]>,
    phrase: string,
    entry: LookupEntry
  ) => {
    const words = tokenizeWords(phrase).map((t) => t.word);
    if (words.length === 0) return;
    if (words.length === 1 && STOP_SINGLE_WORD_ITEMS.has(words[0])) {
      return;
    }

    const registerWords = (wList: string[]) => {
      if (wList.length === 0) return;
      if (wList.length === 1 && STOP_SINGLE_WORD_ITEMS.has(wList[0])) {
        return;
      }
      const bucketKeys = new Set<string>([
        wList[0],
        canonicalBucketKey(wList[0]),
        wList[0].replace(/'/g, ''),
      ]);

      for (const key of bucketKeys) {
        if (!key) continue;
        let bucket = targetMap.get(key);
        if (!bucket) {
          bucket = [];
          targetMap.set(key, bucket);
        }
        bucket.push({ words: wList, entry });
      }
    };

    registerWords(words);

    // Also register variant with "the" omitted (e.g. "Shield of [the] Immaculate", "Earring of [the] Frozen Skull")
    if (words.length >= 3 && words.includes('the')) {
      const withoutThe = words.filter((w, idx) => !(w === 'the' && idx > 0));
      if (withoutThe.length >= 2 && withoutThe.length < words.length) {
        registerWords(withoutThe);
      }
    }
  };

  for (const [normName, entry] of Object.entries(rawTradeableMap)) {
    addPhrase(PHRASE_INDEX, normName, entry);

    if (normName.startsWith('spell: ')) {
      const bare = normName.slice('spell: '.length).trim();
      if (bare.length >= 4 && !rawTradeableMap[bare]) {
        addPhrase(SPELL_BARE_INDEX, bare, entry);
      }
    } else if (normName.startsWith('song: ')) {
      const bare = normName.slice('song: '.length).trim();
      if (bare.length >= 4 && !rawTradeableMap[bare]) {
        addPhrase(SPELL_BARE_INDEX, bare, entry);
      }
    }
  }

  for (const [alias, targetNorm] of Object.entries(ITEM_ALIASES)) {
    const targetEntry = rawTradeableMap[targetNorm];
    if (targetEntry) {
      addPhrase(PHRASE_INDEX, alias, targetEntry);
    }
  }

  for (const bucket of PHRASE_INDEX.values()) {
    bucket.sort((a, b) => b.words.length - a.words.length);
  }
  for (const bucket of SPELL_BARE_INDEX.values()) {
    bucket.sort((a, b) => b.words.length - a.words.length);
  }
}

export function cleanDiscordAuthorName(rawAuthor: string): string {
  // Take first character name before /, |, [, <, (, or comma
  const firstPart = rawAuthor
    .split(/[\/|\[\(<,]/)[0]
    .replace(/[^A-Za-z0-9_'-]/g, ' ')
    .trim()
    .split(/\s+/)[0];
  return firstPart || 'Unknown';
}

/**
 * Splits a multi-line Discord copy-paste into logical message blocks, merging Discord
 * author headers like:
 *   "Aurthur <Erud's Crossing Guard> — 5:56 PM\nWTT: Blood of Saryn..."
 *   "LegendSham / LegendStab / Beast [Zek],  — 12:33 PM\nWTB Amulet..."
 * into a single message attributed to the primary character name.
 */
export function splitDiscordPasteIntoMessages(
  rawPaste: string
): { content: string; author?: string }[] {
  const lines = rawPaste.split(/\r?\n/);
  const result: { content: string; author?: string }[] = [];
  let pendingAuthor: string | undefined;

  const discordHeaderRegex =
    /^([A-Za-z][^\r\n—]{0,65}?)\s*(?:—|--)\s*(?:Today at |Yesterday at |\d{1,2}\/\d{1,2}\/\d{2,4}\s*)?\d{1,2}:\d{2}\s*(?:AM|PM)?$/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const headerMatch = line.match(discordHeaderRegex);
    if (headerMatch && !/\b(WTS|WTB|WTT)\b/i.test(headerMatch[1])) {
      pendingAuthor = cleanDiscordAuthorName(headerMatch[1]);
      continue;
    }

    result.push({
      content: line,
      author: pendingAuthor,
    });
    pendingAuthor = undefined;
  }

  return result;
}

/**
 * Extracts actor (player) name and auction body from Project Quarm Discord / EQ log formats.
 */
export function extractPlayerAndBody(
  rawMessage: string,
  fallbackAuthor = 'Unknown'
): { actorName: string; body: string } {
  let text = rawMessage.trim();

  // Handle multi-line input where line 1 is a Discord copy-paste header:
  const multiLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (multiLines.length >= 2) {
    const headerMatch = multiLines[0].match(
      /^([A-Za-z][^\r\n—]{0,65}?)\s*(?:—|--)\s*(?:Today at |Yesterday at |\d{1,2}\/\d{1,2}\/\d{2,4}\s*)?\d{1,2}:\d{2}\s*(?:AM|PM)?$/i
    );
    if (headerMatch && !/\b(WTS|WTB|WTT)\b/i.test(headerMatch[1])) {
      return {
        actorName: cleanDiscordAuthorName(headerMatch[1]),
        body: multiLines.slice(1).join(' '),
      };
    }
  }

  // Strip optional EQ timestamp [Day Mon DD HH:MM:SS YYYY]
  text = text.replace(/^\[[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4}\]\s*/, '');

  // Pattern 0: Single-line Discord header prefix "Aurthur <Erud's Crossing Guard> — 5:56 PM WTT: ..."
  const inlineDiscordHeader = text.match(
    /^([A-Za-z][A-Za-z0-9_`'-]{1,23})(?:\s*<[^>]+>)?\s*(?:—|--)\s*(?:Today at |Yesterday at )?\d{1,2}:\d{2}\s*(?:AM|PM)?\s+([\s\S]+)$/i
  );
  if (inlineDiscordHeader) {
    return {
      actorName: inlineDiscordHeader[1].trim(),
      body: inlineDiscordHeader[2].trim(),
    };
  }

  // Pattern 1: "Beab [65 Wood Elf Druid] WTT ..." or "Beab <Guild> WTT ..."
  const pqBridgeMatch = text.match(
    /^([A-Za-z][A-Za-z`'-]{1,23})\s*(?:\[[^\]]{1,45}\]|<[^>]{1,45}>)\s*(?:auctions?,?\s*)?['"]?([\s\S]+?)['"]?$/i
  );
  if (pqBridgeMatch) {
    return {
      actorName: pqBridgeMatch[1].trim(),
      body: pqBridgeMatch[2].trim(),
    };
  }

  // Pattern 2: "Traderdude auctions, 'WTS ...'"
  const eqLogMatch = text.match(
    /^([A-Za-z][A-Za-z`'-]{1,23})\s+(?:auctions|says out of character|shouts|tells General:\d+),?\s*['"]([\s\S]+?)['"]$/i
  );
  if (eqLogMatch) {
    return {
      actorName: eqLogMatch[1].trim(),
      body: eqLogMatch[2].trim(),
    };
  }

  // Pattern 3: "**PlayerName**: WTS ..." or "<PlayerName> WTS ..."
  const discordPrefixMatch = text.match(
    /^(?:\*\*([A-Za-z][A-Za-z`'-]{1,23})\*\*|<([A-Za-z][A-Za-z`'-]{1,23})>)\s*:?\s*([\s\S]+)$/i
  );
  if (discordPrefixMatch) {
    return {
      actorName: (discordPrefixMatch[1] || discordPrefixMatch[2]).trim(),
      body: discordPrefixMatch[3].trim(),
    };
  }

  // Pattern 4: "PlayerName: WTS ..." at the very beginning
  const leadingPlayerIntentMatch = text.match(
    /^([A-Za-z][A-Za-z]{2,15})\s*[:-]?\s+((?:WTS|WTB|WTT)\b[\s\S]+)$/i
  );
  if (
    leadingPlayerIntentMatch &&
    !/^(wts|wtb|wtt|hey|all|still|also|and|pst|bump)$/i.test(leadingPlayerIntentMatch[1])
  ) {
    return {
      actorName: leadingPlayerIntentMatch[1].trim(),
      body: leadingPlayerIntentMatch[2].trim(),
    };
  }

  let actorName = cleanDiscordAuthorName(fallbackAuthor);
  const pstMatch = text.match(/\b(?:pst\s+to|tell|ign:?)\s+([A-Z][a-z]{2,15})\b/);
  if (pstMatch && (actorName === 'Unknown' || actorName.toLowerCase().includes('bot'))) {
    actorName = pstMatch[1];
  }

  return { actorName, body: text };
}

/**
 * Splits a message body into directional intent blocks (WTS, WTB, WTT).
 */
export function splitIntentBlocks(body: string): { listingType: ListingType; segmentText: string }[] {
  const intentRegex = /\b(WTS|WTB|WTT|Selling|Buying|Trading)\b/gi;
  const matches: { type: ListingType; index: number; matchLen: number }[] = [];

  let m: RegExpExecArray | null;
  while ((m = intentRegex.exec(body)) !== null) {
    const rawWord = m[1].toUpperCase();
    let type: ListingType = 'WTS';
    if (rawWord === 'WTB' || rawWord === 'BUYING') type = 'WTB';
    else if (rawWord === 'WTT' || rawWord === 'TRADING') type = 'WTT';
    else type = 'WTS';

    if (
      matches.length > 0 &&
      m.index - (matches[matches.length - 1].index + matches[matches.length - 1].matchLen) <= 3
    ) {
      continue;
    }

    matches.push({ type, index: m.index, matchLen: m[0].length });
  }

  if (matches.length === 0) {
    return [];
  }

  const blocks: { listingType: ListingType; segmentText: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i].matchLen;
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    const seg = body.slice(start, end).replace(/^[:\s/-]+/, '').trim();
    if (seg) {
      blocks.push({ listingType: matches[i].type, segmentText: seg });
    }
  }
  return blocks;
}

interface MatchedItemSpan {
  entry: LookupEntry;
  charStart: number;
  charEnd: number;
}

/**
 * Finds all longest-matching tradeable items in a text segment.
 * Supports exact matching plus 1-edit-distance typo tolerance on multi-word phrases
 * (e.g. "Blood of Saryn" -> "Spell: Blood of Saryrn" #26916).
 */
export function findTradeableItemsInSegment(
  segment: string,
  allowBareSpellNames = true
): MatchedItemSpan[] {
  initMatcherIndexes();
  const tokens = tokenizeWords(segment);
  const spans: MatchedItemSpan[] = [];

  let i = 0;
  while (i < tokens.length) {
    const firstWord = tokens[i].word;
    let bestMatch: { wordLen: number; entry: LookupEntry; fuzzyEdits: number } | null = null;

    const checkBucket = (bucket?: { words: string[]; entry: LookupEntry }[]) => {
      if (!bucket) return;
      for (const cand of bucket) {
        const len = cand.words.length;
        if (i + len > tokens.length) continue;
        if (bestMatch && len < bestMatch.wordLen) continue;

        let exactMatches = 0;
        let fuzzyMatches = 0;
        let failed = false;

        for (let k = 0; k < len; k++) {
          const tokW = tokens[i + k].word;
          const candW = cand.words[k];
          if (isExactOrPossessiveMatch(tokW, candW)) {
            exactMatches++;
          } else if (len >= 2 && fuzzyMatches === 0 && isCloseWordMatch(tokW, candW)) {
            // Allow at most ONE 1-char typo in a multi-word item/spell phrase
            // where all other words match 100% exactly
            fuzzyMatches++;
          } else {
            failed = true;
            break;
          }
        }

        if (!failed && (fuzzyMatches === 0 || exactMatches >= len - 1)) {
          if (
            !bestMatch ||
            len > bestMatch.wordLen ||
            (len === bestMatch.wordLen && fuzzyMatches < bestMatch.fuzzyEdits)
          ) {
            bestMatch = { wordLen: len, entry: cand.entry, fuzzyEdits: fuzzyMatches };
            if (fuzzyMatches === 0) break; // Exact longest match found
          }
        }
      }
    };

    const canonFirst = canonicalBucketKey(firstWord);
    checkBucket(PHRASE_INDEX.get(canonFirst));
    if (canonFirst !== firstWord) {
      checkBucket(PHRASE_INDEX.get(firstWord));
    }
    if (allowBareSpellNames) {
      checkBucket(SPELL_BARE_INDEX.get(canonFirst));
      if (canonFirst !== firstWord) {
        checkBucket(SPELL_BARE_INDEX.get(firstWord));
      }
    }

    if (bestMatch) {
      const bm = bestMatch as { wordLen: number; entry: LookupEntry };
      const startToken = tokens[i];
      const endToken = tokens[i + bm.wordLen - 1];
      spans.push({
        entry: bm.entry,
        charStart: startToken.start,
        charEnd: endToken.end,
      });
      i += bm.wordLen;
    } else {
      i += 1;
    }
  }

  return spans;
}

/**
 * Extracts a Platinum (PP) price from a trailing text snippet after an item name.
 */
export function extractPpPriceFromTail(tailText: string): number | null {
  const cleaned = tailText.replace(/^\s*(?:x\d+|\(\s*x?\d+\s*\))\b/i, '').trim();

  // 1) Number with 'k' suffix (e.g., 7.5k, 12kpp, 1.25k p)
  const kMatch = cleaned.match(/(?:^|[\s:=-])(\d+(?:\.\d+)?)\s*k\s*(?:pp|p)?\b/i);
  if (kMatch) {
    const val = parseFloat(kMatch[1]);
    if (!Number.isNaN(val) && val > 0 && val <= 2000) {
      return Math.round(val * 1000);
    }
  }

  // 2) Number with explicit 'p' or 'pp' or 'plat' suffix (e.g., 500p, 2,500pp)
  const ppMatch = cleaned.match(/(?:^|[\s:=-])(\d{1,3}(?:,\d{3})+|\d+)\s*(?:pp|plat|p)\b/i);
  if (ppMatch) {
    const val = parseInt(ppMatch[1].replace(/,/g, ''), 10);
    if (!Number.isNaN(val) && val > 0 && val <= 2000000) {
      return val;
    }
  }

  // 3) Bare number >= 100 immediately following item (avoiding level numbers like 61..65!)
  const bareMatch = cleaned.match(/^\s*[:=-]?\s*(\d{1,3}(?:,\d{3})+|\d{3,6})\b/);
  if (bareMatch) {
    const val = parseInt(bareMatch[1].replace(/,/g, ''), 10);
    if (!Number.isNaN(val) && val >= 100 && val <= 1000000) {
      return val;
    }
  }

  return null;
}

/**
 * Splits a WTT (or trade) segment into:
 *  - offeredRegion: what the player HAS (before "for", "looking for", "will accept", "will take", "want", "need", "lf")
 *  - wantedRegion: what the player WANTS in return (after the pivot)
 */
export function splitWttOfferedAndWanted(segmentText: string): {
  offeredRegion: string;
  pivotPhrase: string | null;
  wantedRegion: string | null;
} {
  const pivotRegex =
    /(?:[,;/-]|\s)+(looking\s+for|will\s+accept|will\s+take|wanting|wants|want|seeking|needs|need|lf|for)\b\s*[:-]?/i;
  const match = pivotRegex.exec(segmentText);
  if (!match || match.index <= 0) {
    return {
      offeredRegion: segmentText,
      pivotPhrase: null,
      wantedRegion: null,
    };
  }

  const offeredRegion = segmentText.slice(0, match.index).trim();
  const pivotPhrase = match[1].trim();
  const wantedRegion = segmentText.slice(match.index + match[0].length).trim();

  return {
    offeredRegion,
    pivotPhrase,
    wantedRegion: wantedRegion || null,
  };
}

/**
 * Extracts non-PP currency & trade metadata (especially for PoP Spells & Parchments).
 */
export function extractTradeCurrencyAndMetadata(
  item: LookupEntry,
  listingType: ListingType,
  tailText: string,
  fullSegmentText: string
): {
  currencyType: CurrencyType;
  pricePp: number | null;
  priceQuantity: number;
  tradeMetadata: string | null;
} {
  const ppPrice = extractPpPriceFromTail(tailText);

  const inspectText = (tailText || fullSegmentText || '').toLowerCase();
  const qtyMatch = inspectText.match(/\b(\d+)\s*x?\s*(?:eth|spec|glyph|similar|other)/i);
  const qty = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1;

  if (/\b(?:ethereal\s+parch\w*|eth\s+parch\w*)\b/i.test(inspectText)) {
    return {
      currencyType: 'ETHEREAL_PARCHMENT',
      pricePp: null,
      priceQuantity: qty,
      tradeMetadata: tailText.trim() || 'for Ethereal Parchment',
    };
  }

  if (/\b(?:spectral\s+parch\w*|specteral\s+parch\w*|spec\s+parch\w*)\b/i.test(inspectText)) {
    return {
      currencyType: 'SPECTRAL_PARCHMENT',
      pricePp: null,
      priceQuantity: qty,
      tradeMetadata: tailText.trim() || 'for Spectral Parchment',
    };
  }

  if (/\b(?:glyphed\s+rune\s*word\w*|glyphed\s+word\w*)\b/i.test(inspectText)) {
    return {
      currencyType: 'GLYPHED_RUNE_WORD',
      pricePp: null,
      priceQuantity: qty,
      tradeMetadata: tailText.trim() || 'for Glyphed Rune Word',
    };
  }

  // Only classify as SIMILAR_SPELL / OTHER_TRADE when it is a WTT listing,
  // OR when a WTS/WTB listing explicitly asks "for <... spell>"
  const hasExplicitSpellTradeClause = /\bfor\s+[^,;|-]*\bspell\b/i.test(inspectText);
  if (listingType === 'WTT' || (item.isSpell && ppPrice === null && hasExplicitSpellTradeClause)) {
    const metadataClean = tailText.replace(/^[,;:\s-]+/, '').trim();
    if (item.isSpell || /\bspell\b/i.test(inspectText)) {
      return {
        currencyType: 'SIMILAR_SPELL',
        pricePp: null,
        priceQuantity: qty,
        tradeMetadata: metadataClean || '1-for-1 similar tier spell trade',
      };
    }
    return {
      currencyType: 'OTHER_TRADE',
      pricePp: null,
      priceQuantity: 1,
      tradeMetadata: metadataClean || 'WTT offer',
    };
  }

  const cleanNote = tailText
    .replace(/^[,;\s:=-]*(\d+(?:\.\d+)?\s*k\s*(?:pp|p)?|\d[\d,]*\s*(?:pp|plat|p)?)/i, '')
    .split(/\s+-\s+|\s*\|\s*|\s+\/\s+|;/)[0]
    .replace(/^[,;|/\s-]+|[,;|/\s-]+$/g, '')
    .trim();

  return {
    currencyType: 'PP',
    pricePp: ppPrice,
    priceQuantity: 1,
    tradeMetadata: cleanNote.length > 0 && cleanNote.length <= 80 ? cleanNote : null,
  };
}

/**
 * Main entry point: parses a raw Discord / EQ auction message into structured listings
 * and/or a "Maybe" review log entry.
 */
export function parseAuctionMessage(
  rawMessage: string,
  channelName = 'ingame-auctions',
  fallbackAuthor = 'Unknown',
  discordMessageId?: string | null
): ParseAuctionMessageResult {
  const { actorName, body: rawBody } = extractPlayerAndBody(rawMessage, fallbackAuthor);
  const { cleanedText: body, explicitIdsByNormLabel } = cleanPqdiLinksFromText(rawBody);
  const blocks = splitIntentBlocks(body);

  if (blocks.length === 0) {
    return {
      isTradeRelated: false,
      actorName,
      listings: [],
      maybeLog: null,
    };
  }

  const listings: ParsedListingCandidate[] = [];
  const unmatchedSegments: string[] = [];

  for (const block of blocks) {
    const { listingType, segmentText } = block;

    if (listingType === 'WTT') {
      // Split WTT on trade pivots ("for", "looking for", "will accept", "will take", "want", "need", "lf")
      const { offeredRegion, pivotPhrase, wantedRegion } = splitWttOfferedAndWanted(segmentText);
      const offeredSpans = findTradeableItemsInSegment(offeredRegion, true);

      if (offeredSpans.length === 0) {
        unmatchedSegments.push(`WTT ${segmentText}`);
        continue;
      }

      const fullWantedTail =
        pivotPhrase && wantedRegion ? `${pivotPhrase} ${wantedRegion}` : wantedRegion || '';

      // 1) Log every item the player HAS on the left side as WTT
      for (let idx = 0; idx < offeredSpans.length; idx++) {
        const current = offeredSpans[idx];
        const nextStart =
          idx + 1 < offeredSpans.length ? offeredSpans[idx + 1].charStart : offeredRegion.length;
        const betweenText = offeredRegion.slice(current.charEnd, nextStart).trim();
        const effectiveTail = fullWantedTail
          ? `${betweenText} ${fullWantedTail}`.trim()
          : betweenText;

        const { currencyType, pricePp, priceQuantity, tradeMetadata } =
          extractTradeCurrencyAndMetadata(current.entry, 'WTT', effectiveTail, segmentText);

        const normKey = current.entry.name.toLowerCase().replace(/`/g, "'");
        const resolvedId = explicitIdsByNormLabel.get(normKey) || current.entry.id;

        listings.push({
          listingType: 'WTT',
          itemId: resolvedId,
          itemName: current.entry.name,
          actorName,
          currencyType,
          pricePp,
          priceQuantity,
          tradeMetadata,
          rawMessage: rawMessage.trim(),
          discordMessageId: discordMessageId || null,
        });
      }

      // 2) Also scan the right side (wantedRegion) for specific wanted items and log them as WTB (no price offered)!
      if (wantedRegion) {
        const wantedSpans = findTradeableItemsInSegment(wantedRegion, true);
        const offeredNames = offeredSpans.map((s) => s.entry.name).join(', ');
        const offeredIds = new Set(offeredSpans.map((s) => s.entry.id));

        for (const wSpan of wantedSpans) {
          // Skip if it's the exact same item or a generic raw parchment currency already captured on the WTT listing
          if (offeredIds.has(wSpan.entry.id) || PARCHMENT_ITEM_IDS.has(wSpan.entry.id)) {
            continue;
          }
          const wNormKey = wSpan.entry.name.toLowerCase().replace(/`/g, "'");
          const wResolvedId = explicitIdsByNormLabel.get(wNormKey) || wSpan.entry.id;
          listings.push({
            listingType: 'WTB',
            itemId: wResolvedId,
            itemName: wSpan.entry.name,
            actorName,
            currencyType: 'PP',
            pricePp: null,
            priceQuantity: 1,
            tradeMetadata: `WTT offering ${offeredNames}`,
            rawMessage: rawMessage.trim(),
            discordMessageId: discordMessageId || null,
          });
        }
      }
      continue;
    }

    // Standard WTS or WTB block
    const rawSpans = findTradeableItemsInSegment(segmentText, true);
    // If a parchment item (Ethereal/Spectral/Glyphed) is preceded by "for [1x]" after another item,
    // it is the requested payment currency, not a separate item being sold/bought!
    const matchedSpans = rawSpans.filter((span, idx) => {
      if (idx > 0 && PARCHMENT_ITEM_IDS.has(span.entry.id)) {
        const prefixSlice = segmentText.slice(rawSpans[idx - 1].charEnd, span.charStart);
        if (/\b(?:for|or)\b/i.test(prefixSlice)) {
          return false;
        }
      }
      return true;
    });

    if (matchedSpans.length === 0) {
      unmatchedSegments.push(`${listingType} ${segmentText}`);
      continue;
    }

    for (let idx = 0; idx < matchedSpans.length; idx++) {
      const current = matchedSpans[idx];
      const nextStart =
        idx + 1 < matchedSpans.length ? matchedSpans[idx + 1].charStart : segmentText.length;
      const betweenText = segmentText.slice(current.charEnd, nextStart).trim();

      const { currencyType, pricePp, priceQuantity, tradeMetadata } =
        extractTradeCurrencyAndMetadata(current.entry, listingType, betweenText, segmentText);

      const normKey = current.entry.name.toLowerCase().replace(/`/g, "'");
      const resolvedId = explicitIdsByNormLabel.get(normKey) || current.entry.id;

      listings.push({
        listingType,
        itemId: resolvedId,
        itemName: current.entry.name,
        actorName,
        currencyType,
        pricePp,
        priceQuantity,
        tradeMetadata,
        rawMessage: rawMessage.trim(),
        discordMessageId: discordMessageId || null,
      });
    }
  }

  let maybeLog: MaybeReviewCandidate | null = null;
  if (unmatchedSegments.length > 0) {
    maybeLog = {
      channelName,
      authorName: actorName,
      rawMessage: rawMessage.trim(),
      reason:
        listings.length === 0
          ? 'UNMATCHED_ITEM_WITH_TRADE_INTENT'
          : 'PARTIAL_SEGMENT_UNMATCHED',
      candidateTokens: unmatchedSegments,
      discordMessageId: discordMessageId || null,
    };
  }

  return {
    isTradeRelated: true,
    actorName,
    listings,
    maybeLog,
  };
}
