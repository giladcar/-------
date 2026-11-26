import { extractRecipeFromText } from './recipeEngine';

export interface SmartParsedRecipe {
  ingredients: string[];
  steps: string[];
  notes: string[];
}

const NOTE_START_PATTERNS: RegExp[] = [
  /^(?:הערה|הערות|טיפ|טיפים|שימו לב|שים לב|שדרוג|המלצה|המלצות|בונוס|סוד קטן|חשוב לדעת)\s*[:\-–]?/i,
  /^(?:אני\s+שמתי|שמתי\s+במקום|במקום\s+.+\s+(?:אפשר|ניתן|שמתי|השתמשתי)|אפשר\s+לעשות\s+את\s+זה)/i,
  /^(?:אפשר|ניתן)\s+(?:גם\s+)?(?:להוסיף|להחליף|לשים|להמיר|לוותר|להכין|להגיש|לשמור|להקפיא)/i,
  /^(?:לא\s+צריך|לא\s+צריכים|אין\s+צורך|לא\s+חובה)/i,
  /^(?:רק\s+לוודא|חשוב\s+לוודא|חשוב\s+מאוד|שימו\s+לב\s+ש|להיזהר\s+לא|מומלץ\s+(?:להגיש|לפזר|להוסיף|להשתמש))/i,
  /^(?:מי\s+שאוהב|מי\s+שלא\s+אוהב|לגרסה\s+(?:טבעונית|פרווה|ללא\s+גלוטן)|בגרסה\s+שלי)/i,
];

const NOTE_INLINE_PATTERNS: RegExp[] = [
  /אני\s+שמתי\s+במקום/i,
  /במקום\s+[^,.]+\s+(?:אפשר|ניתן)\s+(?:לשים|להשתמש|להחליף)/i,
  /אפשר\s+לעשות\s+את\s+זה\s+(?:גם\s+)?(?:עם|בלי|פרווה|טבעוני)/i,
  /לפי\s+הצורך\s*$/i,
  /רק\s+לוודא\s+ש/i,
  /לא\s+צריכים\s+להיות\s+בתבשיל/i,
];

const COOKING_VERBS_RE =
  /^(?:לטגן|מטגנים|להוסיף|מוסיפים|לערבב|מערבבים|לבשל|מבשלים|לאפות|אופים|לחמם|מחממים|לחתוך|חותכים|לקצוץ|קוצצים|לשפוך|שופכים|לצקת|יוצקים|לסדר|מסדרים|להניח|מניחים|לכסות|מכסים|להרתיח|מרתיחים|להנמיך|מנמיכים|לצנן|מצננים|להגיש|מגישים|ללוש|לשים|להקציף|מקציפים|לטרוף|טורפים|לקפל|מקפלים|לגרד|מגרדים|לשטוף|שוטפים|לסנן|מסננים|להשרות|משרים|לתבל|מתבלים|למרוח|מורחים|להכניס|מכניסים|להוציא|מוציאים)/;

const UNIT_WORDS =
  '(?:כוסות|כוס|כפות|כף|כפיות|כפית|גרם|ג׳|ג\'|קילו|ק"ג|קג|מ"ל|מל|ליטר|חבילות|חבילה|חב׳|שקיות|שקית|קופסאות|קופסת|קופסה|פחיות|פחית|יחידות|יחידה|יח׳|פרוסות|פרוסה|שיני|שיניים|שן|ענפי|ענף|צרור|קורט|חופן|גביעי|גביע|מיכל|מיכלי|קוביות|מקלות)';

const NUMBER_WORDS =
  '(?:\\d+(?:[.,/]\\d+)?|חצי|רבע|שליש|שני|שתי|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע|שבעה|שמונה|תשע|תשעה|עשר|עשרה|קילו)';

export function cleanOcrNoise(rawText: string): string {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        // הסרת סימני ממשק של צילומי מסך (שעה, אחוזי סוללה, אייקונים)
        .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
        .replace(/\b\d{1,3}%\b/g, ' ')
        .replace(/[|¦~_=^<>«»•●▪▫■□◆◇★☆♦♣♠♥❤🙈😍😋🤤👌👍🙏🔥✨]/g, ' ')
        // תיקון בלבולי ספרות בתוך מילים בעברית (למשל כפ1ת -> כפית, בצל1ם -> בצלים)
        .replace(/([א-ת])1([א-ת])/g, '$1י$2')
        .replace(/([א-ת])0([א-ת])/g, '$1ס$2')
        .replace(/\bתפוא\b/g, 'תפו"א')
        // ניקוי תווים בודדים באנגלית שנדחפו בטעות לתוך שורה בעברית
        .replace(/(?<=[א-ת]\s)[a-zA-Z](?=\s[א-ת])/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((line) => {
      if (!line) return false;
      // סינון שורות קצרצרות חסרות משמעות או כותרות אינסטגרם כלליות
      const hebrewLetters = (line.match(/[א-ת]/g) || []).length;
      const digits = (line.match(/\d/g) || []).length;
      if (hebrewLetters === 0 && digits === 0) return false;
      if (hebrewLetters < 2 && digits === 0) return false;
      if (/^מתכון\s+ל[א-ת\s"']{2,35}$/.test(line) && !/\d/.test(line)) return false;
      return true;
    });

  return lines.join('\n');
}

function isNoteSentence(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 6) return false;
  if (NOTE_START_PATTERNS.some((re) => re.test(t))) return true;
  if (NOTE_INLINE_PATTERNS.some((re) => re.test(t))) return true;
  return false;
}

function mergeBrokenStoryLines(lines: string[]): string[] {
  const merged: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (merged.length === 0) {
      merged.push(line);
      continue;
    }

    const prev = merged[merged.length - 1];
    const prevEndsSentence = /[.!?]$/.test(prev);
    const prevIsHeader = /:$/.test(prev) && prev.length <= 35;
    const currStartsBulletOrNum = /^(?:\d+[.)]|[-*•])\s*/.test(line);
    const currStartsNote = isNoteSentence(line);
    const prevIsNote = isNoteSentence(prev);
    const currStartsVerb = COOKING_VERBS_RE.test(line);

    // אם השורה הקודמת נקטעה באמצע משפט (כמו בסטורי צר), נחבר אותה לשורה הבאה
    if (
      !prevEndsSentence &&
      !prevIsHeader &&
      !currStartsBulletOrNum &&
      !currStartsNote &&
      !prevIsNote &&
      !currStartsVerb
    ) {
      merged[merged.length - 1] = prev + ' ' + line;
    } else {
      merged.push(line);
    }
  }
  return merged;
}

function extractInlineIngredientsFromSentences(sentences: string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const addUnique = (rawItem: string) => {
    let item = rawItem
      .replace(/^[•\-*▪▫,.;:]+\s*/, '')
      .replace(/[,.;:]+$/, '')
      .replace(/^(?:יש\s+)?(?:לטגן|להוסיף|לשים|לשפוך|לצקת|לסדר|להניח|לחתוך|לקצוץ|לגרד|לתבל\s+ב|ולבשל\s+עם|עם)\s+/i, '')
      .replace(/^ו(?=(?:כף|כפות|כפית|כפיות|כוס|כוסות|קילו|גרם|חבילת|חבילה|שקית|קופסת|קופסה|מלח|פלפל|\d))/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (/^קילו\s+/.test(item)) {
      item = '1 ' + item;
    } else if (/^(?:כף|כפית|כוס|חבילת|חבילה|שקית|קופסת|קופסה|קורט|צרור|גביע|מיכל|פחית)\s+/.test(item)) {
      item = '1 ' + item;
    }

    if (item.length < 3 || item.length > 75) return;
    if (/\b(?:דקות|דקה|שעה|שעות|מעלות|אש\s+נמוכה|אש\s+גבוהה|סיר|תבנית|מחבת|תנור)\b/.test(item)) return;

    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      found.push(item);
    }
  };

  const unitRegex = new RegExp(
    '(?:^|[\\s,;(])((?:' +
      NUMBER_WORDS +
      '\\s+)?' +
      UNIT_WORDS +
      '\\s+[א-ת0-9/"\'-]+(?:\\s+[א-ת0-9/"\'-]+){0,4})',
    'g'
  );

  const countNounRegex = new RegExp(
    '(?:^|[\\s,;(])(' +
      NUMBER_WORDS +
      '\\s+(?!דקות|דקה|שעות|שעה|שניות|שנייה|מעלות|פעמים|חלקים|שלבים)[א-ת"\']{2,}(?:\\s+[א-ת"\']{2,}){0,4})',
    'g'
  );

  for (const sentence of sentences) {
    // פיצול לפי פסיקים או פעלי בישול כדי לבודד כל רכיב
    const clauses = sentence
      .split(/,|\b(?:להוסיף|לטגן|לשים|לשפוך|לצקת|ולבשל|ולערבב|לערבב|לתבל\s+ב)\b/)
      .map((c) => c.trim())
      .filter(Boolean);

    for (const clause of clauses) {
      let matchedInClause = false;

      let m1: RegExpExecArray | null;
      unitRegex.lastIndex = 0;
      while ((m1 = unitRegex.exec(clause)) !== null) {
        addUnique(m1[1]);
        matchedInClause = true;
      }

      if (!matchedInClause) {
        let m2: RegExpExecArray | null;
        countNounRegex.lastIndex = 0;
        while ((m2 = countNounRegex.exec(clause)) !== null) {
          addUnique(m2[1]);
          matchedInClause = true;
        }
      }

      // תפיסת "וקילו פרגיות" או "מלח ופלפל"
      const kiloMatch = clause.match(/(?:^|\s)ו?(קילו\s+[א-ת"']+(?:\s+[א-ת"']+){0,2})/);
      if (kiloMatch) addUnique(kiloMatch[1]);

      if (/מלח\s+ופלפל/.test(clause)) {
        addUnique('מלח ופלפל');
      }
    }
  }

  return found;
}

export function parseRecipeAndNotes(rawInput: string): SmartParsedRecipe {
  const cleaned = cleanOcrNoise(rawInput);
  const rawLines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const mergedLines = mergeBrokenStoryLines(rawLines);

  // חילוץ הערות, טיפים והחלפות מכל השורות והמשפטים
  const notes: string[] = [];
  const remainingLines: string[] = [];

  for (const line of mergedLines) {
    // פיצול משפטים בתוך שורה אם יש נקודה באמצע
    const subSentences = line
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const keptSub: string[] = [];
    for (const sub of subSentences) {
      if (isNoteSentence(sub)) {
        const cleanNote = sub
          .replace(/^(?:הערה|הערות|טיפ|טיפים|שימו לב|שים לב|שדרוג|המלצה)\s*[:\-–]\s*/i, '')
          .trim();
        if (cleanNote && !notes.includes(cleanNote)) {
          notes.push(cleanNote);
        }
      } else {
        keptSub.push(sub);
      }
    }

    if (keptSub.length > 0) {
      remainingLines.push(keptSub.join(' '));
    }
  }

  const baseParsed = extractRecipeFromText(remainingLines.join('\n'));
  let ingredients = baseParsed.ingredients;
  let steps = baseParsed.steps;

  // אם המתכון כתוב בסגנון סטורי / פסקה רציפה ולא זוהתה רשימת מצרכים נפרדת:
  if (ingredients.length < 2) {
    const inlineIngredients = extractInlineIngredientsFromSentences(remainingLines);
    if (inlineIngredients.length >= 2) {
      ingredients = inlineIngredients;
    }
  }

  if (steps.length === 0 && remainingLines.length > 0) {
    steps = remainingLines
      .map((l) => l.replace(/^\d+[.)]\s*/, '').trim())
      .filter((l) => l.length >= 4);
  }

  return {
    ingredients,
    steps,
    notes,
  };
}
