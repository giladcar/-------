export type ConversionUnit =
  | 'original'
  | 'cup'
  | 'tbsp'
  | 'tsp'
  | 'pinch'
  | 'liter'
  | 'ml'
  | 'kg'
  | 'gram'
  | 'oz';

export interface UnitOption {
  id: ConversionUnit;
  label: string;
  shortLabel: string;
  category: 'reset' | 'volume' | 'weight';
}

export const CONVERSION_UNITS: UnitOption[] = [
  { id: 'original', label: 'מקורי', shortLabel: 'מקורי', category: 'reset' },
  { id: 'cup', label: 'כוסות', shortLabel: 'כוסות', category: 'volume' },
  { id: 'tbsp', label: 'כפות', shortLabel: 'כפות', category: 'volume' },
  { id: 'tsp', label: 'כפיות', shortLabel: 'כפיות', category: 'volume' },
  { id: 'pinch', label: 'קמצוץ', shortLabel: 'קמצוץ', category: 'volume' },
  { id: 'liter', label: 'ליטר', shortLabel: 'ליטר', category: 'volume' },
  { id: 'ml', label: 'מ"ל', shortLabel: 'מ"ל', category: 'volume' },
  { id: 'kg', label: 'קילו', shortLabel: 'קילו', category: 'weight' },
  { id: 'gram', label: 'גרם', shortLabel: 'גרם', category: 'weight' },
  { id: 'oz', label: 'אונקיות', shortLabel: 'oz', category: 'weight' },
];

// נפח במיליליטרים לכל יחידת נפח תקנית (כוס ישראלית/מטרית = 240 מ"ל)
const UNIT_TO_ML: Partial<Record<ConversionUnit, number>> = {
  cup: 240,
  tbsp: 15,
  tsp: 5,
  pinch: 0.3125, // 1/16 כפית
  liter: 1000,
  ml: 1,
};

// משקל בגרמים לכל יחידת משקל
const UNIT_TO_GRAMS: Partial<Record<ConversionUnit, number>> = {
  kg: 1000,
  gram: 1,
  oz: 28.3495,
};

// צפיפות ממוצעת בגרמים לכוס (240 מ"ל)
const DENSITY_GRAMS_PER_CUP: Array<{ keywords: string[]; gramsPerCup: number }> = [
  { keywords: ['קמח מלא'], gramsPerCup: 125 },
  { keywords: ['קמח', 'קורנפלור', 'עמילן'], gramsPerCup: 140 },
  { keywords: ['אבקת סוכר'], gramsPerCup: 120 },
  { keywords: ['סוכר חום'], gramsPerCup: 220 },
  { keywords: ['סוכר'], gramsPerCup: 200 },
  { keywords: ['חמאה', 'מרגרינה', 'מחמאה'], gramsPerCup: 227 },
  { keywords: ['שמן'], gramsPerCup: 220 },
  { keywords: ['דבש', 'סילאן', 'מייפל', 'ריבה'], gramsPerCup: 330 },
  { keywords: ['טחינה', 'חמאת בוטנים'], gramsPerCup: 250 },
  { keywords: ['קקאו'], gramsPerCup: 110 },
  { keywords: ['אבקת אפייה', 'אבקת אפיה', 'סודה לשתייה', 'סודה לשתיה'], gramsPerCup: 220 },
  { keywords: ['מלח'], gramsPerCup: 290 },
  { keywords: ['שיבולת שועל', 'קוואקר'], gramsPerCup: 90 },
  { keywords: ['אורז'], gramsPerCup: 185 },
  { keywords: ['שקדים', 'אגוזים', 'פירורי לחם'], gramsPerCup: 140 },
  { keywords: ['שוקולד'], gramsPerCup: 170 },
  { keywords: ['גבינה', 'יוגורט', 'שמנת', 'חלב', 'מים', 'מיץ', 'רוטב', 'חומץ', 'יין'], gramsPerCup: 240 },
];

function getDensityGramsPerCup(ingredientName: string): number {
  const lower = ingredientName.toLowerCase();
  for (const entry of DENSITY_GRAMS_PER_CUP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.gramsPerCup;
    }
  }
  return 240;
}

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

function parseAmountToken(raw: string): number | null {
  let s = raw.trim().replace(/^כ-/, '').trim();
  if (!s) return null;

  // טיפול בטווחים כמו 1-2 -> ממוצע 1.5
  const rangeMatch = s.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    return (parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2;
  }

  // מספר שלם + שבר Unicode (למשל "1 ½" או "½ 1" ב-RTL)
  const mixedUni1 = s.match(/^(\d+)\s*([½⅓⅔¼¾⅛⅜⅝⅞])$/);
  if (mixedUni1) {
    return parseInt(mixedUni1[1], 10) + (UNICODE_FRACTIONS[mixedUni1[2]] || 0);
  }
  const mixedUni2 = s.match(/^([½⅓⅔¼¾⅛⅜⅝⅞])\s*(\d+)$/);
  if (mixedUni2) {
    return parseInt(mixedUni2[2], 10) + (UNICODE_FRACTIONS[mixedUni2[1]] || 0);
  }

  // שבר Unicode בודד
  if (UNICODE_FRACTIONS[s] !== undefined) {
    return UNICODE_FRACTIONS[s];
  }

  // מספר מעורב עם לוכסן (למשל "1 1/2")
  const mixedSlash = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedSlash && Number(mixedSlash[3]) !== 0) {
    return parseInt(mixedSlash[1], 10) + parseInt(mixedSlash[2], 10) / parseInt(mixedSlash[3], 10);
  }

  // שבר פשוט עם לוכסן (למשל "3/4")
  const simpleSlash = s.match(/^(\d+)\/(\d+)$/);
  if (simpleSlash && Number(simpleSlash[2]) !== 0) {
    return parseInt(simpleSlash[1], 10) / parseInt(simpleSlash[2], 10);
  }

  // מספר רגיל או עשרוני
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    return parseFloat(s);
  }

  return null;
}

const UNIT_ALIASES: Array<{ unit: Exclude<ConversionUnit, 'original'>; patterns: string[] }> = [
  { unit: 'cup', patterns: ['כוסות', 'כוס', 'cups', 'cup'] },
  { unit: 'tbsp', patterns: ['כפות', 'כף', 'tbsp', 'tablespoons', 'tablespoon'] },
  { unit: 'tsp', patterns: ['כפיות', 'כפית', 'tsp', 'teaspoons', 'teaspoon'] },
  { unit: 'pinch', patterns: ['קמצוצים', 'קמצוץ', 'קורט', 'pinches', 'pinch'] },
  { unit: 'liter', patterns: ['ליטרים', 'ליטר', 'ל׳', 'liters', 'liter', 'l'] },
  { unit: 'ml', patterns: ['מיליליטרים', 'מיליליטר', 'מ"ל', 'מל', 'ml'] },
  { unit: 'kg', patterns: ['קילוגרמים', 'קילוגרם', 'ק"ג', 'קילו', 'kg'] },
  { unit: 'gram', patterns: ['גרמים', 'גרם', 'ג׳', 'grams', 'gram', 'g'] },
  { unit: 'oz', patterns: ['אונקיות', 'אונקיה', 'oz'] },
];

function matchUnitWord(word: string): Exclude<ConversionUnit, 'original'> | null {
  const clean = word.replace(/^[.,;:()]+|[.,;:()]+$/g, '').toLowerCase();
  for (const entry of UNIT_ALIASES) {
    if (entry.patterns.includes(clean)) {
      return entry.unit;
    }
  }
  return null;
}

function formatSmartNumber(n: number): string {
  if (n >= 100) return String(Math.round(n));
  if (n >= 10) return String(Math.round(n * 10) / 10).replace(/\.0$/, '');
  return String(Math.round(n * 100) / 100).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

// עיצוב כמות + יחידת מידה בעברית טבעית (כולל חצי כוס, רבע ליטר, קמצוץ וכו')
export function formatHebrewAmountWithUnit(
  amount: number,
  unit: Exclude<ConversionUnit, 'original'>
): string {
  if (unit === 'gram') {
    const rounded = amount >= 10 ? Math.round(amount) : Math.round(amount * 10) / 10;
    return rounded + ' גרם';
  }
  if (unit === 'ml') {
    const rounded = amount >= 10 ? Math.round(amount) : Math.round(amount * 10) / 10;
    return rounded + ' מ"ל';
  }
  if (unit === 'oz') {
    const val = formatSmartNumber(amount);
    return amount === 1 ? '1 אונקיה' : val + ' אונקיות';
  }

  if (unit === 'pinch') {
    if (amount <= 0.65) return 'חצי קמצוץ';
    const whole = Math.floor(amount);
    const rem = amount - whole;
    if (whole === 0 && rem > 0.65) return 'קמצוץ';
    if (whole === 1 && rem < 0.25) return 'קמצוץ';
    if (whole === 1 && rem >= 0.25 && rem <= 0.75) return 'קמצוץ וחצי';
    const rounded = Math.max(1, Math.round(amount));
    return rounded === 1 ? 'קמצוץ' : rounded + ' קמצוצים';
  }

  if ((unit === 'cup' || unit === 'tsp') && amount > 0 && amount < 0.14) {
    return 'קמצוץ';
  }

  const whole = Math.floor(amount + 1e-6);
  const frac = amount - whole;

  type FracLabel = 'quarter' | 'third' | 'half' | 'twoThirds' | 'threeQuarters' | null;
  let matchedFrac: FracLabel = null;
  let adjustedWhole = whole;

  if (frac >= 0.97) {
    adjustedWhole = whole + 1;
    matchedFrac = null;
  } else if (Math.abs(frac - 0.25) <= 0.03) {
    matchedFrac = 'quarter';
  } else if (Math.abs(frac - 1 / 3) <= 0.03) {
    matchedFrac = 'third';
  } else if (Math.abs(frac - 0.5) <= 0.03) {
    matchedFrac = 'half';
  } else if (Math.abs(frac - 2 / 3) <= 0.03) {
    matchedFrac = 'twoThirds';
  } else if (Math.abs(frac - 0.75) <= 0.03) {
    matchedFrac = 'threeQuarters';
  } else if (frac > 0.03) {
    const cleanVal = formatSmartNumber(amount);
    const pluralMap: Record<string, string> = {
      cup: 'כוסות',
      tbsp: 'כפות',
      tsp: 'כפיות',
      liter: 'ליטר',
      kg: 'קילו',
    };
    return cleanVal + ' ' + pluralMap[unit];
  }

  const singular: Record<string, string> = {
    cup: 'כוס',
    tbsp: 'כף',
    tsp: 'כפית',
    liter: 'ליטר',
    kg: 'קילו',
  };
  const plural: Record<string, string> = {
    cup: 'כוסות',
    tbsp: 'כפות',
    tsp: 'כפיות',
    liter: 'ליטר',
    kg: 'קילו',
  };
  const oneUnitPhrase: Record<string, string> = {
    cup: 'כוס אחת',
    tbsp: 'כף אחת',
    tsp: 'כפית אחת',
    liter: 'ליטר',
    kg: 'קילו',
  };

  if (adjustedWhole === 0 && matchedFrac) {
    const prefixMap: Record<Exclude<FracLabel, null>, string> = {
      quarter: 'רבע',
      third: 'שליש',
      half: 'חצי',
      twoThirds: 'שני שליש',
      threeQuarters: 'שלושת רבעי',
    };
    return prefixMap[matchedFrac] + ' ' + singular[unit];
  }

  if (adjustedWhole === 1 && !matchedFrac) {
    return oneUnitPhrase[unit];
  }

  if (adjustedWhole === 1 && matchedFrac) {
    const suffixMap: Record<Exclude<FracLabel, null>, string> = {
      quarter: 'ורבע',
      third: 'ושליש',
      half: 'וחצי',
      twoThirds: 'ושני שליש',
      threeQuarters: 'ושלושת רבעי',
    };
    return singular[unit] + ' ' + suffixMap[matchedFrac];
  }

  if (adjustedWhole >= 2 && matchedFrac) {
    const midMap: Record<Exclude<FracLabel, null>, string> = {
      quarter: 'ורבע',
      third: 'ושליש',
      half: 'וחצי',
      twoThirds: 'ושני שליש',
      threeQuarters: 'ושלושת רבעי',
    };
    return adjustedWhole + ' ' + midMap[matchedFrac] + ' ' + plural[unit];
  }

  return adjustedWhole + ' ' + plural[unit];
}

export interface ConvertedLineResult {
  convertedText: string;
  isConverted: boolean;
  note?: string;
}

export function convertIngredientLine(
  displayLine: string,
  targetUnit: ConversionUnit
): ConvertedLineResult {
  if (targetUnit === 'original') {
    return { convertedText: displayLine, isConverted: false };
  }

  // חילוץ והסרת הערת גרמים בסוגריים כמו (~420 גרם) כדי למנוע כפילות
  let extractedGramsHint: number | null = null;
  const parenGramMatch = displayLine.match(/\(\s*~?\s*(\d+(?:\.\d+)?)\s*גרם\s*\)/);
  if (parenGramMatch) {
    extractedGramsHint = parseFloat(parenGramMatch[1]);
  }

  const cleanedLine = displayLine
    .replace(/^[•\-*]\s*/, '')
    .replace(/\(\s*~?\s*\d+(?:\.\d+)?\s*גרם\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const tokens = cleanedLine.split(/\s+/);
  if (tokens.length < 2) {
    return { convertedText: displayLine, isConverted: false };
  }

  let amount: number | null = null;
  let unitTokenIndex = -1;

  // בדיקת צירוף של 2 מילים לכמות (כגון "1 ½" או "½ 1" או "1 1/2")
  if (tokens.length >= 3) {
    const twoTokenAmount = parseAmountToken(tokens[0] + ' ' + tokens[1]);
    const unitAt2 = matchUnitWord(tokens[2]);
    if (twoTokenAmount !== null && unitAt2 !== null) {
      amount = twoTokenAmount;
      unitTokenIndex = 2;
    }
  }

  // בדיקת מילה אחת לכמות
  if (amount === null) {
    const oneTokenAmount = parseAmountToken(tokens[0]);
    const unitAt1 = matchUnitWord(tokens[1]);
    if (oneTokenAmount !== null && unitAt1 !== null) {
      amount = oneTokenAmount;
      unitTokenIndex = 1;
    }
  }

  // תמיכה בביטויים ללא מספר מפורש בתחילה ("חצי כוס סוכר", "קמצוץ מלח")
  if (amount === null) {
    const wordQualifiers: Record<string, number> = {
      'חצי': 0.5,
      'רבע': 0.25,
      'שליש': 1 / 3,
    };
    if (wordQualifiers[tokens[0]] !== undefined) {
      const unitAt1 = matchUnitWord(tokens[1]);
      if (unitAt1 !== null) {
        amount = wordQualifiers[tokens[0]];
        unitTokenIndex = 1;
      }
    } else if (matchUnitWord(tokens[0]) === 'pinch') {
      amount = 1;
      unitTokenIndex = 0;
    }
  }

  if (amount === null || unitTokenIndex === -1) {
    return { convertedText: displayLine, isConverted: false };
  }

  const sourceUnit = matchUnitWord(tokens[unitTokenIndex]);
  if (!sourceUnit) {
    return { convertedText: displayLine, isConverted: false };
  }

  const ingredientName = tokens.slice(unitTokenIndex + 1).join(' ').trim();
  const gramsPerCup = getDensityGramsPerCup(ingredientName);

  // שלב א: המרה למיליליטרים
  let totalMl: number;
  if (UNIT_TO_ML[sourceUnit] !== undefined) {
    totalMl = amount * (UNIT_TO_ML[sourceUnit] as number);
  } else {
    const grams = amount * (UNIT_TO_GRAMS[sourceUnit] as number);
    totalMl = (grams / gramsPerCup) * 240;
  }

  // שלב ב: המרה ליחידת היעד
  let targetAmount: number;
  if (UNIT_TO_ML[targetUnit] !== undefined) {
    targetAmount = totalMl / (UNIT_TO_ML[targetUnit] as number);
  } else {
    const totalGrams =
      UNIT_TO_GRAMS[sourceUnit] !== undefined
        ? amount * (UNIT_TO_GRAMS[sourceUnit] as number)
        : extractedGramsHint !== null
        ? extractedGramsHint
        : (totalMl / 240) * gramsPerCup;
    targetAmount = totalGrams / (UNIT_TO_GRAMS[targetUnit] as number);
  }

  const formatted = formatHebrewAmountWithUnit(targetAmount, targetUnit);
  const convertedText = ingredientName ? formatted + ' ' + ingredientName : formatted;

  return {
    convertedText,
    isConverted: sourceUnit !== targetUnit,
    note: sourceUnit !== targetUnit ? 'במקור: ' + cleanedLine : undefined,
  };
}
