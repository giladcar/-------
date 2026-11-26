import { extractRecipeFromText } from './recipeEngine';

export interface SmartParsedRecipe {
  ingredients: string[];
  steps: string[];
  notes: string[];
}

const NOTE_PATTERNS: RegExp[] = [
  /^(?:הערה|הערות|טיפ|טיפים|שימו לב|שים לב|שדרוג|המלצה|המלצות|בונוס|חשוב לדעת)\s*[:\-–]?/i,
  /(?:אני\s+שמתי|שמתי\s+במקום|השתמשתי\s+ב|אפשר\s+להחליף|ניתן\s+להחליף|במקום\s+[^,.]{2,25}\s+(?:אפשר|ניתן|שמתי))/i,
  /(?:אפשר\s+לעשות\s+את\s+זה|אפשר\s+להוסיף|ניתן\s+להוסיף|אפשר\s+גם|אפשר\s+בלי|אפשר\s+עם)/i,
  /(?:לפי\s+הצורך|לא\s+צריכים?\s+להיות|אין\s+צורך\s+ב|לא\s+חובה)/i,
  /(?:רק\s*לוודא|חשוב\s+לוודא|שימו\s+לב\s+ש|להיזהר\s+לא|שהוא\s+לא\s+מתייבש|שלא\s+יתייבש|שלא\s+יישרף)/i,
];

const STOP_CLAUSE_RE =
  /\s+(?:ולבשל|לבשל|ולערבב|לערבב|ולטגן|לטגן|ולאפות|לאפות|ולכסות|לכסות|ולהרתיח|להרתיח|ולצנן|לצנן|להגיש|מגישים|על\s+אש|למשך|עד\s+ש|כדי\s+ש|בתנור|בסיר|במחבת)\b.*$/i;

const UNIT_WORDS =
  '(?:כוסות|כוס|כפות|כף|כפיות|כפית|גרם|ג׳|ג\'|קילו|ק"ג|קג|מ"ל|מל|ליטר|חבילות|חבילה|חב׳|שקיות|שקית|קופסאות|קופסת|קופסה|פחיות|פחית|יחידות|יחידה|יח׳|פרוסות|פרוסה|שיני|שיניים|שן|ענפי|ענף|צרור|קורט|חופן|גביעי|גביע|מיכל|מיכלי|קוביות|מקלות)';

const NUMBER_WORDS =
  '(?:\\d+(?:[.,/]\\d+)?|חצי|רבע|שליש|שני|שתי|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע|שבעה|שמונה|תשע|תשעה|עשר|עשרה)';

export function cleanOcrNoise(rawText: string): string {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        // הסרת שעות, אחוזי סוללה וסימני ג'יבריש מ-OCR
        .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
        .replace(/\b\d{1,3}%\b/g, ' ')
        .replace(/[|¦~_=^<>«»•●▪▫■□◆◇★☆♦♣♠♥❤🙈😍😋🤤👌👍🙏🔥✨\\]/g, ' ')
        // תיקון ספרות שנדבקו לאותיות בעברית (אש7 -> אש, כפ1ת -> כפית, ל- -> ל)
        .replace(/([א-ת]{2,})7(?=\s|$|[.,])/g, '$1')
        .replace(/([א-ת])1([א-ת])/g, '$1י$2')
        .replace(/([א-ת])0([א-ת])/g, '$1ס$2')
        .replace(/\bרקלוודא\b/g, 'רק לוודא')
        .replace(/\bתפוא\b/g, 'תפו"א')
        // מחיקת רצפי אותיות לטיניות קצרים (ג'יבריש כמו Bn, AE, an) כשיש עברית בשורה
        .replace(/(?:^|\s)[a-zA-Z]{1,4}:?(?=\s|$)/g, ' ')
        // ניקוי נקודות ומקפים מיותרים בסוף מילה
        .replace(/([א-ת])\.([א-ת])/g, '$1 $2')
        .replace(/\s+[-–+]\s+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((line) => {
      if (!line) return false;
      const hebrewChars = (line.match(/[א-ת]/g) || []).length;
      const digits = (line.match(/\d/g) || []).length;
      if (hebrewChars < 2 && digits === 0) return false;
      // סינון כותרת כללית של סטורי ("מתכון לפרגיות תפוא משישי")
      if (/^מתכון\s+ל[א-ת\s"']{2,35}$/.test(line) && !/\d/.test(line)) return false;
      return true;
    });

  return lines.join('\n');
}

function isNoteText(text: string): boolean {
  const t = text.trim();
  if (t.length < 7) return false;
  return NOTE_PATTERNS.some((re) => re.test(t));
}

function mergeStoryLines(lines: string[]): string[] {
  const merged: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (merged.length === 0) {
      merged.push(line);
      continue;
    }

    const prev = merged[merged.length - 1];
    const prevEndsPunct = /[.!?]$/.test(prev);
    const prevIsHeader = /:$/.test(prev) && prev.length <= 35;
    const currStartsAction =
      /^(?:\d+[.)]|[-*•]|להוסיף|מוסיפים|לערבב|מערבבים|לטגן|מטגנים|לבשל|מבשלים|לאפות|אופים|אפשר|ניתן|רק\s+לוודא|לא\s+צריך|לא\s+צריכים|הערה|טיפ|אני\s+שמתי|במקום)\b/.test(
        line
      );

    if (!prevEndsPunct && !prevIsHeader && !currStartsAction && !isNoteText(prev)) {
      merged[merged.length - 1] = prev + ' ' + line;
    } else {
      merged.push(line);
    }
  }
  return merged;
}

function splitIntoSentences(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    // פיצול גם לפי נקודה וגם לפני ביטויי הערה שמתחילים באמצע משפט
    const parts = line
      .split(/(?<=[.!?])\s+|(?=\b(?:אפשר\s+להוסיף|אפשר\s+להחליף|אני\s+שמתי|במקום\s+[א-ת]+\s+אפשר|לא\s+צריכים?\s+להיות|רק\s+לוודא)\b)/)
      .map((s) => s.trim())
      .filter(Boolean);
    out.push(...parts);
  }
  return out;
}

function extractIngredientsFromProse(sentences: string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const addIngredient = (raw: string) => {
    let item = raw
      .replace(STOP_CLAUSE_RE, '')
      .replace(/^[•\-*▪▫,.;:]+\s*/, '')
      .replace(/[,.;:]+$/, '')
      .replace(/^(?:יש\s+)?(?:לטגן|להוסיף|לשים|לשפוך|לצקת|לסדר|להניח|לחתוך|לקצוץ|לגרד|לתבל\s+ב|עם)\s+/i, '')
      .replace(/^ו(?=(?:כף|כפות|כפית|כפיות|כוס|כוסות|קילו|גרם|חבילת|חבילה|שקית|קופסת|קופסה|מלח|פלפל|\d))/i, '')
      .replace(/\s+(?:חתוכים|חתוך|פרוסים|פרוס|קצוצים|קצוץ|מגורדים|מגורד|שטופים|שטוף|מקולפים|מקולף)\b.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (/^קילו\s+/.test(item)) {
      item = '1 ' + item;
    } else if (/^(?:כף|כפית|כוס|חבילת|חבילה|שקית|קופסת|קופסה|קורט|צרור|גביע|מיכל|פחית)\s+/.test(item)) {
      item = '1 ' + item;
    }

    if (item.length < 3 || item.length > 60) return;
    if (/\b(?:דקות|דקה|שעה|שעות|מעלות|אש|סיר|תבנית|מחבת|תנור|לפי\s+הצורך)\b/.test(item)) return;

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
      '\\s+[א-ת0-9/"\'-]+(?:\\s+[א-ת0-9/"\'-]+){0,3})',
    'g'
  );

  const countNounRegex = new RegExp(
    '(?:^|[\\s,;(])(' +
      NUMBER_WORDS +
      '\\s+(?!דקות|דקה|שעות|שעה|שניות|שנייה|מעלות|פעמים|חלקים|שלבים)[א-ת"\']{2,}(?:\\s+[א-ת"\']{2,}){0,2})',
    'g'
  );

  for (const sentence of sentences) {
    if (isNoteText(sentence)) continue;

    const clauses = sentence
      .split(/,|\b(?:להוסיף|לטגן|לשים|לשפוך|לצקת|לתבל\s+ב)\b/)
      .map((c) => c.trim())
      .filter(Boolean);

    for (const clause of clauses) {
      let matched = false;

      let m1: RegExpExecArray | null;
      unitRegex.lastIndex = 0;
      while ((m1 = unitRegex.exec(clause)) !== null) {
        addIngredient(m1[1]);
        matched = true;
      }

      if (!matched) {
        let m2: RegExpExecArray | null;
        countNounRegex.lastIndex = 0;
        while ((m2 = countNounRegex.exec(clause)) !== null) {
          addIngredient(m2[1]);
          matched = true;
        }
      }

      const kiloMatch = clause.match(/(?:^|\s)ו?(קילו\s+[א-ת"']+(?:\s+[א-ת"']+){0,2})/);
      if (kiloMatch) addIngredient(kiloMatch[1]);

      if (/מלח\s+ופלפל/.test(clause)) {
        addIngredient('מלח ופלפל');
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

  const mergedLines = mergeStoryLines(rawLines);
  const allSentences = splitIntoSentences(mergedLines);

  const notes: string[] = [];
  const recipeSentences: string[] = [];

  for (const sentence of allSentences) {
    if (isNoteText(sentence)) {
      const cleanNote = sentence
        .replace(/^(?:הערה|הערות|טיפ|טיפים|שימו לב|שים לב|שדרוג|המלצה)\s*[:\-–]\s*/i, '')
        .trim();
      if (cleanNote && !notes.includes(cleanNote)) {
        notes.push(cleanNote);
      }
    } else {
      recipeSentences.push(sentence);
    }
  }

  const baseParsed = extractRecipeFromText(recipeSentences.join('\n'));
  let ingredients = baseParsed.ingredients;
  let steps = baseParsed.steps;

  if (ingredients.length < 2) {
    const proseIngs = extractIngredientsFromProse(recipeSentences);
    if (proseIngs.length >= 2) {
      ingredients = proseIngs;
    }
  }

  if (steps.length === 0 && recipeSentences.length > 0) {
    steps = recipeSentences
      .map((s) => s.replace(/^\d+[.)]\s*/, '').trim())
      .filter((s) => s.length >= 4);
  }

  return {
    ingredients,
    steps,
    notes,
  };
}
