import fs from 'node:fs';
import path from 'node:path';

const layoutCode = `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ממיר מתכונים חכם',
  description: 'התאמת כמויות, המרה לגרמים, החלפת רכיבים, טיימרים וספר מתכונים ללא AI',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
`;

const engineCode = `export type DietMode = 'none' | 'vegan' | 'gluten-free' | 'dairy-free';
export type TempUnit = 'C' | 'F';
export type MeasureSystem = 'metric' | 'us';

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

export interface DetectedTimer {
  id: string;
  seconds: number;
  label: string;
}

export interface AirFryerHint {
  tempText: string;
  timeText: string;
  summary: string;
}

export interface ExtractedRecipeResult {
  ingredients: string[];
  steps: string[];
  sourceMethod: 'json-ld' | 'text-parser' | 'html-fallback';
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

  const mixedMatch = cleaned.match(/^(\\d+)\\s+(\\d+)\\/(\\d+)$/);
  if (mixedMatch) {
    return parseInt(mixedMatch[1], 10) + parseInt(mixedMatch[2], 10) / parseInt(mixedMatch[3], 10);
  }

  const fracMatch = cleaned.match(/^(\\d+)\\/(\\d+)$/);
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

  return Number.isInteger(num) ? num.toString() : num.toFixed(1).replace(/\\.0$/, '');
}

function formatUsMeasurement(
  scaledAmount: number,
  currentUnit: string | null,
  gramsEquivalent: number | null,
  ingredientName: string
): { text: string; extraHint: string } {
  if (!currentUnit) {
    return { text: formatCleanNumber(scaledAmount) + ' ' + ingredientName, extraHint: '' };
  }

  const u = currentUnit.toLowerCase();

  if (u === 'כוס' || u === 'כוסות' || u === 'cup' || u === 'cups') {
    const unitWord = Math.abs(scaledAmount - 1) < 0.05 ? 'cup' : 'cups';
    const gHint = gramsEquivalent !== null ? ' (~' + gramsEquivalent + 'g)' : '';
    return {
      text: formatCleanNumber(scaledAmount) + ' ' + unitWord + ' ' + ingredientName + gHint,
      extraHint: '',
    };
  }

  if (u === 'כף' || u === 'כפות' || u === 'tbsp') {
    const mlVal = scaledAmount * 15;
    const ozVal = mlVal / 29.5735;
    return {
      text: formatCleanNumber(scaledAmount) + ' tbsp ' + ingredientName,
      extraHint: ' (' + Math.round(mlVal) + 'ml / ' + ozVal.toFixed(1) + 'oz)',
    };
  }

  if (u === 'כפית' || u === 'כפיות' || u === 'tsp') {
    const mlVal = scaledAmount * 5;
    return {
      text: formatCleanNumber(scaledAmount) + ' tsp ' + ingredientName,
      extraHint: ' (' + Math.round(mlVal) + 'ml)',
    };
  }

  if (u === 'מ"ל' || u === 'מל' || u === 'ml') {
    const ozVal = scaledAmount / 29.5735;
    return {
      text: ozVal.toFixed(1) + ' oz ' + ingredientName,
      extraHint: ' (' + Math.round(scaledAmount) + 'ml)',
    };
  }

  if (u === 'ליטר' || u === 'liter') {
    const ozVal = (scaledAmount * 1000) / 29.5735;
    return {
      text: ozVal.toFixed(1) + ' fl oz ' + ingredientName,
      extraHint: ' (' + Math.round(scaledAmount * 1000) + 'ml)',
    };
  }

  if (u === 'גרם' || u === "ג'" || u === 'g' || u === 'gram' || u === 'grams') {
    const ozVal = scaledAmount / 28.3495;
    return {
      text: ozVal.toFixed(1) + ' oz ' + ingredientName,
      extraHint: ' (' + Math.round(scaledAmount) + 'g)',
    };
  }

  if (u === 'ק"ג' || u === 'קילו' || u === 'kg') {
    const ozVal = (scaledAmount * 1000) / 28.3495;
    return {
      text: ozVal.toFixed(1) + ' oz ' + ingredientName,
      extraHint: ' (' + Math.round(scaledAmount * 1000) + 'g)',
    };
  }

  return {
    text: formatCleanNumber(scaledAmount) + ' ' + currentUnit + ' ' + ingredientName,
    extraHint: '',
  };
}

export function parseAndScaleLine(
  line: string,
  scaleFactor: number,
  dietMode: DietMode,
  convertToGrams: boolean,
  measureSystem: MeasureSystem = 'metric'
): ParsedIngredient {
  const trimmed = line.trim().replace(/^[-*•]\\s*/, '');
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
    '^(\\\\d+\\\\s+\\\\d+\\\\/\\\\d+|\\\\d+\\\\/\\\\d+|\\\\d+(?:[.,]\\\\d+)?|[½⅓⅔¼¾⅛])\\\\s*(' +
      unitsPattern +
      ')?(?:\\\\s+של)?\\\\s+(.+)$',
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
    if (measureSystem === 'us') {
      const usRes = formatUsMeasurement(scaledAmount, currentUnit, gramsEquivalent, ingredientName);
      displayText = usRes.text + usRes.extraHint;
    } else if (convertToGrams && gramsEquivalent !== null && currentUnit && VOLUME_TO_ML[currentUnit]) {
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

export function extractTimersFromStep(stepText: string, stepIndex: number): DetectedTimer[] {
  const results: DetectedTimer[] = [];
  const timeRegex =
    /(?:כ-|בערך\\s+)?(\\d+(?:[.,]\\d+)?(?:\\s*-\\s*\\d+(?:[.,]\\d+)?)?|[½¼¾])\\s*(שעות|שעה|דקות|דקה|שניות|שנייה|hours?|hour|minutes?|mins?|min|seconds?|secs?|sec)(?=\\s|[.,!?;:]|$)/gi;

  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = timeRegex.exec(stepText)) !== null) {
    const rawNumPart = match[1].trim();
    const rawUnit = match[2].toLowerCase();

    const rangeParts = rawNumPart.split('-').map((p) => p.trim());
    const chosenNumStr = rangeParts[rangeParts.length - 1];
    const parsedVal = parseFractionNumber(chosenNumStr);

    if (!parsedVal || parsedVal <= 0) continue;

    let multiplier = 60;
    let unitLabel = 'דקות';

    if (rawUnit.startsWith('שע') || rawUnit.startsWith('hour')) {
      multiplier = 3600;
      unitLabel = parsedVal === 1 ? 'שעה' : 'שעות';
    } else if (rawUnit.startsWith('שנ') || rawUnit.startsWith('sec')) {
      multiplier = 1;
      unitLabel = parsedVal === 1 ? 'שנייה' : 'שניות';
    } else {
      multiplier = 60;
      unitLabel = parsedVal === 1 ? 'דקה' : 'דקות';
    }

    const totalSeconds = Math.max(1, Math.round(parsedVal * multiplier));
    const displayVal = formatCleanNumber(parsedVal);

    results.push({
      id: 'step-' + stepIndex + '-timer-' + idx,
      seconds: totalSeconds,
      label: displayVal + ' ' + unitLabel,
    });
    idx += 1;
  }

  return results;
}

export function formatStepTemperatures(stepText: string, unit: TempUnit): string {
  const cRegex = /(\\d{2,3})(?:\\s*(?:°\\s*C|℃|מעלות(?:\\s*צלזיוס)?))(?=[\\s.,!?;:)]|$)/gi;
  const fRegex = /(\\d{2,3})\\s*(?:°\\s*F|℉)(?=[\\s.,!?;:)]|$)/gi;

  let result = stepText.replace(cRegex, (fullMatch, numStr) => {
    const cVal = Number(numStr);
    if (isNaN(cVal)) return fullMatch;
    if (unit === 'C') {
      return cVal + '°C';
    }
    const fVal = Math.round((cVal * 9) / 5 + 32);
    return fVal + '°F';
  });

  result = result.replace(fRegex, (fullMatch, numStr) => {
    const fVal = Number(numStr);
    if (isNaN(fVal)) return fullMatch;
    if (unit === 'F') {
      return fVal + '°F';
    }
    const cVal = Math.round(((fVal - 32) * 5) / 9);
    return cVal + '°C';
  });

  return result;
}

export function getAirFryerHint(stepText: string, detectedTimers: DetectedTimer[]): AirFryerHint | null {
  const bakeOrRoastRegex = /(אופים|לאפות|אפייה|צולים|לצלות|צלייה|תנור|bake|roast|oven)/i;
  if (!bakeOrRoastRegex.test(stepText)) return null;

  let baseCelsius: number | null = null;
  const cMatch = stepText.match(/(\\d{2,3})(?:\\s*(?:°\\s*C|℃|מעלות(?:\\s*צלזיוס)?))(?=[\\s.,!?;:)]|$)/i);
  const fMatch = stepText.match(/(\\d{2,3})\\s*(?:°\\s*F|℉)(?=[\\s.,!?;:)]|$)/i);

  if (cMatch) {
    baseCelsius = Number(cMatch[1]);
  } else if (fMatch) {
    baseCelsius = Math.round(((Number(fMatch[1]) - 32) * 5) / 9);
  }

  const airTempC = baseCelsius !== null ? Math.max(120, baseCelsius - 20) : 165;
  const airTempF = Math.round((airTempC * 9) / 5 + 32);
  const tempText = airTempC + '°C / ' + airTempF + '°F';

  let timeText = 'קצר בכ-20% מזמן התנור';
  if (detectedTimers.length > 0) {
    const mainSec = detectedTimers[0].seconds;
    const adjustedMin = Math.max(1, Math.round((mainSec * 0.8) / 60));
    timeText = 'כ-' + adjustedMin + ' דק׳ (במקום ' + formatCleanNumber(mainSec / 60) + ' דק׳)';
  }

  return {
    tempText,
    timeText,
    summary: 'אייר-פריי משוער: ' + tempText + ' • ' + timeText,
  };
}

export function formatSecondsClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hrs > 0) {
    return hrs + ':' + pad(mins) + ':' + pad(secs);
  }
  return pad(mins) + ':' + pad(secs);
}

export function extractRecipeFromText(rawText: string): { ingredients: string[]; steps: string[] } {
  const lines = rawText
    .split(/\\r?\\n/)
    .map((l) => l.replace(/^[•*\\-–—]+\\s*/, '').replace(/^\\d+[.)]\\s*/, '').trim())
    .filter((l) => l.length > 1);

  const ingredientHeaders = /^(מצרכים|מרכיבים|רכיבים|המצרכים|המרכיבים|ingredients?)\\s*:?$/i;
  const stepHeaders = /^(אופן ההכנה|הכנה|שלבי הכנה|הוראות הכנה|הוראות|instructions?|directions?|steps?|method)\\s*:?$/i;
  const fluffPatterns =
    /(השאירו תגובה|שתפו בתגובות|בתיאבון|שמור מתכון|הדפס מתכון|subscribe|cookie|privacy|all rights reserved)/i;

  let section: 'unknown' | 'ingredients' | 'steps' = 'unknown';
  const ingredients: string[] = [];
  const steps: string[] = [];

  const unitWords = [
    ...Object.keys(VOLUME_TO_ML),
    ...Object.keys(WEIGHT_TO_GRAMS),
    'יחידות',
    "יח'",
    'חבילה',
    'חבילות',
    'שיני',
    'עלים',
    'קופסה',
    'קופסאות',
    'צרור',
    'קורט',
    'pinch',
    'cloves?',
    'cans?',
    'packages?',
  ];
  const startsWithAmountOrUnit = new RegExp(
    '^(\\d+|[½⅓⅔¼¾⅛]|' + unitWords.join('|') + ')\\b',
    'i'
  );
  const actionVerbRegex =
    /(מחממים|מערבבים|מוסיפים|אופים|מבשלים|מטגנים|מקציפים|חותכים|קוצצים|מקררים|מכניסים|יוצקים|לשים|מרדדים|מתבלים|מגישים|preheat|mix|stir|add|bake|boil|fry|whisk|chop|slice|cool|pour|knead|simmer)/i;

  for (const line of lines) {
    if (fluffPatterns.test(line)) continue;

    if (ingredientHeaders.test(line)) {
      section = 'ingredients';
      continue;
    }
    if (stepHeaders.test(line)) {
      section = 'steps';
      continue;
    }

    if (section === 'ingredients') {
      if (line.length > 110 && actionVerbRegex.test(line)) {
        section = 'steps';
        steps.push(line);
      } else {
        ingredients.push(line);
      }
      continue;
    }

    if (section === 'steps') {
      if (line.length <= 55 && startsWithAmountOrUnit.test(line) && !actionVerbRegex.test(line)) {
        ingredients.push(line);
      } else {
        steps.push(line);
      }
      continue;
    }

    const looksLikeIngredient =
      line.length <= 75 &&
      startsWithAmountOrUnit.test(line) &&
      (!actionVerbRegex.test(line) || line.split(' ').length <= 6);

    if (looksLikeIngredient) {
      ingredients.push(line);
    } else if (line.length >= 25 && (actionVerbRegex.test(line) || /[.!]$/.test(line))) {
      steps.push(line);
    }
  }

  return { ingredients, steps };
}
`;

const recipeBookLibCode = `import { DietMode } from '@/lib/recipeEngine';

export interface SavedRecipeItem {
  id: string;
  title: string;
  category: string;
  subCategory: string;
  favorite: boolean;
  rawIngredients: string;
  rawSteps: string;
  originalServings: number;
  targetServings: number;
  dietMode: DietMode;
  convertToGrams: boolean;
  createdAt: string;
}

export type BookExportScope = 'all' | 'selected' | 'favorites';

const STORAGE_KEY = 'smart_recipe_scaler_book_v1';

export const DEFAULT_CATEGORIES: Record<string, string[]> = {
  'קינוחים': ['עוגות', 'עוגיות', 'מאפים מתוקים', 'גלידות ומוסים'],
  'עיקריות': ['בשרי', 'עוף', 'דגים', 'צמחוני/טבעוני', 'פסטות ואורז'],
  'תוספות וסלטים': ['סלטים', 'ירקות בתנור', 'פחמימות'],
  'ארוחות בוקר ומאפים': ['לחמים וחלות', 'פשטידות', 'חביתות וממרחים'],
};

export function loadSavedRecipes(): SavedRecipeItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistSavedRecipes(items: SavedRecipeItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // חריגת מכסת LocalStorage או חסימה
  }
}

export function groupRecipesByCategory(items: SavedRecipeItem[]): Array<{
  category: string;
  subGroups: Array<{ subCategory: string; recipes: SavedRecipeItem[] }>;
}> {
  const catMap = new Map<string, Map<string, SavedRecipeItem[]>>();

  for (const r of items) {
    const cat = (r.category || 'כללי').trim() || 'כללי';
    const sub = (r.subCategory || 'כללי').trim() || 'כללי';

    if (!catMap.has(cat)) {
      catMap.set(cat, new Map<string, SavedRecipeItem[]>());
    }
    const subMap = catMap.get(cat)!;
    if (!subMap.has(sub)) {
      subMap.set(sub, []);
    }
    subMap.get(sub)!.push(r);
  }

  return Array.from(catMap.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'he'))
    .map(([category, subMap]) => ({
      category,
      subGroups: Array.from(subMap.entries())
        .sort(([a], [b]) => a.localeCompare(b, 'he'))
        .map(([subCategory, recipes]) => ({
          subCategory,
          recipes,
        })),
    }));
}
`;

const recipeBookVaultCode = `'use client';

import React, { useState, useMemo } from 'react';
import {
  DEFAULT_CATEGORIES,
  SavedRecipeItem,
  BookExportScope,
  groupRecipesByCategory,
} from '@/lib/recipeBook';
import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';

interface RecipeBookVaultProps {
  savedRecipes: SavedRecipeItem[];
  onSaveCurrentRecipe: (meta: {
    title: string;
    category: string;
    subCategory: string;
    favorite: boolean;
  }) => void;
  onUpdateRecipe: (updated: SavedRecipeItem) => void;
  onLoadRecipeToScaler: (item: SavedRecipeItem) => void;
  onToggleFavorite: (id: string) => void;
  onDeleteRecipe: (id: string) => void;
  onUpdateRecipeCategory: (id: string, category: string, subCategory: string) => void;
  measureSystem: MeasureSystem;
  darkMode: boolean;
}

export default function RecipeBookVault({
  savedRecipes,
  onSaveCurrentRecipe,
  onUpdateRecipe,
  onLoadRecipeToScaler,
  onToggleFavorite,
  onDeleteRecipe,
  onUpdateRecipeCategory,
  measureSystem,
  darkMode,
}: RecipeBookVaultProps) {
  const [newTitle, setNewTitle] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('קינוחים');
  const [customCategory, setCustomCategory] = useState<string>('');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>('עוגות');
  const [customSubCategory, setCustomSubCategory] = useState<string>('');
  const [newFavorite, setNewFavorite] = useState<boolean>(false);

  // עריכה ישירה של מתכון שמור
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editCategory, setEditCategory] = useState<string>('');
  const [editSubCategory, setEditSubCategory] = useState<string>('');
  const [editOriginalServings, setEditOriginalServings] = useState<number>(4);
  const [editTargetServings, setEditTargetServings] = useState<number>(4);
  const [editIngredients, setEditIngredients] = useState<string>('');
  const [editSteps, setEditSteps] = useState<string>('');

  // כריכה, תוכן עניינים וייצוא ספר מתכונים
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [exportScope, setExportScope] = useState<BookExportScope>('all');
  const [bookOpen, setBookOpen] = useState<boolean>(false);
  const [bookTitle, setBookTitle] = useState<string>('ספר המתכונים המשפחתי שלי');
  const [copiedBook, setCopiedBook] = useState<boolean>(false);

  const generatedDateLabel = useMemo(() => {
    return new Date().toLocaleDateString('he-IL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }, []);

  const availableCategories = useMemo(() => {
    const set = new Set<string>(Object.keys(DEFAULT_CATEGORIES));
    savedRecipes.forEach((r) => {
      if (r.category) set.add(r.category);
    });
    return Array.from(set);
  }, [savedRecipes]);

  const availableSubCategories = useMemo(() => {
    const base = DEFAULT_CATEGORIES[selectedCategory] || ['כללי'];
    const set = new Set<string>(base);
    savedRecipes.forEach((r) => {
      if (r.category === selectedCategory && r.subCategory) {
        set.add(r.subCategory);
      }
    });
    return Array.from(set);
  }, [selectedCategory, savedRecipes]);

  const resolvedCategory = customCategory.trim() || selectedCategory || 'כללי';
  const resolvedSubCategory = customSubCategory.trim() || selectedSubCategory || 'כללי';

  const handleSaveClick = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveCurrentRecipe({
      title: newTitle.trim() || 'מתכון ללא שם',
      category: resolvedCategory,
      subCategory: resolvedSubCategory,
      favorite: newFavorite,
    });
    setNewTitle('');
    setCustomCategory('');
    setCustomSubCategory('');
    setNewFavorite(false);
  };

  const startEditingRecipe = (rec: SavedRecipeItem) => {
    setEditingId(rec.id);
    setEditTitle(rec.title);
    setEditCategory(rec.category);
    setEditSubCategory(rec.subCategory);
    setEditOriginalServings(rec.originalServings);
    setEditTargetServings(rec.targetServings);
    setEditIngredients(rec.rawIngredients);
    setEditSteps(rec.rawSteps);
  };

  const saveEditedRecipe = (original: SavedRecipeItem) => {
    onUpdateRecipe({
      ...original,
      title: editTitle.trim() || original.title,
      category: editCategory.trim() || 'כללי',
      subCategory: editSubCategory.trim() || 'כללי',
      originalServings: Math.max(1, editOriginalServings || 1),
      targetServings: Math.max(1, editTargetServings || 1),
      rawIngredients: editIngredients,
      rawSteps: editSteps,
    });
    setEditingId(null);
  };

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const recipesForBook = useMemo(() => {
    if (exportScope === 'favorites') {
      return savedRecipes.filter((r) => r.favorite);
    }
    if (exportScope === 'selected') {
      return savedRecipes.filter((r) => !!selectedIds[r.id]);
    }
    return savedRecipes;
  }, [savedRecipes, exportScope, selectedIds]);

  const groupedBook = useMemo(() => groupRecipesByCategory(recipesForBook), [recipesForBook]);

  const scrollToSection = (elementId: string) => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(elementId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const buildBookPlainText = () => {
    if (groupedBook.length === 0) return 'אין מתכונים תואמים להצגה בספר המתכונים.';
    const lines: string[] = [
      '📖 ' + (bookTitle.trim() || 'ספר המתכונים שלי'),
      'תאריך הפקה: ' + generatedDateLabel,
      '====================================',
      'תוכן עניינים:',
    ];

    for (const catGroup of groupedBook) {
      lines.push('• ' + catGroup.category);
      for (const subGroup of catGroup.subGroups) {
        lines.push('   - ' + subGroup.subCategory + ' (' + subGroup.recipes.length + ')');
      }
    }

    for (const catGroup of groupedBook) {
      lines.push('\\n📁 ' + catGroup.category);
      for (const subGroup of catGroup.subGroups) {
        lines.push('  📂 ' + subGroup.subCategory);
        for (const rec of subGroup.recipes) {
          const factor = rec.originalServings > 0 ? rec.targetServings / rec.originalServings : 1;
          const scaledIngs = rec.rawIngredients
            .split('\\n')
            .filter((l) => l.trim())
            .map(
              (l) =>
                '      • ' +
                parseAndScaleLine(l, factor, rec.dietMode, rec.convertToGrams, measureSystem)
                  .displayText
            );
          const steps = rec.rawSteps
            .split('\\n')
            .filter((l) => l.trim())
            .map((s, i) => '      ' + (i + 1) + '. ' + s.trim());

          lines.push(
            '    • ' + (rec.favorite ? '⭐ ' : '') + rec.title + ' (' + rec.targetServings + ' מנות)'
          );
          lines.push('      מצרכים:');
          lines.push(...scaledIngs);
          if (steps.length > 0) {
            lines.push('      אופן ההכנה:');
            lines.push(...steps);
          }
        }
      }
    }

    return lines.join('\\n');
  };

  const handleCopyBookText = () => {
    navigator.clipboard.writeText(buildBookPlainText());
    setCopiedBook(true);
    setTimeout(() => setCopiedBook(false), 2000);
  };

  const surfaceClass = darkMode
    ? 'bg-slate-900 text-slate-100 border-slate-800'
    : 'bg-white text-stone-900 border-stone-200';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-stone-500';
  const inputClass = darkMode
    ? 'bg-slate-800 text-slate-100 border-slate-700 focus:border-amber-400'
    : 'bg-white text-stone-900 border-stone-300 focus:border-amber-500';

  return (
    <div className="space-y-6">
      {/* שמירת המתכון הנוכחי עם קטגוריה ותת-קטגוריה */}
      <section className={'p-6 rounded-2xl shadow-sm border space-y-4 ' + surfaceClass}>
        <div>
          <h2 className="font-bold text-lg">שמור את המתכון הנוכחי לספרייה</h2>
          <p className={mutedClass + ' text-xs mt-0.5'}>
            בחר קטגוריה ותת-קטגוריה (למשל: קינוחים ← עוגות או עוגיות) וסמן מועדפים לפי הצורך
          </p>
        </div>

        <form onSubmit={handleSaveClick} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-3">
            <label className={mutedClass + ' block text-xs font-semibold mb-1'}>שם המתכון</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="למשל: עוגת שוקולד בחושה"
              className={'w-full px-3 py-2 border rounded-xl text-sm focus:outline-none ' + inputClass}
            />
          </div>

          <div className="md:col-span-3 space-y-1.5">
            <label className={mutedClass + ' block text-xs font-semibold'}>קטגוריה ראשית</label>
            <select
              value={selectedCategory}
              onChange={(e) => {
                const nextCat = e.target.value;
                setSelectedCategory(nextCat);
                const firstSub =
                  (DEFAULT_CATEGORIES[nextCat] && DEFAULT_CATEGORIES[nextCat][0]) || 'כללי';
                setSelectedSubCategory(firstSub);
              }}
              className={'w-full px-3 py-2 border rounded-xl text-sm ' + inputClass}
            >
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="או כתוב קטגוריה חדשה..."
              className={'w-full px-2.5 py-1.5 border rounded-lg text-xs focus:outline-none ' + inputClass}
            />
          </div>

          <div className="md:col-span-3 space-y-1.5">
            <label className={mutedClass + ' block text-xs font-semibold'}>תת-קטגוריה (סוג)</label>
            <select
              value={selectedSubCategory}
              onChange={(e) => setSelectedSubCategory(e.target.value)}
              className={'w-full px-3 py-2 border rounded-xl text-sm ' + inputClass}
            >
              {availableSubCategories.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={customSubCategory}
              onChange={(e) => setCustomSubCategory(e.target.value)}
              placeholder="או תת-קטגוריה חדשה..."
              className={'w-full px-2.5 py-1.5 border rounded-lg text-xs focus:outline-none ' + inputClass}
            />
          </div>

          <div className="md:col-span-3 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={newFavorite}
                onChange={(e) => setNewFavorite(e.target.checked)}
                className="rounded accent-amber-500"
              />
              <span>סמן כמתכון מועדף ⭐</span>
            </label>
            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm cursor-pointer"
            >
              שמור מתכון
            </button>
          </div>
        </form>
      </section>

      {/* רשימת מתכונים שמורים, עריכה ישירה, מועדפים, בחירה ומחיקה */}
      <section className={'p-6 rounded-2xl shadow-sm border space-y-4 ' + surfaceClass}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-lg">
              מתכונים שמורים ({savedRecipes.length}) • מועדפים (
              {savedRecipes.filter((r) => r.favorite).length})
            </h2>
            <p className={mutedClass + ' text-xs'}>
              סמן תיבת בחירה למתכונים לייצוא &ldquo;רק נבחרים&rdquo;, ערוך מתכון ישירות, או סמן ⭐ למועדפים
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
              placeholder="כותרת לספר המתכונים..."
              className={'w-48 px-3 py-2 border rounded-xl text-xs ' + inputClass}
              title="כותרת ספר המתכונים"
            />

            <select
              value={exportScope}
              onChange={(e) => setExportScope(e.target.value as BookExportScope)}
              className={'px-3 py-2 border rounded-xl text-xs font-semibold ' + inputClass}
            >
              <option value="all">ספר מתכונים: הכל</option>
              <option value="selected">ספר מתכונים: רק נבחרים</option>
              <option value="favorites">ספר מתכונים: רק מועדפים</option>
            </select>

            <button
              type="button"
              onClick={() => setBookOpen(!bookOpen)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs cursor-pointer"
            >
              {bookOpen ? 'סגור ספר מתכונים' : 'הוצא לספר מתכונים'}
            </button>
          </div>
        </div>

        {savedRecipes.length === 0 ? (
          <div className={mutedClass + ' text-sm py-8 text-center border border-dashed rounded-xl'}>
            עדיין לא נשמרו מתכונים. שמור את המתכון הנוכחי בטופס למעלה כדי להתחיל.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {savedRecipes.map((rec) => {
              const isSelected = !!selectedIds[rec.id];
              const isEditing = editingId === rec.id;

              return (
                <div
                  key={rec.id}
                  className={
                    'p-4 rounded-xl border flex flex-col justify-between gap-3 ' +
                    (darkMode
                      ? 'bg-slate-800/60 border-slate-700'
                      : 'bg-stone-50/70 border-stone-200')
                  }
                >
                  {isEditing ? (
                    <div className="space-y-2.5">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="שם המתכון"
                        className={'w-full px-3 py-1.5 border rounded-lg text-sm font-bold ' + inputClass}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          placeholder="קטגוריה"
                          className={'w-full px-2.5 py-1.5 border rounded-lg text-xs ' + inputClass}
                        />
                        <input
                          type="text"
                          value={editSubCategory}
                          onChange={(e) => setEditSubCategory(e.target.value)}
                          placeholder="תת-קטגוריה"
                          className={'w-full px-2.5 py-1.5 border rounded-lg text-xs ' + inputClass}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={mutedClass + ' text-[11px]'}>מנות במקור:</label>
                          <input
                            type="number"
                            min={1}
                            value={editOriginalServings}
                            onChange={(e) => setEditOriginalServings(Number(e.target.value))}
                            className={'w-full px-2 py-1 border rounded-lg text-xs text-center ' + inputClass}
                          />
                        </div>
                        <div>
                          <label className={mutedClass + ' text-[11px]'}>מנות רצוי:</label>
                          <input
                            type="number"
                            min={1}
                            value={editTargetServings}
                            onChange={(e) => setEditTargetServings(Number(e.target.value))}
                            className={'w-full px-2 py-1 border rounded-lg text-xs text-center ' + inputClass}
                          />
                        </div>
                      </div>
                      <div>
                        <label className={mutedClass + ' text-[11px]'}>מצרכים:</label>
                        <textarea
                          rows={4}
                          value={editIngredients}
                          onChange={(e) => setEditIngredients(e.target.value)}
                          className={'w-full p-2 border rounded-lg text-xs ' + inputClass}
                        />
                      </div>
                      <div>
                        <label className={mutedClass + ' text-[11px]'}>שלבי הכנה:</label>
                        <textarea
                          rows={3}
                          value={editSteps}
                          onChange={(e) => setEditSteps(e.target.value)}
                          className={'w-full p-2 border rounded-lg text-xs ' + inputClass}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className={
                            'px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ' +
                            (darkMode ? 'bg-slate-700 text-slate-200' : 'bg-stone-200 text-stone-700')
                          }
                        >
                          ביטול
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEditedRecipe(rec)}
                          className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs cursor-pointer"
                        >
                          שמור שינויים
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectId(rec.id)}
                            className="mt-1 rounded accent-amber-500 cursor-pointer"
                            title="בחר לספר המתכונים"
                          />
                          <div>
                            <div className="font-bold text-base flex items-center gap-1.5">
                              <span>{rec.title}</span>
                              {rec.favorite && <span className="text-amber-400">⭐</span>}
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 font-semibold">
                                {rec.category}
                              </span>
                              <span
                                className={
                                  'text-[11px] px-2 py-0.5 rounded-full font-medium ' +
                                  (darkMode
                                    ? 'bg-slate-700 text-slate-300'
                                    : 'bg-stone-200/80 text-stone-700')
                                }
                              >
                                {rec.subCategory}
                              </span>
                              <span className={mutedClass + ' text-[11px] py-0.5'}>
                                {rec.targetServings} מנות
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onToggleFavorite(rec.id)}
                          className="text-lg leading-none cursor-pointer px-1"
                          title={rec.favorite ? 'הסר ממועדפים' : 'הוסף למועדפים'}
                        >
                          {rec.favorite ? '⭐' : '☆'}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-500/15">
                        <div className="flex items-center gap-1.5 text-xs">
                          <input
                            type="text"
                            defaultValue={rec.category}
                            onBlur={(e) =>
                              onUpdateRecipeCategory(
                                rec.id,
                                e.target.value.trim() || rec.category,
                                rec.subCategory
                              )
                            }
                            className={'w-24 px-2 py-1 border rounded-lg text-[11px] ' + inputClass}
                            title="שנה קטגוריה"
                          />
                          <span className={mutedClass}>←</span>
                          <input
                            type="text"
                            defaultValue={rec.subCategory}
                            onBlur={(e) =>
                              onUpdateRecipeCategory(
                                rec.id,
                                rec.category,
                                e.target.value.trim() || rec.subCategory
                              )
                            }
                            className={'w-24 px-2 py-1 border rounded-lg text-[11px] ' + inputClass}
                            title="שנה תת-קטגוריה"
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => startEditingRecipe(rec)}
                            className={
                              'px-2.5 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ' +
                              (darkMode
                                ? 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'
                                : 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100')
                            }
                          >
                            עריכה
                          </button>
                          <button
                            type="button"
                            onClick={() => onLoadRecipeToScaler(rec)}
                            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs cursor-pointer"
                          >
                            פתח בממיר
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteRecipe(rec.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-red-600/15 hover:bg-red-600 text-red-500 hover:text-white font-semibold text-xs transition-colors cursor-pointer"
                          >
                            מחק
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* כריכה, תוכן עניינים וספר מתכונים ממוין לפי קטגוריות ותתי-קטגוריות */}
      {bookOpen && (
        <section className={'p-6 rounded-2xl shadow-md border space-y-6 ' + surfaceClass}>
          {/* כריכת הספר */}
          <div
            className={
              'p-6 rounded-2xl border text-center space-y-2 ' +
              (darkMode
                ? 'bg-gradient-to-b from-amber-500/15 to-slate-900 border-amber-500/30'
                : 'bg-gradient-to-b from-amber-50 to-white border-amber-200')
            }
          >
            <div className="text-xs font-bold uppercase tracking-wider text-amber-500">
              מהדורת ספר מתכונים •{' '}
              {exportScope === 'all'
                ? 'כל המתכונים'
                : exportScope === 'favorites'
                ? 'מתכונים מועדפים'
                : 'מתכונים נבחרים'}
            </div>
            <h2 className="text-2xl md:text-3xl font-bold">
              {bookTitle.trim() || 'ספר המתכונים שלי'}
            </h2>
            <p className={mutedClass + ' text-xs'}>
              תאריך הפקה: {generatedDateLabel} • {recipesForBook.length} מתכונים • מידות:{' '}
              {measureSystem === 'us' ? 'אמריקאיות (cup / tbsp / oz)' : 'מטריות / ישראליות'}
            </p>
          </div>

          {/* תוכן עניינים מהיר */}
          {groupedBook.length > 0 && (
            <div
              className={
                'p-4 rounded-xl border space-y-3 ' +
                (darkMode ? 'bg-slate-800/40 border-slate-700' : 'bg-stone-50 border-stone-200')
              }
            >
              <h3 className="font-bold text-base">תוכן עניינים</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {groupedBook.map((catGroup, cIdx) => {
                  const catDomId = 'book-cat-' + cIdx;
                  return (
                    <div key={catGroup.category} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => scrollToSection(catDomId)}
                        className="font-bold text-sm text-amber-500 hover:underline cursor-pointer text-right"
                      >
                        {catGroup.category}
                      </button>
                      <ul className="space-y-1 pr-3 text-xs">
                        {catGroup.subGroups.map((subGroup, sIdx) => {
                          const subDomId = 'book-sub-' + cIdx + '-' + sIdx;
                          return (
                            <li key={subGroup.subCategory}>
                              <button
                                type="button"
                                onClick={() => scrollToSection(subDomId)}
                                className={mutedClass + ' hover:underline cursor-pointer text-right'}
                              >
                                {subGroup.subCategory} ({subGroup.recipes.length})
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* פעולות העתקה והדפסה */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-500/20 pb-4">
            <span className={mutedClass + ' text-xs'}>
              ממוין אוטומטית לפי קטגוריה ותת-קטגוריה ({recipesForBook.length} מתכונים)
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyBookText}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs cursor-pointer"
              >
                {copiedBook ? 'הספר הועתק!' : 'העתק טקסט ספר'}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className={
                  'px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer ' +
                  (darkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-stone-100 border-stone-200 text-stone-800 hover:bg-stone-200')
                }
              >
                הדפס / שמור PDF
              </button>
            </div>
          </div>

          {groupedBook.length === 0 ? (
            <div className={mutedClass + ' text-sm py-6 text-center'}>
              אין מתכונים להצגה עבור הבחירה הנוכחית.
            </div>
          ) : (
            <div className="space-y-6">
              {groupedBook.map((catGroup, cIdx) => (
                <div
                  key={catGroup.category}
                  id={'book-cat-' + cIdx}
                  className="space-y-4 scroll-mt-4"
                >
                  <h3 className="text-lg font-bold text-amber-500 border-r-4 border-amber-500 pr-3">
                    {catGroup.category}
                  </h3>

                  <div className="space-y-4 pr-3">
                    {catGroup.subGroups.map((subGroup, sIdx) => (
                      <div
                        key={catGroup.category + '-' + subGroup.subCategory}
                        id={'book-sub-' + cIdx + '-' + sIdx}
                        className={
                          'p-4 rounded-xl border space-y-3 scroll-mt-4 ' +
                          (darkMode
                            ? 'bg-slate-800/40 border-slate-700/80'
                            : 'bg-amber-50/20 border-amber-200/70')
                        }
                      >
                        <h4 className="font-bold text-sm">
                          {catGroup.category} — {subGroup.subCategory} ({subGroup.recipes.length})
                        </h4>

                        <div className="space-y-3">
                          {subGroup.recipes.map((rec) => {
                            const factor =
                              rec.originalServings > 0
                                ? rec.targetServings / rec.originalServings
                                : 1;
                            const ings = rec.rawIngredients
                              .split('\\n')
                              .filter((l) => l.trim())
                              .map(
                                (l) =>
                                  parseAndScaleLine(
                                    l,
                                    factor,
                                    rec.dietMode,
                                    rec.convertToGrams,
                                    measureSystem
                                  ).displayText
                              );
                            const steps = rec.rawSteps
                              .split('\\n')
                              .map((s) => s.trim())
                              .filter(Boolean);

                            return (
                              <article
                                key={rec.id}
                                className={
                                  'p-4 rounded-xl border space-y-2 ' +
                                  (darkMode
                                    ? 'bg-slate-900 border-slate-800'
                                    : 'bg-white border-stone-200')
                                }
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <h5 className="font-bold text-base">
                                    {rec.favorite ? '⭐ ' : ''}
                                    {rec.title}
                                  </h5>
                                  <span className={mutedClass + ' text-xs'}>
                                    {rec.targetServings} מנות
                                  </span>
                                </div>

                                {ings.length > 0 && (
                                  <div>
                                    <div className="text-xs font-bold mb-1">מצרכים:</div>
                                    <ul className="list-disc list-inside text-xs space-y-1">
                                      {ings.map((line, i) => (
                                        <li key={i}>{line}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {steps.length > 0 && (
                                  <div className="pt-1">
                                    <div className="text-xs font-bold mb-1">אופן ההכנה:</div>
                                    <ol className="list-decimal list-inside text-xs space-y-1">
                                      {steps.map((st, i) => (
                                        <li key={i}>{st}</li>
                                      ))}
                                    </ol>
                                  </div>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
`;

const apiRouteCode = `import { NextRequest, NextResponse } from 'next/server';
import { extractRecipeFromText } from '@/lib/recipeEngine';

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTagsToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
    .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
    .replace(/<nav[\\s\\S]*?<\\/nav>/gi, ' ')
    .replace(/<footer[\\s\\S]*?<\\/footer>/gi, ' ');

  const withBreaks = withoutScripts.replace(
    /<\\/?(p|div|br|li|ul|ol|h1|h2|h3|h4|h5|h6|tr|section|article)[^>]*>/gi,
    '\\n'
  );

  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ' '));
}

function flattenUnknown(val: unknown): unknown[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.flatMap(flattenUnknown);
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) return flattenUnknown(obj['@graph']);
    return [obj];
  }
  return [];
}

function extractStepsFromSchema(rawInstructions: unknown): string[] {
  const steps: string[] = [];
  const walk = (item: unknown) => {
    if (!item) return;
    if (typeof item === 'string') {
      const cleaned = decodeHtmlEntities(item).replace(/\\s+/g, ' ').trim();
      if (cleaned) steps.push(cleaned);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }
    if (typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (typeof obj.text === 'string') walk(obj.text);
      if (Array.isArray(obj.itemListElement)) walk(obj.itemListElement);
      if (Array.isArray(obj.steps)) walk(obj.steps);
    }
  };
  walk(rawInstructions);
  return steps;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: string };
    const targetUrl = (body.url || '').trim();

    if (!targetUrl || !/^https?:\\/\\//i.test(targetUrl)) {
      return NextResponse.json(
        { error: 'יש להזין קישור תקין שמתחיל ב-http:// או https://' },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SmartRecipeScaler/1.0)',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    clearTimeout(timeoutId);

    if (response.status === 403) {
      return NextResponse.json(
        { error: 'אין הרשאה לאתר!' },
        { status: 403 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: 'לא ניתן היה לטעון את העמוד (קוד ' + response.status + ')' },
        { status: 502 }
      );
    }

    const html = await response.text();

    const jsonLdMatches = [...html.matchAll(/<script[^>]*type=["']application\\/ld\\+json["'][^>]*>([\\s\\S]*?)<\\/script>/gi)];
    for (const match of jsonLdMatches) {
      try {
        const parsed = JSON.parse(match[1].trim());
        const candidates = flattenUnknown(parsed);
        const recipeObj = candidates.find((c) => {
          if (!c || typeof c !== 'object') return false;
          const t = (c as Record<string, unknown>)['@type'];
          if (typeof t === 'string') return t.toLowerCase() === 'recipe';
          if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && x.toLowerCase() === 'recipe');
          return false;
        }) as Record<string, unknown> | undefined;

        if (recipeObj) {
          const rawIng = Array.isArray(recipeObj.recipeIngredient)
            ? recipeObj.recipeIngredient.map((x) => decodeHtmlEntities(String(x)).trim()).filter(Boolean)
            : [];
          const rawSteps = extractStepsFromSchema(recipeObj.recipeInstructions);

          if (rawIng.length > 0 || rawSteps.length > 0) {
            return NextResponse.json({
              ingredients: rawIng,
              steps: rawSteps,
              sourceMethod: 'json-ld',
            });
          }
        }
      } catch {
        // ממשיכים לבלוק ה-JSON-LD הבא או לחילוץ טקסט
      }
    }

    const plainText = stripTagsToText(html);
    const extracted = extractRecipeFromText(plainText);

    return NextResponse.json({
      ingredients: extracted.ingredients,
      steps: extracted.steps,
      sourceMethod: 'html-fallback',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה בחילוץ המתכון מהקישור';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
`;

const pageCode = `'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  parseAndScaleLine,
  extractTimersFromStep,
  extractRecipeFromText,
  formatSecondsClock,
  formatStepTemperatures,
  getAirFryerHint,
  DietMode,
  TempUnit,
  MeasureSystem,
} from '@/lib/recipeEngine';
import {
  SavedRecipeItem,
  loadSavedRecipes,
  persistSavedRecipes,
} from '@/lib/recipeBook';
import RecipeBookVault from '@/components/RecipeBookVault';

const SAMPLE_RECIPE = [
  '2 כוסות קמח לבן',
  '1 כוס סוכר',
  '1/2 כוס שמן',
  '2 ביצים',
  '1 כוס חלב',
  '1 כף אבקת אפייה',
  '1/2 כפית מלח',
].join('\\n');

const SAMPLE_STEPS = [
  'מחממים תנור ל-180 מעלות ומשמנים תבנית למשך 10 דקות.',
  'מערבבים בקערה את הביצים, הסוכר, השמן והחלב במשך 2 דקות עד לקבלת תערובת אחידה.',
  'מוסיפים את הקמח, אבקת האפייה והמלח ומערבבים רק עד לאיחוד.',
  'אופים כ-35 דקות עד שקיסם יוצא יבש ומניחים לצינון 15 דקות.',
].join('\\n');

const SAMPLE_LONG_TEXT = [
  'היי לכולם! היום אשתף אתכם בעוגה שכל המשפחה שלי מחכה לה בכל סוף שבוע. זה מתכון קליל שמתאים גם למי שאופה לעיתים רחוקות.',
  'מצרכים:',
  '- 2 כוסות קמח לבן',
  '- 3/4 כוס סוכר',
  '- 1/2 כוס שמן',
  '- 2 ביצים',
  '- 1 כוס חלב',
  '- 1 כף אבקת אפייה',
  'אופן ההכנה:',
  '1. מחממים תנור ל-180 מעלות ומשמנים תבנית.',
  '2. טורפים בקערה את הביצים עם הסוכר, מוסיפים שמן וחלב ומערבבים 2 דקות.',
  '3. מקפלים פנימה את הקמח ואבקת האפייה עד לקבלת בלילה חלקה.',
  '4. אופים 30 דקות עד שהעוגה זהובה ויציבה.',
].join('\\n');

interface ActiveTimerState {
  id: string;
  label: string;
  sourceLabel: string;
  remaining: number;
  total: number;
  running: boolean;
  finished: boolean;
  muted: boolean;
  reminderSeconds: number | null;
  reminderTriggered: boolean;
}

function showBrowserNotification(title: string, body: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
    } catch {
      // חסימת התראת מערכת על ידי הדפדפן
    }
  }
}

function playAlarmBeep(kind: 'finish' | 'reminder' = 'finish'): number {
  if (typeof window === 'undefined') return 1000;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  if (kind === 'reminder') {
    const notes = [880, 1174.66, 880, 1318.5];
    const stepDelay = 0.22;
    const duration = 0.2;
    if (AudioCtx) {
      try {
        const ctx = new AudioCtx();
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.22, ctx.currentTime + i * stepDelay);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * stepDelay + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + i * stepDelay);
          osc.stop(ctx.currentTime + i * stepDelay + duration + 0.01);
        });
      } catch {
        // חסימת אודיו מצד הדפדפן
      }
    }
    return Math.round((notes.length - 1) * stepDelay * 1000 + duration * 1000);
  }

  const pattern = [
    { freq: 1046.5, start: 0, dur: 0.28 },
    { freq: 1318.5, start: 0.32, dur: 0.28 },
    { freq: 1046.5, start: 0.66, dur: 0.28 },
    { freq: 1567.98, start: 1.0, dur: 0.55 },
  ];

  if (AudioCtx) {
    try {
      const ctx = new AudioCtx();
      pattern.forEach((p) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = p.freq;
        gain.gain.setValueAtTime(0.28, ctx.currentTime + p.start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + p.start + p.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + p.start);
        osc.stop(ctx.currentTime + p.start + p.dur + 0.02);
      });
    } catch {
      // חסימת אודיו מצד הדפדפן
    }
  }

  return 1600;
}

export default function SmartRecipeScalerPage() {
  const [activeTab, setActiveTab] = useState<'scaler' | 'book'>('scaler');
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipeItem[]>(() => loadSavedRecipes());

  const [rawIngredients, setRawIngredients] = useState<string>(SAMPLE_RECIPE);
  const [rawSteps, setRawSteps] = useState<string>(SAMPLE_STEPS);
  const [originalServings, setOriginalServings] = useState<number>(4);
  const [targetServings, setTargetServings] = useState<number>(6);
  const [dietMode, setDietMode] = useState<DietMode>('none');
  const [convertToGrams, setConvertToGrams] = useState<boolean>(false);
  const [measureSystem, setMeasureSystem] = useState<MeasureSystem>('metric');
  const [tempUnit, setTempUnit] = useState<TempUnit>('C');
  const [showAirFryerHints, setShowAirFryerHints] = useState<boolean>(true);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [cookingMode, setCookingMode] = useState<boolean>(false);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<boolean>(false);
  const [timers, setTimers] = useState<Record<string, ActiveTimerState>>({});
  const finishedSoundPlayedRef = useRef<Record<string, boolean>>({});
  const reminderSoundPlayedRef = useRef<Record<string, boolean>>({});
  const finishSoundDurationRef = useRef<number>(1600);

  const [stepReminderEnabled, setStepReminderEnabled] = useState<boolean>(true);
  const [stepReminderMinutes, setStepReminderMinutes] = useState<number>(2);

  const [customTitle, setCustomTitle] = useState<string>('');
  const [customHours, setCustomHours] = useState<number>(0);
  const [customMinutes, setCustomMinutes] = useState<number>(10);
  const [customSeconds, setCustomSeconds] = useState<number>(0);
  const [reminderEnabled, setReminderEnabled] = useState<boolean>(true);
  const [reminderMinutesInput, setReminderMinutesInput] = useState<number>(5);
  const [customTimerError, setCustomTimerError] = useState<string | null>(null);

  const [importerOpen, setImporterOpen] = useState<boolean>(true);
  const [urlInput, setUrlInput] = useState<string>('');
  const [longTextInput, setLongTextInput] = useState<string>(SAMPLE_LONG_TEXT);
  const [importing, setImporting] = useState<boolean>(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'ממיר מתכונים חכם';
  }, []);

  useEffect(() => {
    persistSavedRecipes(savedRecipes);
  }, [savedRecipes]);

  const handleSaveCurrentRecipe = (meta: {
    title: string;
    category: string;
    subCategory: string;
    favorite: boolean;
  }) => {
    const newItem: SavedRecipeItem = {
      id: 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      title: meta.title,
      category: meta.category,
      subCategory: meta.subCategory,
      favorite: meta.favorite,
      rawIngredients,
      rawSteps,
      originalServings,
      targetServings,
      dietMode,
      convertToGrams,
      createdAt: new Date().toISOString(),
    };
    setSavedRecipes((prev) => [newItem, ...prev]);
  };

  const handleUpdateRecipe = (updated: SavedRecipeItem) => {
    setSavedRecipes((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const handleLoadRecipeToScaler = (item: SavedRecipeItem) => {
    setRawIngredients(item.rawIngredients);
    setRawSteps(item.rawSteps);
    setOriginalServings(item.originalServings);
    setTargetServings(item.targetServings);
    setDietMode(item.dietMode);
    setConvertToGrams(item.convertToGrams);
    setCheckedItems({});
    setActiveTab('scaler');
  };

  const handleToggleFavorite = (id: string) => {
    setSavedRecipes((prev) =>
      prev.map((r) => (r.id === id ? { ...r, favorite: !r.favorite } : r))
    );
  };

  const handleDeleteRecipe = (id: string) => {
    setSavedRecipes((prev) => prev.filter((r) => r.id !== id));
  };

  const handleUpdateRecipeCategory = (id: string, category: string, subCategory: string) => {
    setSavedRecipes((prev) =>
      prev.map((r) => (r.id === id ? { ...r, category, subCategory } : r))
    );
  };

  const ensureNotificationPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        // המשתמש לא אישר או שהדפדפן חסם
      }
    }
  };

  useEffect(() => {
    let wakeLock: { release: () => Promise<void> } | null = null;

    const requestWakeLock = async () => {
      if (cookingMode && typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        try {
          const nav = navigator as Navigator & {
            wakeLock: { request: (type: string) => Promise<{ release: () => Promise<void> }> };
          };
          wakeLock = await nav.wakeLock.request('screen');
        } catch {
          // הדפדפן חסם או שהסוללה חלשה
        }
      }
    };

    requestWakeLock();

    return () => {
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, [cookingMode]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimers((prev) => {
        let changed = false;
        const next: Record<string, ActiveTimerState> = {};

        for (const [id, t] of Object.entries(prev)) {
          if (t.running && t.remaining > 0) {
            changed = true;
            const nextRem = t.remaining - 1;

            let reminderTriggered = t.reminderTriggered;
            if (
              t.reminderSeconds !== null &&
              t.reminderSeconds > 0 &&
              !reminderTriggered &&
              nextRem > 0 &&
              nextRem <= t.reminderSeconds
            ) {
              reminderTriggered = true;
              if (!reminderSoundPlayedRef.current[id]) {
                reminderSoundPlayedRef.current[id] = true;
                playAlarmBeep('reminder');
                const minsLeft = Math.round(t.reminderSeconds / 60);
                showBrowserNotification(
                  'תזכורת מוקדמת: ' + t.sourceLabel,
                  'נשארו כ-' + minsLeft + ' דקות לטיימר (' + t.label + ')'
                );
              }
            }

            if (nextRem === 0) {
              if (!finishedSoundPlayedRef.current[id]) {
                finishedSoundPlayedRef.current[id] = true;
                finishSoundDurationRef.current = playAlarmBeep('finish');
                showBrowserNotification(
                  'הזמן נגמר: ' + t.sourceLabel,
                  'הטיימר (' + t.label + ') הסתיים!'
                );
              }
              next[id] = {
                ...t,
                remaining: 0,
                running: false,
                finished: true,
                reminderTriggered,
              };
            } else {
              next[id] = {
                ...t,
                remaining: nextRem,
                reminderTriggered,
              };
            }
          } else {
            next[id] = t;
          }
        }

        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const hasAudibleFinishedTimers = useMemo(
    () => Object.values(timers).some((t) => t.finished && !t.muted),
    [timers]
  );

  useEffect(() => {
    if (!hasAudibleFinishedTimers) return;

    let cancelled = false;
    let nextTimeout: ReturnType<typeof setTimeout> | null = null;

    const scheduleNextRing = () => {
      if (cancelled) return;
      const waitBeforeNextRingMs = finishSoundDurationRef.current + 1000;
      nextTimeout = setTimeout(() => {
        if (cancelled) return;
        finishSoundDurationRef.current = playAlarmBeep('finish');
        scheduleNextRing();
      }, waitBeforeNextRingMs);
    };

    scheduleNextRing();

    return () => {
      cancelled = true;
      if (nextTimeout) clearTimeout(nextTimeout);
    };
  }, [hasAudibleFinishedTimers]);

  const customTotalSeconds = useMemo(() => {
    const h = Math.max(0, Math.floor(customHours || 0));
    const m = Math.max(0, Math.floor(customMinutes || 0));
    const s = Math.max(0, Math.floor(customSeconds || 0));
    return h * 3600 + m * 60 + s;
  }, [customHours, customMinutes, customSeconds]);

  const maxAllowedReminderMinutes = useMemo(() => {
    if (customTotalSeconds <= 60) return 0;
    const strictlyLessThanTotal = Math.floor((customTotalSeconds - 1) / 60);
    return Math.min(60, Math.max(0, strictlyLessThanTotal));
  }, [customTotalSeconds]);

  useEffect(() => {
    if (maxAllowedReminderMinutes === 0) {
      setReminderMinutesInput(0);
    } else if (reminderMinutesInput > maxAllowedReminderMinutes) {
      setReminderMinutesInput(maxAllowedReminderMinutes);
    }
  }, [maxAllowedReminderMinutes, reminderMinutesInput]);

  const handleStartCustomTimer = async () => {
    setCustomTimerError(null);

    if (customTotalSeconds <= 0) {
      setCustomTimerError('יש להגדיר לפחות שנייה אחת לטיימר.');
      return;
    }

    let validReminderSec: number | null = null;
    if (reminderEnabled && reminderMinutesInput > 0) {
      if (reminderMinutesInput > 60) {
        setCustomTimerError('אי אפשר להגדיר תזכורת יותר מ-60 דקות לפני הסיום.');
        return;
      }
      const remSec = Math.floor(reminderMinutesInput) * 60;
      if (remSec >= customTotalSeconds) {
        setCustomTimerError('זמן התזכורת חייב להיות קצר מזמן הטיימר הכולל.');
        return;
      }
      validReminderSec = remSec;
    }

    await ensureNotificationPermission();

    const id = 'custom-timer-' + Date.now();
    const labelParts: string[] = [];
    if (customHours > 0) labelParts.push(customHours + " שע'");
    if (customMinutes > 0) labelParts.push(customMinutes + " דק'");
    if (customSeconds > 0) labelParts.push(customSeconds + " שנ'");

    const titleText = customTitle.trim() ? customTitle.trim() : 'טיימר מותאם אישית';

    setTimers((prev) => ({
      ...prev,
      [id]: {
        id,
        label: labelParts.join(' '),
        sourceLabel: titleText,
        remaining: customTotalSeconds,
        total: customTotalSeconds,
        running: true,
        finished: false,
        muted: false,
        reminderSeconds: validReminderSec,
        reminderTriggered: false,
      },
    }));
  };

  const getStepReminderSeconds = (totalSeconds: number): number | null => {
    if (!stepReminderEnabled || stepReminderMinutes <= 0) return null;
    const maxMin = Math.min(60, Math.max(0, Math.floor((totalSeconds - 1) / 60)));
    if (maxMin <= 0) return null;
    const chosenMin = Math.min(stepReminderMinutes, maxMin);
    return chosenMin * 60;
  };

  const scaleFactor = useMemo(() => {
    if (originalServings <= 0 || targetServings <= 0) return 1;
    return targetServings / originalServings;
  }, [originalServings, targetServings]);

  const parsedIngredients = useMemo(() => {
    return rawIngredients
      .split('\\n')
      .filter((line) => line.trim() !== '')
      .map((line) =>
        parseAndScaleLine(line, scaleFactor, dietMode, convertToGrams, measureSystem)
      );
  }, [rawIngredients, scaleFactor, dietMode, convertToGrams, measureSystem]);

  const stepsWithTimers = useMemo(() => {
    return rawSteps
      .split('\\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text, idx) => {
        const detectedTimers = extractTimersFromStep(text, idx);
        return {
          rawText: text,
          displayText: formatStepTemperatures(text, tempUnit),
          stepNumber: idx + 1,
          detectedTimers,
          airFryerHint: getAirFryerHint(text, detectedTimers),
        };
      });
  }, [rawSteps, tempUnit]);

  const applyExtractedData = (ingredients: string[], steps: string[], label: string) => {
    if (ingredients.length > 0) {
      setRawIngredients(ingredients.join('\\n'));
    }
    if (steps.length > 0) {
      setRawSteps(steps.join('\\n'));
    }
    setCheckedItems({});
    setImportStatus(
      label + ' — חולצו ' + ingredients.length + ' מצרכים ו-' + steps.length + ' שלבי הכנה.'
    );
  };

  const handleExtractFromLongText = () => {
    const res = extractRecipeFromText(longTextInput);
    applyExtractedData(res.ingredients, res.steps, 'חילוץ מטקסט');
  };

  const handleExtractFromUrl = async () => {
    if (!urlInput.trim()) return;
    setImporting(true);
    setImportStatus(null);

    try {
      const resp = await fetch('/api/extract-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setImportStatus('שגיאה: ' + (data.error || 'לא הצלחנו לחלץ את המתכון'));
      } else {
        const methodText =
          data.sourceMethod === 'json-ld'
            ? 'חילוץ מובנה (Schema Recipe)'
            : 'חילוץ דטרמיניסטי מ-HTML';
        applyExtractedData(data.ingredients || [], data.steps || [], methodText);
      }
    } catch {
      setImportStatus('שגיאה בחיבור לשרת המקומי.');
    } finally {
      setImporting(false);
    }
  };

  const startOrToggleTimer = async (
    id: string,
    totalSeconds: number,
    label: string,
    sourceLabel: string,
    reminderSeconds: number | null = null
  ) => {
    await ensureNotificationPermission();
    delete finishedSoundPlayedRef.current[id];
    delete reminderSoundPlayedRef.current[id];

    setTimers((prev) => {
      const existing = prev[id];
      if (!existing) {
        return {
          ...prev,
          [id]: {
            id,
            label,
            sourceLabel,
            remaining: totalSeconds,
            total: totalSeconds,
            running: true,
            finished: false,
            muted: false,
            reminderSeconds,
            reminderTriggered: false,
          },
        };
      }
      if (existing.finished || existing.remaining === 0) {
        return {
          ...prev,
          [id]: {
            ...existing,
            remaining: totalSeconds,
            total: totalSeconds,
            running: true,
            finished: false,
            muted: false,
            reminderSeconds: reminderSeconds ?? existing.reminderSeconds,
            reminderTriggered: false,
          },
        };
      }
      return {
        ...prev,
        [id]: {
          ...existing,
          running: !existing.running,
        },
      };
    });
  };

  const addOneMinuteToTimer = (id: string) => {
    delete finishedSoundPlayedRef.current[id];
    setTimers((prev) => {
      const existing = prev[id];
      if (!existing) return prev;
      const nextRemaining = existing.remaining + 60;
      const nextTotal = Math.max(existing.total, nextRemaining);
      return {
        ...prev,
        [id]: {
          ...existing,
          remaining: nextRemaining,
          total: nextTotal,
          running: true,
          finished: false,
          muted: false,
        },
      };
    });
  };

  const muteFinishedTimer = (id: string) => {
    setTimers((prev) => {
      const existing = prev[id];
      if (!existing) return prev;
      return {
        ...prev,
        [id]: {
          ...existing,
          muted: true,
        },
      };
    });
  };

  const resetTimer = (id: string) => {
    delete finishedSoundPlayedRef.current[id];
    delete reminderSoundPlayedRef.current[id];
    setTimers((prev) => {
      const existing = prev[id];
      if (!existing) return prev;
      return {
        ...prev,
        [id]: {
          ...existing,
          remaining: existing.total,
          running: false,
          finished: false,
          muted: false,
          reminderTriggered: false,
        },
      };
    });
  };

  const removeTimer = (id: string) => {
    delete finishedSoundPlayedRef.current[id];
    delete reminderSoundPlayedRef.current[id];
    setTimers((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const toggleCheck = (key: string) => {
    setCheckedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const buildShareMessage = () => {
    const ingLines = parsedIngredients.map((item) => '• ' + item.displayText).join('\\n');
    const stepLines = stepsWithTimers.map((s) => s.stepNumber + '. ' + s.displayText).join('\\n');
    return (
      '🍽️ *מתכון מותאם (' +
      targetServings +
      ' מנות)*\\n\\n' +
      '*מצרכים:*\\n' +
      ingLines +
      (stepLines ? '\\n\\n*שלבי הכנה:*\\n' + stepLines : '')
    );
  };

  const handleCopyRecipe = () => {
    const text = parsedIngredients.map((item) => '• ' + item.displayText).join('\\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareWhatsApp = () => {
    const message = buildShareMessage();
    const url = 'https://wa.me/?text=' + encodeURIComponent(message);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const activeTimerList = Object.values(timers);

  const surfaceClass = darkMode
    ? 'bg-slate-900 text-slate-100 border-slate-800'
    : 'bg-white text-stone-900 border-stone-200';
  const mutedTextClass = darkMode ? 'text-slate-400' : 'text-stone-500';
  const inputClass = darkMode
    ? 'bg-slate-800 text-slate-100 border-slate-700 focus:border-amber-400'
    : 'bg-white text-stone-900 border-stone-300 focus:border-amber-500';

  return (
    <main
      dir="rtl"
      className={
        'min-h-screen p-4 md:p-8 font-sans transition-colors ' +
        (darkMode ? 'bg-slate-950 text-slate-100' : 'bg-stone-50 text-stone-900')
      }
    >
      <div className="max-w-5xl mx-auto space-y-6">
        <header
          className={
            'flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl shadow-sm border ' +
            surfaceClass
          }
        >
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">ממיר מתכונים חכם</h1>
            <p className={mutedTextClass + ' text-sm mt-1'}>
              חילוץ מקישור או בלוג, התאמת מנות, המרה לגרמים, טיימרים וספר מתכונים — ללא AI
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'scaler' ? 'book' : 'scaler')}
              className="px-4 py-2.5 rounded-xl font-bold text-sm bg-amber-500 hover:bg-amber-400 text-stone-950 transition-all cursor-pointer"
            >
              {activeTab === 'scaler'
                ? 'ספר מתכונים ושמורים (' + savedRecipes.length + ')'
                : 'חזרה לממיר ולטיימרים'}
            </button>

            <button
              type="button"
              onClick={() => setDarkMode(!darkMode)}
              className={
                'px-4 py-2.5 rounded-xl font-medium text-sm transition-all cursor-pointer border ' +
                (darkMode
                  ? 'bg-slate-800 text-amber-300 border-slate-700 hover:bg-slate-700'
                  : 'bg-stone-100 text-stone-700 border-stone-200 hover:bg-stone-200')
              }
            >
              {darkMode ? 'מצב בהיר' : 'מצב כהה'}
            </button>

            {activeTab === 'scaler' && (
              <button
                type="button"
                onClick={() => setCookingMode(!cookingMode)}
                className={
                  'px-5 py-2.5 rounded-xl font-medium text-sm transition-all cursor-pointer ' +
                  (cookingMode
                    ? 'bg-emerald-600 text-white shadow-md'
                    : darkMode
                    ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200')
                }
              >
                {cookingMode ? 'מצב בישול פעיל (מסך דלוק)' : 'הפעל מצב בישול'}
              </button>
            )}
          </div>
        </header>

        {/* סרגל טיימרים פעילים */}
        {activeTimerList.length > 0 && (
          <section className="bg-stone-900 text-white p-5 rounded-2xl shadow-md space-y-3 border border-stone-800">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sm tracking-wide text-amber-400">
                טיימרים פעילים במטבח ({activeTimerList.length})
              </h2>
              <button
                type="button"
                onClick={() => setTimers({})}
                className="text-xs text-stone-400 hover:text-white cursor-pointer"
              >
                נקה הכל
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeTimerList.map((t) => (
                <div
                  key={t.id}
                  className={
                    'p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 ' +
                    (t.finished
                      ? 'bg-red-950/90 border-red-500 ' + (!t.muted ? 'animate-pulse' : '')
                      : t.reminderTriggered
                      ? 'bg-amber-950/70 border-amber-400'
                      : 'bg-stone-800 border-stone-700')
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-stone-300 font-medium">
                        {t.sourceLabel} • {t.label}
                      </div>
                      {t.reminderSeconds !== null && t.reminderSeconds > 0 && (
                        <div
                          className={
                            'text-[11px] mt-0.5 ' +
                            (t.reminderTriggered ? 'text-amber-300 font-bold' : 'text-stone-400')
                          }
                        >
                          {t.reminderTriggered
                            ? 'התראת ' + Math.round(t.reminderSeconds / 60) + ' דק׳ לפני הופעלה!'
                            : 'תזכורת ' + Math.round(t.reminderSeconds / 60) + ' דק׳ לפני הסיום'}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeTimer(t.id)}
                      className="text-xs text-stone-400 hover:text-red-400 px-1 cursor-pointer"
                      title="הסר טיימר"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-2xl font-mono font-bold">
                      {t.finished ? 'הזמן נגמר!' : formatSecondsClock(t.remaining)}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => addOneMinuteToTimer(t.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-stone-700 hover:bg-stone-600 text-white font-mono font-bold text-xs cursor-pointer"
                        title="הוסף דקה"
                      >
                        +1:00
                      </button>

                      {t.finished ? (
                        <>
                          {!t.muted && (
                            <button
                              type="button"
                              onClick={() => muteFinishedTimer(t.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-stone-700 hover:bg-stone-600 text-amber-300 font-semibold text-xs cursor-pointer"
                            >
                              השתק צפצוף
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeTimer(t.id)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-bold text-xs cursor-pointer"
                          >
                            אוקיי - סגור
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              startOrToggleTimer(
                                t.id,
                                t.total,
                                t.label,
                                t.sourceLabel,
                                t.reminderSeconds
                              )
                            }
                            className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs cursor-pointer"
                          >
                            הפעל שוב
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              startOrToggleTimer(
                                t.id,
                                t.total,
                                t.label,
                                t.sourceLabel,
                                t.reminderSeconds
                              )
                            }
                            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs cursor-pointer"
                          >
                            {t.running ? 'השהה' : 'המשך'}
                          </button>
                          <button
                            type="button"
                            onClick={() => resetTimer(t.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-stone-700 hover:bg-stone-600 text-white text-xs cursor-pointer"
                          >
                            איפוס
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'book' ? (
          <RecipeBookVault
            savedRecipes={savedRecipes}
            onSaveCurrentRecipe={handleSaveCurrentRecipe}
            onUpdateRecipe={handleUpdateRecipe}
            onLoadRecipeToScaler={handleLoadRecipeToScaler}
            onToggleFavorite={handleToggleFavorite}
            onDeleteRecipe={handleDeleteRecipe}
            onUpdateRecipeCategory={handleUpdateRecipeCategory}
            measureSystem={measureSystem}
            darkMode={darkMode}
          />
        ) : (
          <>
            <section className={'p-6 rounded-2xl shadow-sm border space-y-4 ' + surfaceClass}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="font-bold text-lg">טיימר מותאם אישית ותזכורת מוקדמת</h2>
                  <p className={mutedTextClass + ' text-xs'}>
                    הגדירו שעות, דקות ושניות + התראה מקדימה בדקות (עד 60 דקות ולא מעבר לזמן הטיימר)
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-3">
                  <label className={mutedTextClass + ' block text-xs font-semibold mb-1'}>
                    שם הטיימר (אופציונלי)
                  </label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="למשל: עוגה בתנור / פסטה"
                    className={'w-full px-3 py-2 border rounded-xl text-sm focus:outline-none ' + inputClass}
                  />
                </div>

                <div className="md:col-span-4 grid grid-cols-3 gap-2">
                  <div>
                    <label className={mutedTextClass + ' block text-xs font-semibold text-center mb-1'}>
                      שעות
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      value={customHours}
                      onChange={(e) =>
                        setCustomHours(Math.max(0, Math.min(24, Number(e.target.value))))
                      }
                      className={'w-full px-2 py-2 border rounded-xl text-center font-mono font-bold ' + inputClass}
                    />
                  </div>
                  <div>
                    <label className={mutedTextClass + ' block text-xs font-semibold text-center mb-1'}>
                      דקות
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={customMinutes}
                      onChange={(e) =>
                        setCustomMinutes(Math.max(0, Math.min(59, Number(e.target.value))))
                      }
                      className={'w-full px-2 py-2 border rounded-xl text-center font-mono font-bold ' + inputClass}
                    />
                  </div>
                  <div>
                    <label className={mutedTextClass + ' block text-xs font-semibold text-center mb-1'}>
                      שניות
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={customSeconds}
                      onChange={(e) =>
                        setCustomSeconds(Math.max(0, Math.min(59, Number(e.target.value))))
                      }
                      className={'w-full px-2 py-2 border rounded-xl text-center font-mono font-bold ' + inputClass}
                    />
                  </div>
                </div>

                <div className="md:col-span-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reminderEnabled && maxAllowedReminderMinutes > 0}
                        disabled={maxAllowedReminderMinutes === 0}
                        onChange={(e) => {
                          setReminderEnabled(e.target.checked);
                          if (e.target.checked && reminderMinutesInput === 0) {
                            setReminderMinutesInput(Math.min(5, maxAllowedReminderMinutes));
                          }
                        }}
                        className="rounded accent-amber-500"
                      />
                      <span>תזכורת לפני (דקות):</span>
                    </label>
                    <span className={mutedTextClass + ' text-[11px]'}>
                      מקס׳ {maxAllowedReminderMinutes} דק׳
                    </span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={maxAllowedReminderMinutes}
                    disabled={!reminderEnabled || maxAllowedReminderMinutes === 0}
                    value={maxAllowedReminderMinutes === 0 ? 0 : reminderMinutesInput}
                    onChange={(e) => {
                      const val = Math.floor(Number(e.target.value));
                      const clamped = Math.max(
                        0,
                        Math.min(maxAllowedReminderMinutes, isNaN(val) ? 0 : val)
                      );
                      setReminderMinutesInput(clamped);
                    }}
                    className={
                      'w-full px-3 py-2 border disabled:opacity-50 rounded-xl text-center font-mono font-semibold ' +
                      inputClass
                    }
                  />
                </div>

                <div className="md:col-span-2">
                  <button
                    type="button"
                    onClick={handleStartCustomTimer}
                    className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm shadow-sm transition-all cursor-pointer"
                  >
                    הפעל טיימר
                  </button>
                </div>
              </div>

              {customTimerError && (
                <div className="text-xs font-medium text-red-500">{customTimerError}</div>
              )}
            </section>

            {!cookingMode && (
              <section className={'p-6 rounded-2xl shadow-sm border space-y-4 ' + surfaceClass}>
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-lg">חילוץ מתכון מקישור (URL) או טקסט בלוג ללא AI</h2>
                  <button
                    type="button"
                    onClick={() => setImporterOpen(!importerOpen)}
                    className="text-xs font-medium text-amber-500 hover:underline cursor-pointer"
                  >
                    {importerOpen ? 'הסתר חילוץ' : 'הצג חילוץ'}
                  </button>
                </div>

                {importerOpen && (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="url"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="הדבק קישור לעמוד מתכון (https://...)"
                        className={'flex-1 px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none ' + inputClass}
                      />
                      <button
                        type="button"
                        disabled={importing}
                        onClick={handleExtractFromUrl}
                        className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 text-sm font-bold cursor-pointer"
                      >
                        {importing ? 'מחלץ קישור...' : 'חלץ מקישור'}
                      </button>
                    </div>

                    <div className="space-y-2">
                      <label className={mutedTextClass + ' block text-xs font-semibold'}>
                        או הדבק טקסט ארוך / בלוג — המערכת תסנן סיפורים ותפריד מצרכים ושלבים לבד:
                      </label>
                      <textarea
                        rows={4}
                        value={longTextInput}
                        onChange={(e) => setLongTextInput(e.target.value)}
                        className={'w-full p-3 border rounded-xl text-sm focus:outline-none ' + inputClass}
                      />
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={handleExtractFromLongText}
                          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-sm font-bold cursor-pointer"
                        >
                          חלץ מצרכים ושלבים מהטקסט
                        </button>
                        {importStatus && (
                          <span className="text-xs font-medium text-emerald-500">{importStatus}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            <section
              className={
                'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-6 rounded-2xl shadow-sm border ' +
                surfaceClass
              }
            >
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className={mutedTextClass + ' text-xs font-semibold uppercase'}>
                    התאמת מנות (פי {scaleFactor.toFixed(2).replace(/\\.00$/, '')})
                  </label>
                  <div className="flex gap-1">
                    {[0.5, 1, 2, 3].map((mult) => (
                      <button
                        key={mult}
                        type="button"
                        onClick={() =>
                          setTargetServings(Math.max(1, Math.round(originalServings * mult)))
                        }
                        className={
                          'text-[11px] px-1.5 py-0.5 rounded cursor-pointer ' +
                          (darkMode
                            ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                            : 'bg-stone-100 hover:bg-stone-200 text-stone-600')
                        }
                      >
                        ×{mult}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <span className={mutedTextClass + ' text-xs'}>במקור:</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={originalServings}
                      onChange={(e) => setOriginalServings(Math.max(1, Number(e.target.value)))}
                      className={'w-full mt-1 px-2 py-2 border rounded-lg text-center font-semibold ' + inputClass}
                    />
                  </div>
                  <span className={mutedTextClass + ' font-bold pt-5'}>←</span>
                  <div className="flex-1">
                    <span className={mutedTextClass + ' text-xs'}>רצוי:</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={targetServings}
                      onChange={(e) => setTargetServings(Math.max(1, Number(e.target.value)))}
                      className="w-full mt-1 px-2 py-2 border-2 border-amber-500 bg-amber-500/10 rounded-lg text-center font-bold text-amber-500"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className={mutedTextClass + ' block text-xs font-semibold uppercase'}>
                  החלפת רכיבים אוטומטית
                </label>
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  {[
                    { id: 'none', label: 'רגיל' },
                    { id: 'vegan', label: 'טבעוני' },
                    { id: 'gluten-free', label: 'ללא גלוטן' },
                    { id: 'dairy-free', label: 'ללא לקטוז' },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setDietMode(option.id as DietMode)}
                      className={
                        'py-2 px-2.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ' +
                        (dietMode === option.id
                          ? 'bg-amber-500 text-stone-950 border-amber-500 font-bold'
                          : darkMode
                          ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                          : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50')
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className={mutedTextClass + ' block text-xs font-semibold uppercase'}>
                  שיטת מדידה וגרמים
                </label>
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setMeasureSystem('metric')}
                      className={
                        'py-1.5 px-2 rounded-lg text-xs font-bold border cursor-pointer ' +
                        (measureSystem === 'metric'
                          ? 'bg-amber-500 text-stone-950 border-amber-500'
                          : darkMode
                          ? 'bg-slate-800 text-slate-300 border-slate-700'
                          : 'bg-stone-50 text-stone-700 border-stone-200')
                      }
                    >
                      מטרי
                    </button>
                    <button
                      type="button"
                      onClick={() => setMeasureSystem('us')}
                      className={
                        'py-1.5 px-2 rounded-lg text-xs font-bold border cursor-pointer ' +
                        (measureSystem === 'us'
                          ? 'bg-amber-500 text-stone-950 border-amber-500'
                          : darkMode
                          ? 'bg-slate-800 text-slate-300 border-slate-700'
                          : 'bg-stone-50 text-stone-700 border-stone-200')
                      }
                    >
                      US (oz/cup)
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConvertToGrams(!convertToGrams)}
                    className={
                      'w-full py-1.5 px-2.5 rounded-lg text-xs font-medium border flex items-center justify-between cursor-pointer ' +
                      (convertToGrams
                        ? 'bg-amber-500 text-stone-950 border-amber-500 font-bold'
                        : darkMode
                        ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100')
                    }
                  >
                    <span>המר לגרמים</span>
                    <span className="text-[11px] font-bold">{convertToGrams ? 'פעיל' : 'כבוי'}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className={mutedTextClass + ' block text-xs font-semibold uppercase'}>
                  טמפרטורה ואייר-פריי
                </label>
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTempUnit('C')}
                      className={
                        'py-1.5 px-2 rounded-lg text-xs font-bold border cursor-pointer ' +
                        (tempUnit === 'C'
                          ? 'bg-amber-500 text-stone-950 border-amber-500'
                          : darkMode
                          ? 'bg-slate-800 text-slate-300 border-slate-700'
                          : 'bg-stone-50 text-stone-700 border-stone-200')
                      }
                    >
                      צלזיוס (°C)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTempUnit('F')}
                      className={
                        'py-1.5 px-2 rounded-lg text-xs font-bold border cursor-pointer ' +
                        (tempUnit === 'F'
                          ? 'bg-amber-500 text-stone-950 border-amber-500'
                          : darkMode
                          ? 'bg-slate-800 text-slate-300 border-slate-700'
                          : 'bg-stone-50 text-stone-700 border-stone-200')
                      }
                    >
                      פרנהייט (°F)
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAirFryerHints(!showAirFryerHints)}
                    className={
                      'w-full py-1.5 px-2.5 rounded-lg text-xs font-medium border cursor-pointer ' +
                      (showAirFryerHints
                        ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40'
                        : darkMode
                        ? 'bg-slate-800 text-slate-400 border-slate-700'
                        : 'bg-stone-50 text-stone-600 border-stone-200')
                    }
                  >
                    {showAirFryerHints ? 'הצעות אייר-פריי: מוצגות' : 'הצעות אייר-פריי: מוסתרות'}
                  </button>
                </div>
              </div>
            </section>

            <div className={'grid grid-cols-1 gap-6 ' + (cookingMode ? '' : 'lg:grid-cols-2')}>
              {!cookingMode && (
                <section className={'space-y-4 p-6 rounded-2xl shadow-sm border ' + surfaceClass}>
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <h2 className="font-bold text-lg">1. מצרכים (עריכה ידנית או מחולצים)</h2>
                      <button
                        type="button"
                        onClick={() => {
                          setRawIngredients('');
                          setRawSteps('');
                          setCheckedItems({});
                        }}
                        className={mutedTextClass + ' text-xs hover:text-red-500 cursor-pointer'}
                      >
                        נקה הכל
                      </button>
                    </div>
                    <textarea
                      rows={8}
                      value={rawIngredients}
                      onChange={(e) => setRawIngredients(e.target.value)}
                      placeholder="לדוגמה:&#10;2 כוסות קמח&#10;1/2 כוס סוכר&#10;3 ביצים"
                      className={'w-full p-3 border rounded-xl text-sm focus:outline-none ' + inputClass}
                    />
                  </div>

                  <div>
                    <h2 className="font-bold text-lg mb-2">2. שלבי הכנה</h2>
                    <textarea
                      rows={5}
                      value={rawSteps}
                      onChange={(e) => setRawSteps(e.target.value)}
                      placeholder="לדוגמה: אופים 35 דקות ב-180 מעלות..."
                      className={'w-full p-3 border rounded-xl text-sm focus:outline-none ' + inputClass}
                    />
                  </div>
                </section>
              )}

              <section className={'space-y-6 p-6 rounded-2xl shadow-sm border ' + surfaceClass}>
                <div>
                  <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                    <h2 className="font-bold text-lg">
                      מצרכים מותאמים ({targetServings} מנות)
                    </h2>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleShareWhatsApp}
                        className="px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg cursor-pointer"
                      >
                        שתף ב-WhatsApp
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyRecipe}
                        className={
                          'px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer ' +
                          (darkMode
                            ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                            : 'bg-stone-100 hover:bg-stone-200 text-stone-700')
                        }
                      >
                        {copied ? 'הועתק!' : 'העתק רשימה'}
                      </button>
                    </div>
                  </div>

                  <ul className="space-y-2.5">
                    {parsedIngredients.map((item, idx) => {
                      const key = 'ing-' + idx;
                      const isChecked = !!checkedItems[key];
                      return (
                        <li
                          key={key}
                          onClick={() => toggleCheck(key)}
                          className={
                            'p-3 rounded-xl border transition-all cursor-pointer select-none ' +
                            (isChecked
                              ? darkMode
                                ? 'bg-slate-950/60 border-slate-800 text-slate-500 line-through'
                                : 'bg-stone-50 border-stone-200 text-stone-400 line-through'
                              : darkMode
                              ? 'bg-amber-500/10 border-amber-500/25 hover:bg-amber-500/15'
                              : 'bg-amber-50/30 border-amber-200/70 hover:bg-amber-50')
                          }
                        >
                          <div className="font-medium text-base">{item.displayText}</div>
                          {item.substitutionNote && (
                            <div className="text-xs text-emerald-500 mt-1 font-medium">
                              החלפה חכמה: {item.substitutionNote}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {stepsWithTimers.length > 0 && (
                  <div
                    className={
                      'pt-4 border-t space-y-3 ' +
                      (darkMode ? 'border-slate-800' : 'border-stone-200')
                    }
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <h2 className="font-bold text-lg">שלבי הכנה וטיימרים</h2>
                      <div className="flex items-center gap-2 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={stepReminderEnabled}
                            onChange={(e) => setStepReminderEnabled(e.target.checked)}
                            className="rounded accent-amber-500"
                          />
                          <span>תזכורת שלבים (דק׳ לפני):</span>
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          disabled={!stepReminderEnabled}
                          value={stepReminderMinutes}
                          onChange={(e) =>
                            setStepReminderMinutes(
                              Math.max(1, Math.min(60, Number(e.target.value) || 1))
                            )
                          }
                          className={
                            'w-14 px-2 py-1 border rounded-lg text-center font-mono font-bold disabled:opacity-50 ' +
                            inputClass
                          }
                        />
                      </div>
                    </div>

                    <ol className="space-y-3">
                      {stepsWithTimers.map((step) => {
                        const key = 'step-' + step.stepNumber;
                        const isChecked = !!checkedItems[key];
                        return (
                          <li
                            key={key}
                            className={
                              'p-3.5 rounded-xl border transition-all flex flex-col gap-2.5 ' +
                              (isChecked
                                ? darkMode
                                  ? 'bg-slate-950/60 border-slate-800 text-slate-500'
                                  : 'bg-stone-50 border-stone-200 text-stone-400'
                                : darkMode
                                ? 'bg-slate-800/60 border-slate-700'
                                : 'bg-white border-stone-200 hover:border-stone-300')
                            }
                          >
                            <div
                              onClick={() => toggleCheck(key)}
                              className="flex gap-3 items-start cursor-pointer select-none"
                            >
                              <span className="w-6 h-6 rounded-full bg-amber-500 text-stone-950 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                                {step.stepNumber}
                              </span>
                              <span
                                className={'text-sm leading-relaxed ' + (isChecked ? 'line-through' : '')}
                              >
                                {step.displayText}
                              </span>
                            </div>

                            {showAirFryerHints && step.airFryerHint && (
                              <div
                                className={
                                  'mr-9 px-3 py-1.5 rounded-lg text-xs border ' +
                                  (darkMode
                                    ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300'
                                    : 'bg-emerald-50 border-emerald-200 text-emerald-800')
                                }
                              >
                                {step.airFryerHint.summary}
                              </div>
                            )}

                            {step.detectedTimers.length > 0 && (
                              <div className="flex flex-wrap gap-2 pr-9">
                                {step.detectedTimers.map((dt) => {
                                  const active = timers[dt.id];
                                  const stepRemSec = getStepReminderSeconds(dt.seconds);
                                  const btnLabel = active
                                    ? active.finished
                                      ? 'הסתיים (' + dt.label + ') - הפעל שוב'
                                      : formatSecondsClock(active.remaining) +
                                        (active.running ? ' (פועל)' : ' (מושהה)')
                                    : 'הפעל טיימר: ' +
                                      dt.label +
                                      (stepRemSec
                                        ? ' • תזכורת ' + Math.round(stepRemSec / 60) + ' דק׳'
                                        : '');

                                  return (
                                    <button
                                      key={dt.id}
                                      type="button"
                                      onClick={() =>
                                        startOrToggleTimer(
                                          dt.id,
                                          dt.seconds,
                                          dt.label,
                                          'שלב ' + step.stepNumber,
                                          stepRemSec
                                        )
                                      }
                                      className={
                                        'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ' +
                                        (active?.running
                                          ? 'bg-amber-500 text-stone-950 shadow-sm'
                                          : active?.finished
                                          ? 'bg-red-600 text-white'
                                          : darkMode
                                          ? 'bg-slate-700 hover:bg-slate-600 text-amber-300 border border-slate-600'
                                          : 'bg-amber-100/80 hover:bg-amber-200 text-amber-950 border border-amber-300')
                                      }
                                    >
                                      {btnLabel}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
`;

fs.mkdirSync(path.join(process.cwd(), 'lib'), { recursive: true });
fs.mkdirSync(path.join(process.cwd(), 'components'), { recursive: true });
fs.mkdirSync(path.join(process.cwd(), 'app', 'api', 'extract-recipe'), { recursive: true });

fs.writeFileSync(path.join(process.cwd(), 'app', 'layout.tsx'), layoutCode, 'utf8');
fs.writeFileSync(path.join(process.cwd(), 'lib', 'recipeEngine.ts'), engineCode, 'utf8');
fs.writeFileSync(path.join(process.cwd(), 'lib', 'recipeBook.ts'), recipeBookLibCode, 'utf8');
fs.writeFileSync(path.join(process.cwd(), 'components', 'RecipeBookVault.tsx'), recipeBookVaultCode, 'utf8');
fs.writeFileSync(path.join(process.cwd(), 'app', 'api', 'extract-recipe', 'route.ts'), apiRouteCode, 'utf8');
fs.writeFileSync(path.join(process.cwd(), 'app', 'page.tsx'), pageCode, 'utf8');

console.log('עודכן בהצלחה: כריכה ותוכן עניינים לספר, עריכה ישירה, מידות מטרי/US וכפתור +1:00 לטיימר.');