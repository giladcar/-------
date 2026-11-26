@'
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const libDir = path.join(root, 'lib');
const componentsDir = path.join(root, 'components');

if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true });
if (!fs.existsSync(componentsDir)) fs.mkdirSync(componentsDir, { recursive: true });

const unitConverterCode = `export type ConversionUnit =
  | 'original'
  | 'cups'
  | 'tbsp'
  | 'tsp'
  | 'pinch'
  | 'liters'
  | 'ml'
  | 'kg'
  | 'grams'
  | 'oz';

export interface UnitOption {
  id: ConversionUnit;
  label: string;
  shortLabel: string;
}

export const UNIT_OPTIONS: UnitOption[] = [
  { id: 'original', label: 'מקורי', shortLabel: 'מקורי' },
  { id: 'cups', label: 'כוסות', shortLabel: 'כוס' },
  { id: 'tbsp', label: 'כפות', shortLabel: 'כף' },
  { id: 'tsp', label: 'כפיות', shortLabel: 'כפית' },
  { id: 'pinch', label: 'קמצוץ', shortLabel: 'קמצוץ' },
  { id: 'liters', label: 'ליטר', shortLabel: 'ליטר' },
  { id: 'ml', label: 'מ"ל', shortLabel: 'מ"ל' },
  { id: 'kg', label: 'קילו', shortLabel: 'ק"ג' },
  { id: 'grams', label: 'גרם', shortLabel: 'גרם' },
  { id: 'oz', label: 'אונקיות', shortLabel: 'oz' },
];

type InternalUnitKind =
  | 'cup'
  | 'tbsp'
  | 'tsp'
  | 'pinch'
  | 'liter'
  | 'ml'
  | 'kg'
  | 'gram'
  | 'oz'
  | 'lb'
  | 'count';

const VOLUME_IN_ML: Record<string, number> = {
  cup: 240,
  tbsp: 15,
  tsp: 5,
  pinch: 0.3125, // 1/16 כפית
  liter: 1000,
  ml: 1,
};

const WEIGHT_IN_GRAMS: Record<string, number> = {
  gram: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
};

// צפיפות חומרים נפוצים (גרם לכוס סטנדרטית של 240 מ"ל)
const DENSITY_GRAMS_PER_CUP: Array<{ keywords: string[]; gramsPerCup: number }> = [
  { keywords: ['אבקת סוכר', 'קורנפלור', 'קקאו', 'עמילן'], gramsPerCup: 120 },
  { keywords: ['קמח'], gramsPerCup: 140 },
  { keywords: ['סוכר'], gramsPerCup: 200 },
  { keywords: ['שמן'], gramsPerCup: 218 },
  { keywords: ['חמאה', 'מרגרינה', 'שומן'], gramsPerCup: 227 },
  { keywords: ['דבש', 'סילאן', 'מייפל', 'ריבה', 'ממרח', 'טחינה'], gramsPerCup: 320 },
  { keywords: ['מלח'], gramsPerCup: 288 },
  { keywords: ['אבקת אפייה', 'אבקת אפיה', 'סודה לשתייה', 'סודה לשתיה', 'שמרים'], gramsPerCup: 230 },
  { keywords: ['פלפל', 'קינמון', 'כמון', 'פפריקה', 'כורכום', 'תבלין'], gramsPerCup: 120 },
  { keywords: ['אורז', 'קוסקוס', 'שיבולת שועל', 'בורגול', 'עדשים'], gramsPerCup: 185 },
  { keywords: ['שקדים', 'אגוזים', 'פיסטוק', 'קוקוס'], gramsPerCup: 110 },
  { keywords: ['שוקולד'], gramsPerCup: 170 },
  { keywords: ['מים', 'חלב', 'שמנת', 'מיץ', 'יין', 'סויה', 'חומץ', 'ציר'], gramsPerCup: 240 },
];

function getGramsPerMl(ingredientName: string): number {
  const lower = ingredientName.toLowerCase();
  for (const entry of DENSITY_GRAMS_PER_CUP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.gramsPerCup / 240;
    }
  }
  return 1.0; // ברירת מחדל: 1 גרם = 1 מ"ל
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

function parseSingleNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  // שבר יוניקוד בודד (למשל ½)
  if (UNICODE_FRACTIONS[s] !== undefined) {
    return UNICODE_FRACTIONS[s];
  }

  // מספר מעורב LTR: "1 ½" או "1 1/2"
  const mixedLtr = s.match(/^(\d+)\s+([½⅓⅔¼¾⅛⅜⅝⅞]|\d+\/\d+)$/);
  if (mixedLtr) {
    const whole = parseFloat(mixedLtr[1]);
    const frac = parseSingleNumber(mixedLtr[2]) ?? 0;
    return whole + frac;
  }

  // מספר מעורב RTL: "½1" או "½ 1"
  const mixedRtl = s.match(/^([½⅓⅔¼¾⅛⅜⅝⅞])\s*(\d+)$/);
  if (mixedRtl) {
    const frac = UNICODE_FRACTIONS[mixedRtl[1]] ?? 0;
    const whole = parseFloat(mixedRtl[2]);
    return whole + frac;
  }

  // שבר רגיל: "1/2"
  const slash = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (slash) {
    const num = parseFloat(slash[1]);
    const den = parseFloat(slash[2]);
    return den !== 0 ? num / den : null;
  }

  // עשרוני או שלם
  const cleaned = s.replace(',', '.');
  if (/^\d+(?:\.\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned);
  }

  return null;
}

const UNIT_PATTERNS: Array<{ pattern: RegExp; kind: InternalUnitKind }> = [
  { pattern: /^(?:כוסות|כוס|cups?|c\.?)(?=\s|$|[.,])/i, kind: 'cup' },
  { pattern: /^(?:כפות|כף|tablespoons?|tbsp\.?)(?=\s|$|[.,])/i, kind: 'tbsp' },
  { pattern: /^(?:כפיות|כפית|teaspoons?|tsp\.?)(?=\s|$|[.,])/i, kind: 'tsp' },
  { pattern: /^(?:קמצוצים|קמצוץ|קורט|pinch(?:es)?)(?=\s|$|[.,])/i, kind: 'pinch' },
  { pattern: /^(?:ליטרים|ליטר|ל'|liters?|l)(?=\s|$|[.,])/i, kind: 'liter' },
  { pattern: /^(?:מ"ל|מל|מיליליטר|ml)(?=\s|$|[.,])/i, kind: 'ml' },
  { pattern: /^(?:ק"ג|קג|קילוגרם|קילו|kg)(?=\s|$|[.,])/i, kind: 'kg' },
  { pattern: /^(?:גרמים|גרם|ג'|grams?|g)(?=\s|$|[.,])/i, kind: 'gram' },
  { pattern: /^(?:אונקיות|אונקיה|oz)(?=\s|$|[.,])/i, kind: 'oz' },
  { pattern: /^(?:פאונד|ליברות|ליברה|lbs?)(?=\s|$|[.,])/i, kind: 'lb' },
];

interface ParsedIngredient {
  prefix: string;
  minVal: number;
  maxVal: number | null;
  sourceUnit: InternalUnitKind;
  restName: string;
}

function parseIngredientLine(rawLine: string): ParsedIngredient | null {
  // הסרת הערת גרמים בסוגריים קיימת (כגון "(~420 גרם)") כדי למנוע כפילות
  const withoutParens = rawLine
    .replace(/\s*\(~?\s*\d+(?:[.,]\d+)?\s*(?:גרם|ג'|ג|מ"ל|מל|ק"ג|קילו)\s*\)/g, '')
    .trim();

  // קידומת אופציונלית כמו "כ-" או "כ "
  const prefixMatch = withoutParens.match(/^(כ[\-\s]?)(.+)$/);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const body = prefixMatch ? prefixMatch[2].trim() : withoutParens;

  // התאמת כמות בתחילת השורה (כולל טווח כמו "1-2" או "½1 - 2")
  const qtyRegex =
    /^((?:\d+\s+[½⅓⅔¼¾⅛⅜⅝⅞]|\d+\s+\d+\/\d+|[½⅓⅔¼¾⅛⅜⅝⅞]\s*\d+|\d+\/\d+|[½⅓⅔¼¾⅛⅜⅝⅞]|\d+(?:[.,]\d+)?))(?:\s*[-–]\s*((?:\d+\s+[½⅓⅔¼¾⅛⅜⅝⅞]|\d+\s+\d+\/\d+|[½⅓⅔¼¾⅛⅜⅝⅞]\s*\d+|\d+\/\d+|[½⅓⅔¼¾⅛⅜⅝⅞]|\d+(?:[.,]\d+)?)))?\s+(.+)$/;

  const match = body.match(qtyRegex);
  if (!match) return null;

  const minVal = parseSingleNumber(match[1]);
  if (minVal === null || minVal <= 0) return null;

  const maxVal = match[2] ? parseSingleNumber(match[2]) : null;
  const remainder = match[3].trim();

  for (const { pattern, kind } of UNIT_PATTERNS) {
    const uMatch = remainder.match(pattern);
    if (uMatch) {
      const restName = remainder.slice(uMatch[0].length).trim();
      return {
        prefix,
        minVal,
        maxVal,
        sourceUnit: kind,
        restName,
      };
    }
  }

  return {
    prefix,
    minVal,
    maxVal,
    sourceUnit: 'count',
    restName: remainder,
  };
}

function convertAmount(
  amount: number,
  sourceUnit: InternalUnitKind,
  targetUnit: ConversionUnit,
  gramsPerMl: number
): number {
  // שלב 1: המרה למיליליטר (מ"ל)
  let mlAmount: number;
  if (sourceUnit in VOLUME_IN_ML) {
    mlAmount = amount * VOLUME_IN_ML[sourceUnit];
  } else if (sourceUnit in WEIGHT_IN_GRAMS) {
    const grams = amount * WEIGHT_IN_GRAMS[sourceUnit];
    mlAmount = grams / gramsPerMl;
  } else {
    return amount;
  }

  // שלב 2: המרה ליחידת היעד
  switch (targetUnit) {
    case 'ml':
      return mlAmount;
    case 'liters':
      return mlAmount / 1000;
    case 'cups':
      return mlAmount / 240;
    case 'tbsp':
      return mlAmount / 15;
    case 'tsp':
      return mlAmount / 5;
    case 'pinch':
      return mlAmount / 0.3125;
    case 'grams':
      return mlAmount * gramsPerMl;
    case 'kg':
      return (mlAmount * gramsPerMl) / 1000;
    case 'oz':
      return (mlAmount * gramsPerMl) / 28.3495;
    default:
      return amount;
  }
}

function matchFraction(frac: number): string | null {
  const candidates: Array<{ val: number; label: string }> = [
    { val: 0.25, label: 'רבע' },
    { val: 1 / 3, label: 'שליש' },
    { val: 0.5, label: 'חצי' },
    { val: 2 / 3, label: 'שני שליש' },
    { val: 0.75, label: 'שלושת רבעי' },
  ];
  for (const c of candidates) {
    if (Math.abs(frac - c.val) <= 0.035) {
      return c.label;
    }
  }
  return null;
}

function formatRounded(val: number, decimals = 2): string {
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(val * factor) / factor;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function formatHebrewAmountWithUnit(value: number, targetUnit: ConversionUnit): string {
  const whole = Math.floor(value + 0.035);
  const remainder = value - Math.floor(value);

  if (targetUnit === 'pinch') {
    const count = Math.max(1, Math.round(value));
    return count === 1 ? 'קמצוץ' : \`\${count} קמצוצים\`;
  }

  if (targetUnit === 'cups') {
    const fracWord = matchFraction(remainder);
    if (Math.floor(value) === 0 && fracWord) {
      return \`\${fracWord} כוס\`;
    }
    if (Math.abs(value - 1) <= 0.035) {
      return '1 כוס';
    }
    if (Math.abs(value - 1.5) <= 0.035) {
      return 'כוס וחצי (1 ½)';
    }
    if (fracWord && Math.floor(value) >= 1) {
      const sym =
        fracWord === 'חצי'
          ? '½'
          : fracWord === 'רבע'
            ? '¼'
            : fracWord === 'שלושת רבעי'
              ? '¾'
              : fracWord === 'שליש'
                ? '⅓'
                : '⅔';
      return \`\${Math.floor(value)} \${sym} כוסות\`;
    }
    if (Math.abs(value - whole) <= 0.035 && whole >= 2) {
      return \`\${whole} כוסות\`;
    }
    return \`\${formatRounded(value, 2)} כוסות\`;
  }

  if (targetUnit === 'liters') {
    const fracWord = matchFraction(remainder);
    if (Math.floor(value) === 0 && fracWord) {
      return \`\${fracWord} ליטר\`;
    }
    if (Math.abs(value - 1.5) <= 0.035) {
      return 'ליטר וחצי (1.5)';
    }
    return \`\${formatRounded(value, 2)} ליטר\`;
  }

  if (targetUnit === 'kg') {
    const fracWord = matchFraction(remainder);
    if (Math.floor(value) === 0 && fracWord) {
      return \`\${fracWord} קילו\`;
    }
    if (Math.abs(value - 1.5) <= 0.035) {
      return 'קילו וחצי (1.5)';
    }
    return \`\${formatRounded(value, 2)} קילו\`;
  }

  if (targetUnit === 'tbsp') {
    const fracWord = matchFraction(remainder);
    if (Math.floor(value) === 0 && fracWord) {
      return \`\${fracWord} כף\`;
    }
    if (Math.abs(value - 1) <= 0.035) {
      return '1 כף';
    }
    if (Math.abs(value - 1.5) <= 0.035) {
      return 'כף וחצי (1 ½)';
    }
    if (Math.abs(value - whole) <= 0.035 && whole >= 2) {
      return \`\${whole} כפות\`;
    }
    return \`\${formatRounded(value, 1)} כפות\`;
  }

  if (targetUnit === 'tsp') {
    const fracWord = matchFraction(remainder);
    if (Math.floor(value) === 0 && fracWord) {
      return \`\${fracWord} כפית\`;
    }
    if (Math.abs(value - 1) <= 0.035) {
      return '1 כפית';
    }
    if (Math.abs(value - 1.5) <= 0.035) {
      return 'כפית וחצי (1 ½)';
    }
    if (Math.abs(value - whole) <= 0.035 && whole >= 2) {
      return \`\${whole} כפיות\`;
    }
    return \`\${formatRounded(value, 1)} כפיות\`;
  }

  if (targetUnit === 'grams') {
    return value < 10 ? \`\${formatRounded(value, 1)} גרם\` : \`\${Math.round(value)} גרם\`;
  }

  if (targetUnit === 'ml') {
    return value < 10 ? \`\${formatRounded(value, 1)} מ"ל\` : \`\${Math.round(value)} מ"ל\`;
  }

  if (targetUnit === 'oz') {
    return \`\${formatRounded(value, 1)} אונקיות\`;
  }

  return formatRounded(value, 2);
}

/**
 * ממיר שורת מצרך (לאחר או לפני הכפלה) ליחידת המידה המבוקשת.
 * אם targetUnit === 'original' או שהמצרך ספיר (כמו "3 ביצים"), מחזיר את השורה המקורית.
 */
export function convertIngredientLine(
  scaledLine: string,
  targetUnit: ConversionUnit
): string {
  if (!targetUnit || targetUnit === 'original') {
    return scaledLine;
  }

  const parsed = parseIngredientLine(scaledLine);
  if (!parsed || parsed.sourceUnit === 'count') {
    return scaledLine;
  }

  const gramsPerMl = getGramsPerMl(parsed.restName);
  const convertedMin = convertAmount(parsed.minVal, parsed.sourceUnit, targetUnit, gramsPerMl);

  if (parsed.maxVal !== null) {
    const convertedMax = convertAmount(parsed.maxVal, parsed.sourceUnit, targetUnit, gramsPerMl);
    const minStr = formatRounded(convertedMin, 2);
    const maxFormatted = formatHebrewAmountWithUnit(convertedMax, targetUnit);
    return \`\${parsed.prefix}\${minStr}-\${maxFormatted} \${parsed.restName}\`.trim();
  }

  const formattedQty = formatHebrewAmountWithUnit(convertedMin, targetUnit);
  return \`\${parsed.prefix}\${formattedQty} \${parsed.restName}\`.trim();
}
`;

const uiComponentCode = `'use client';

import React from 'react';
import { ConversionUnit, UNIT_OPTIONS } from '@/lib/unitConverter';

interface GlobalUnitBarProps {
  globalUnit: ConversionUnit;
  onChangeGlobalUnit: (unit: ConversionUnit) => void;
  hasIndividualOverrides: boolean;
  onResetAll: () => void;
}

export function GlobalUnitBar({
  globalUnit,
  onChangeGlobalUnit,
  hasIndividualOverrides,
  onResetAll,
}: GlobalUnitBarProps) {
  const showReset = globalUnit !== 'original' || hasIndividualOverrides;

  return (
    <div
      dir="rtl"
      className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 shadow-sm"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-amber-300">
          המרת יחידות לכל המתכון (לשנות הכל):
        </span>
        {showReset && (
          <button
            type="button"
            onClick={onResetAll}
            className="rounded-lg border border-rose-400/40 bg-rose-500/20 px-2.5 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/30"
          >
            איפוס למקורי
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {UNIT_OPTIONS.map((opt) => {
          const isActive = globalUnit === opt.id && !hasIndividualOverrides;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChangeGlobalUnit(opt.id)}
              className={\`rounded-lg px-2.5 py-1 text-xs font-medium transition \${
                isActive
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'border border-slate-700 bg-slate-800/80 text-slate-200 hover:border-amber-400/50 hover:text-amber-200'
              }\`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface IngredientUnitSelectProps {
  value: ConversionUnit;
  isOverridden: boolean;
  onChange: (unit: ConversionUnit) => void;
}

export function IngredientUnitSelect({
  value,
  isOverridden,
  onChange,
}: IngredientUnitSelectProps) {
  return (
    <select
      dir="rtl"
      aria-label="בחר יחידת מידה למצרך זה"
      title="המרת יחידה למצרך זה בנפרד"
      value={value}
      onChange={(e) => onChange(e.target.value as ConversionUnit)}
      className={\`shrink-0 rounded-lg border px-2 py-1 text-xs font-medium outline-none transition \${
        isOverridden
          ? 'border-emerald-400 bg-emerald-950/80 text-emerald-200 font-bold'
          : 'border-slate-700 bg-slate-800/90 text-slate-300 hover:border-amber-400/60'
      }\`}
    >
      {UNIT_OPTIONS.map((opt) => (
        <option key={opt.id} value={opt.id} className="bg-slate-900 text-slate-100">
          {opt.label}
        </option>
      ))}
    </select>
  );
}
`;

fs.writeFileSync(path.join(libDir, 'unitConverter.ts'), unitConverterCode, 'utf8');
fs.writeFileSync(path.join(componentsDir, 'UnitConversionControls.tsx'), uiComponentCode, 'utf8');

console.log('✅ נוצר בהצלחה: lib/unitConverter.ts');
console.log('✅ נוצר בהצלחה: components/UnitConversionControls.tsx');

// בדיקה של קובץ העמוד הראשי כדי להציג היכן לשלב את הרכיבים
const pagePath = path.join(root, 'app', 'page.tsx');
if (fs.existsSync(pagePath)) {
  const pageContent = fs.readFileSync(pagePath, 'utf8');
  const lines = pageContent.split('\n');
  console.log('\n--- מיקומי רינדור מצרכים ב-app/page.tsx ---');
  lines.forEach((line, idx) => {
    if (line.includes('parseAndScaleLine') || line.includes('ingredients')) {
      console.log(`שורה ${idx + 1}: ${line.trim()}`);
    }
  });
}
'@ | Out-File -FilePath setup-unit-conversions.mjs -Encoding utf8
node setup-unit-conversions.mjs