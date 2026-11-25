export type DietMode = 'none' | 'vegan' | 'gluten-free' | 'dairy-free';

export interface ParsedIngredient {
  originalLine: string;
  amount: number | null;
  unit: string | null;
  ingredientName: string;
  scaledAmount: number | null;
  gramsEquivalent: number | null;
  substitutionNote: string | null;
  displayText: string;
}

const VOLUME_TO_ML: Record<string, number> = {
  'כוס': 240,
  'כוסות': 240,
  'cup': 240,
  'cups': 240,
  'כף': 15,
  'כפות': 15,
  'tbsp': 15,
  'כפית': 5,
  'כפיות': 5,
  'tsp': 5,
  'מ"ל': 1,
  'מל': 1,
  'ml': 1,
  'ליטר': 1000,
  'liter': 1000,
};

const WEIGHT_TO_GRAMS: Record<string, number> = {
  'גרם': 1,
  "ג'": 1,
  'g': 1,
  'gram': 1,
  'grams': 1,
  'ק"ג': 1000,
  'קילו': 1000,
  'kg': 1000,
};

const INGREDIENT_CUP_WEIGHTS: Array<{ keywords: string[]; gramsPerCup: number }> = [
  { keywords: ['קמח', 'flour'], gramsPerCup: 140 },
  { keywords: ['אבקת סוכר', 'powdered sugar'], gramsPerCup: 120 },
  { keywords: ['סוכר חום', 'brown sugar'], gramsPerCup: 220 },
  { keywords: ['סוכר', 'sugar'], gramsPerCup: 200 },
  { keywords: ['שמן', 'oil'], gramsPerCup: 218 },
  { keywords: ['חמאה', 'butter'], gramsPerCup: 227 },
  { keywords: ['מים', 'חלב', 'מיץ', 'water', 'milk'], gramsPerCup: 240 },
  { keywords: ['דבש', 'סילאן', 'מייפל', 'honey', 'maple'], gramsPerCup: 340 },
  { keywords: ['קקאו', 'cocoa'], gramsPerCup: 100 },
  { keywords: ['קורנפלור', 'cornstarch'], gramsPerCup: 128 },
  { keywords: ['שיבולת שועל', 'oats'], gramsPerCup: 90 },
  { keywords: ['אורז', 'rice'], gramsPerCup: 185 },
  { keywords: ['שקדים טחונים', 'קמח שקדים', 'almond flour'], gramsPerCup: 96 },
  { keywords: ['מלח', 'salt'], gramsPerCup: 288 },
  { keywords: ['אבקת אפייה', 'סודה לשתייה', 'baking powder'], gramsPerCup: 230 },
];

interface SubstitutionRule {
  keywords: string[];
  modes: DietMode[];
  replacementName: string;
  ratioMultiplier: number;
  customUnit?: string;
  note: string;
}

const SUBSTITUTION_RULES: SubstitutionRule[] = [
  {
    keywords: ['חמאה', 'butter'],
    modes: ['vegan', 'dairy-free'],
    replacementName: 'שמן קוקוס מזוכך / שמן זית עדין',
    ratioMultiplier: 0.85,
    note: 'הומר לשמן (85% מכמות החמאה למרקם זהה)',
  },
  {
    keywords: ['חלב', 'milk'],
    modes: ['vegan', 'dairy-free'],
    replacementName: 'חלב סויה / שיבולת שועל ללא סוכר',
    ratioMultiplier: 1,
    note: 'הומר לתחליף חלב צמחי ביחס 1:1',
  },
  {
    keywords: ['שמנת מתוקה', 'שמנת להקצפה', 'heavy cream'],
    modes: ['vegan', 'dairy-free'],
    replacementName: 'קרם קוקוס (לפחות 17% שומן) / שמנת צמחית',
    ratioMultiplier: 1,
    note: 'הומר לתחליף שמנת צמחי',
  },
  {
    keywords: ['ביצה', 'ביצים', 'egg', 'eggs'],
    modes: ['vegan'],
    replacementName: 'כפות זרעי פשתן טחונים + מים (יחס 1:3)',
    ratioMultiplier: 1,
    customUnit: 'יחידות תחליף פשתן',
    note: 'לכל ביצה: ערבבו 1 כף פשתן טחון + 3 כפות מים והמתינו 5 דקות',
  },
  {
    keywords: ['דבש', 'honey'],
    modes: ['vegan'],
    replacementName: 'סילאן טבעי / סירופ מייפל',
    ratioMultiplier: 1,
    note: 'הומר לממתיק צמחי ביחס 1:1',
  },
  {
    keywords: ['קמח לבן', 'קמח תופח', 'קמח', 'flour'],
    modes: ['gluten-free'],
    replacementName: 'קמח תמי / תערובת קמח ללא גלוטן',
    ratioMultiplier: 1,
    note: 'הומר לקמח ייעודי ללא גלוטן ביחס 1:1',
  },
  {
    keywords: ['פירורי לחם', 'breadcrumbs'],
    modes: ['gluten-free'],
    replacementName: 'פירורי לחם ללא גלוטן / שקדים טחונים',
    ratioMultiplier: 1,
    note: 'הומר לציפוי ללא גלוטן',
  },
  {
    keywords: ['רוטב סויה', 'soy sauce'],
    modes: ['gluten-free'],
    replacementName: 'רוטב טמארי (סויה ללא גלוטן)',
    ratioMultiplier: 1,
    note: 'סויה רגילה מכילה חיטה - הומר לטמארי',
  },
];

function parseFractionNumber(raw: string): number | null {
  const unicodeFractions: Record<string, number> = {
    '½': 0.5,
    '⅓': 0.333,
    '⅔': 0.667,
    '¼': 0.25,
    '¾': 0.75,
    '⅛': 0.125,
  };

  const cleaned = raw.trim();
  for (const [char, val] of Object.entries(unicodeFractions)) {
    if (cleaned.includes(char)) {
      const prefix = cleaned.replace(char, '').trim();
      return (prefix ? parseFloat(prefix) : 0) + val;
    }
  }

  const mixedMatch = cleaned.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    return parseInt(mixedMatch[1], 10) + parseInt(mixedMatch[2], 10) / parseInt(mixedMatch[3], 10);
  }

  const fracMatch = cleaned.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) {
    return parseInt(fracMatch[1], 10) / parseInt(fracMatch[2], 10);
  }

  const num = parseFloat(cleaned.replace(',', '.'));
  return isNaN(num) ? null : num;
}

export function formatCleanNumber(num: number): string {
  const whole = Math.floor(num);
  const remainder = num - whole;

  const fractionMap: Array<{ val: number; label: string }> = [
    { val: 0.25, label: '¼' },
    { val: 0.33, label: '⅓' },
    { val: 0.5, label: '½' },
    { val: 0.66, label: '⅔' },
    { val: 0.75, label: '¾' },
  ];

  for (const frac of fractionMap) {
    if (Math.abs(remainder - frac.val) < 0.04) {
      return whole > 0 ? whole + ' ' + frac.label : frac.label;
    }
  }

  return Number.isInteger(num) ? num.toString() : num.toFixed(1).replace(/\.0$/, '');
}

export function parseAndScaleLine(
  line: string,
  scaleFactor: number,
  dietMode: DietMode,
  convertToGrams: boolean
): ParsedIngredient {
  const trimmed = line.trim().replace(/^[-*•]\s*/, '');
  if (!trimmed) {
    return {
      originalLine: line,
      amount: null,
      unit: null,
      ingredientName: '',
      scaledAmount: null,
      gramsEquivalent: null,
      substitutionNote: null,
      displayText: '',
    };
  }

  const allUnits = [
    ...Object.keys(VOLUME_TO_ML),
    ...Object.keys(WEIGHT_TO_GRAMS),
    'יחידות',
    "יח'",
    'חבילה',
    'חבילות',
    'שיני',
    'עלים',
  ];
  const unitsPattern = allUnits.sort((a, b) => b.length - a.length).join('|');

  const regex = new RegExp(
    '^(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?|[½⅓⅔¼¾⅛])\\s*(' +
      unitsPattern +
      ')?(?:\\s+של)?\\s+(.+)$',
    'i'
  );

  const match = trimmed.match(regex);

  if (!match) {
    let subNote: string | null = null;
    let display = trimmed;
    if (dietMode !== 'none') {
      for (const rule of SUBSTITUTION_RULES) {
        if (rule.modes.includes(dietMode) && rule.keywords.some((kw) => trimmed.includes(kw))) {
          subNote = rule.note;
          display = rule.replacementName + ' (במקום: ' + trimmed + ')';
          break;
        }
      }
    }

    return {
      originalLine: line,
      amount: null,
      unit: null,
      ingredientName: trimmed,
      scaledAmount: null,
      gramsEquivalent: null,
      substitutionNote: subNote,
      displayText: display,
    };
  }

  const rawAmount = match[1];
  const rawUnit = match[2] ? match[2].toLowerCase() : null;
  let ingredientName = match[3].trim();

  const parsedAmount = parseFractionNumber(rawAmount);
  let scaledAmount = parsedAmount !== null ? parsedAmount * scaleFactor : null;
  let currentUnit = rawUnit;
  let substitutionNote: string | null = null;

  if (dietMode !== 'none' && scaledAmount !== null) {
    for (const rule of SUBSTITUTION_RULES) {
      if (
        rule.modes.includes(dietMode) &&
        rule.keywords.some((kw) => ingredientName.toLowerCase().includes(kw))
      ) {
        scaledAmount = scaledAmount * rule.ratioMultiplier;
        ingredientName = rule.replacementName;
        if (rule.customUnit) {
          currentUnit = rule.customUnit;
        }
        substitutionNote = rule.note;
        break;
      }
    }
  }

  let gramsEquivalent: number | null = null;
  if (scaledAmount !== null && currentUnit) {
    if (WEIGHT_TO_GRAMS[currentUnit]) {
      gramsEquivalent = Math.round(scaledAmount * WEIGHT_TO_GRAMS[currentUnit]);
    } else if (VOLUME_TO_ML[currentUnit]) {
      const totalMl = scaledAmount * VOLUME_TO_ML[currentUnit];
      const densityMatch = INGREDIENT_CUP_WEIGHTS.find((item) =>
        item.keywords.some((kw) => ingredientName.toLowerCase().includes(kw))
      );
      if (densityMatch) {
        gramsEquivalent = Math.round((totalMl / 240) * densityMatch.gramsPerCup);
      }
    }
  }

  let displayText = '';
  if (scaledAmount !== null) {
    if (convertToGrams && gramsEquivalent !== null && currentUnit && VOLUME_TO_ML[currentUnit]) {
      displayText = gramsEquivalent + ' גרם ' + ingredientName;
    } else {
      const formattedNum = formatCleanNumber(scaledAmount);
      const unitStr = currentUnit ? ' ' + currentUnit : '';
      const gramsHint =
        gramsEquivalent !== null && currentUnit && VOLUME_TO_ML[currentUnit]
          ? ' (~' + gramsEquivalent + ' גרם)'
          : '';
      displayText = formattedNum + unitStr + ' ' + ingredientName + gramsHint;
    }
  } else {
    displayText = trimmed;
  }

  return {
    originalLine: line,
    amount: parsedAmount,
    unit: currentUnit,
    ingredientName,
    scaledAmount,
    gramsEquivalent,
    substitutionNote,
    displayText,
  };
}
