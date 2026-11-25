import fs from 'node:fs';
import path from 'node:path';

const engineCode = `export type DietMode = 'none' | 'vegan' | 'gluten-free' | 'dairy-free';

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

export function parseAndScaleLine(
  line: string,
  scaleFactor: number,
  dietMode: DietMode,
  convertToGrams: boolean
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

// זיהוי אוטומטי של זמנים בתוך שלב הכנה (תומך בטווחים כמו 30-35 דקות, שברים, דקות, שעות ושניות)
export function extractTimersFromStep(stepText: string, stepIndex: number): DetectedTimer[] {
  const results: DetectedTimer[] = [];
  const timeRegex =
    /(?:כ-|בערך\s+)?(\\d+(?:[.,]\\d+)?(?:\\s*-\\s*\\d+(?:[.,]\\d+)?)?|[½¼¾])\\s*(שעות|שעה|דקות|דקה|שניות|שנייה|hours?|hour|minutes?|mins?|min|seconds?|secs?|sec)(?=\\s|[.,!?;:]|$)/gi;

  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = timeRegex.exec(stepText)) !== null) {
    const rawNumPart = match[1].trim();
    const rawUnit = match[2].toLowerCase();

    // אם יש טווח (למשל 30-35), לוקחים את הערך העליון כדי שלא יכבה מוקדם מדי
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
`;

const pageCode = `'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  parseAndScaleLine,
  extractTimersFromStep,
  formatSecondsClock,
  DietMode,
} from '@/lib/recipeEngine';

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

interface ActiveTimerState {
  id: string;
  label: string;
  stepNumber: number;
  remaining: number;
  total: number;
  running: boolean;
  finished: boolean;
}

function playAlarmBeep() {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const notes = [880, 1174.66, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.22);
      osc.stop(ctx.currentTime + i * 0.22 + 0.21);
    });
  } catch {
    // חסימת אודיו מצד הדפדפן
  }
}

export default function SmartRecipeScalerPage() {
  const [rawIngredients, setRawIngredients] = useState<string>(SAMPLE_RECIPE);
  const [rawSteps, setRawSteps] = useState<string>(SAMPLE_STEPS);
  const [originalServings, setOriginalServings] = useState<number>(4);
  const [targetServings, setTargetServings] = useState<number>(6);
  const [dietMode, setDietMode] = useState<DietMode>('none');
  const [convertToGrams, setConvertToGrams] = useState<boolean>(false);
  const [cookingMode, setCookingMode] = useState<boolean>(false);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<boolean>(false);
  const [timers, setTimers] = useState<Record<string, ActiveTimerState>>({});
  const finishedSoundPlayedRef = useRef<Record<string, boolean>>({});

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

  // ספירה לאחור לכל הטיימרים הפעילים
  useEffect(() => {
    const interval = setInterval(() => {
      setTimers((prev) => {
        let changed = false;
        const next: Record<string, ActiveTimerState> = {};

        for (const [id, t] of Object.entries(prev)) {
          if (t.running && t.remaining > 0) {
            changed = true;
            const nextRem = t.remaining - 1;
            if (nextRem === 0) {
              if (!finishedSoundPlayedRef.current[id]) {
                finishedSoundPlayedRef.current[id] = true;
                playAlarmBeep();
              }
              next[id] = { ...t, remaining: 0, running: false, finished: true };
            } else {
              next[id] = { ...t, remaining: nextRem };
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

  const scaleFactor = useMemo(() => {
    if (originalServings <= 0 || targetServings <= 0) return 1;
    return targetServings / originalServings;
  }, [originalServings, targetServings]);

  const parsedIngredients = useMemo(() => {
    return rawIngredients
      .split('\\n')
      .filter((line) => line.trim() !== '')
      .map((line) => parseAndScaleLine(line, scaleFactor, dietMode, convertToGrams));
  }, [rawIngredients, scaleFactor, dietMode, convertToGrams]);

  const stepsWithTimers = useMemo(() => {
    return rawSteps
      .split('\\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text, idx) => ({
        text,
        stepNumber: idx + 1,
        detectedTimers: extractTimersFromStep(text, idx),
      }));
  }, [rawSteps]);

  const startOrToggleTimer = (id: string, totalSeconds: number, label: string, stepNumber: number) => {
    delete finishedSoundPlayedRef.current[id];
    setTimers((prev) => {
      const existing = prev[id];
      if (!existing) {
        return {
          ...prev,
          [id]: {
            id,
            label,
            stepNumber,
            remaining: totalSeconds,
            total: totalSeconds,
            running: true,
            finished: false,
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

  const resetTimer = (id: string) => {
    delete finishedSoundPlayedRef.current[id];
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
        },
      };
    });
  };

  const toggleCheck = (key: string) => {
    setCheckedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCopyRecipe = () => {
    const text = parsedIngredients.map((item) => '• ' + item.displayText).join('\\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const activeTimerList = Object.values(timers);

  return (
    <main dir="rtl" className="min-h-screen bg-stone-50 text-stone-900 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-stone-900">
              ממיר מתכונים חכם
            </h1>
            <p className="text-stone-500 text-sm mt-1">
              התאמת כמויות, המרה לגרמים, החלפת רכיבים וטיימרים אוטומטיים — חישוב מיידי ללא AI
            </p>
          </div>

          <button
            onClick={() => setCookingMode(!cookingMode)}
            className={
              'px-5 py-2.5 rounded-xl font-medium text-sm transition-all cursor-pointer ' +
              (cookingMode
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-stone-100 text-stone-700 hover:bg-stone-200')
            }
          >
            {cookingMode ? 'מצב בישול פעיל (מסך דלוק)' : 'הפעל מצב בישול'}
          </button>
        </header>

        {/* סרגל טיימרים פעילים או שהסתיימו */}
        {activeTimerList.length > 0 && (
          <section className="bg-stone-900 text-white p-5 rounded-2xl shadow-md space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sm tracking-wide text-amber-400">
                טיימרים במטבח ({activeTimerList.length})
              </h2>
              <button
                onClick={() => setTimers({})}
                className="text-xs text-stone-400 hover:text-white cursor-pointer"
              >
                נקה טיימרים
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeTimerList.map((t) => (
                <div
                  key={t.id}
                  className={
                    'p-3.5 rounded-xl border flex items-center justify-between gap-3 ' +
                    (t.finished
                      ? 'bg-red-950/80 border-red-500 animate-pulse'
                      : 'bg-stone-800 border-stone-700')
                  }
                >
                  <div>
                    <div className="text-xs text-stone-400">
                      שלב {t.stepNumber} • {t.label}
                    </div>
                    <div className="text-2xl font-mono font-bold mt-0.5">
                      {t.finished ? 'הזמן נגמר!' : formatSecondsClock(t.remaining)}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => startOrToggleTimer(t.id, t.total, t.label, t.stepNumber)}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs cursor-pointer"
                    >
                      {t.finished ? 'הפעל שוב' : t.running ? 'השהה' : 'המשך'}
                    </button>
                    <button
                      onClick={() => resetTimer(t.id)}
                      className="px-2.5 py-1.5 rounded-lg bg-stone-700 hover:bg-stone-600 text-white text-xs cursor-pointer"
                    >
                      איפוס
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-stone-500 uppercase">
                התאמת מנות (פי {scaleFactor.toFixed(2).replace(/\\.00$/, '')})
              </label>
              <div className="flex gap-1">
                {[0.5, 1, 2, 3].map((mult) => (
                  <button
                    key={mult}
                    onClick={() => setTargetServings(Math.max(1, Math.round(originalServings * mult)))}
                    className="text-[11px] px-1.5 py-0.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-600 cursor-pointer"
                  >
                    ×{mult}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <span className="text-xs text-stone-500">במקור:</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={originalServings}
                  onChange={(e) => setOriginalServings(Math.max(1, Number(e.target.value)))}
                  className="w-full mt-1 px-3 py-2 border border-stone-300 rounded-lg text-center font-semibold"
                />
              </div>
              <span className="text-stone-400 font-bold pt-5">←</span>
              <div className="flex-1">
                <span className="text-xs text-stone-500">רצוי:</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={targetServings}
                  onChange={(e) => setTargetServings(Math.max(1, Number(e.target.value)))}
                  className="w-full mt-1 px-3 py-2 border-2 border-amber-500 bg-amber-50/40 rounded-lg text-center font-bold text-amber-900"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-stone-500 uppercase">
              החלפת רכיבים אוטומטית
            </label>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {[
                { id: 'none', label: 'רגיל' },
                { id: 'vegan', label: 'טבעוני' },
                { id: 'gluten-free', label: 'ללא גלוטן' },
                { id: 'dairy-free', label: 'ללא לקטוז' },
              ].map((option) => (
                <button
                  key={option.id}
                  onClick={() => setDietMode(option.id as DietMode)}
                  className={
                    'py-2 px-3 rounded-lg text-xs font-medium border transition-all cursor-pointer ' +
                    (dietMode === option.id
                      ? 'bg-stone-900 text-white border-stone-900'
                      : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50')
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-stone-500 uppercase">
              יחידות מידה
            </label>
            <div className="pt-1">
              <button
                onClick={() => setConvertToGrams(!convertToGrams)}
                className={
                  'w-full py-3 px-4 rounded-xl text-sm font-medium border transition-all flex items-center justify-between cursor-pointer ' +
                  (convertToGrams
                    ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                    : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100')
                }
              >
                <span>המר כוסות וכפות לגרמים</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-black/10">
                  {convertToGrams ? 'פעיל' : 'כבוי'}
                </span>
              </button>
            </div>
          </div>
        </section>

        <div className={'grid grid-cols-1 gap-6 ' + (cookingMode ? '' : 'lg:grid-cols-2')}>
          {!cookingMode && (
            <section className="space-y-4 bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h2 className="font-bold text-lg">1. הדבקת מצרכים</h2>
                  <button
                    onClick={() => {
                      setRawIngredients('');
                      setRawSteps('');
                      setCheckedItems({});
                      setTimers({});
                    }}
                    className="text-xs text-stone-400 hover:text-red-500 cursor-pointer"
                  >
                    נקה הכל
                  </button>
                </div>
                <textarea
                  rows={8}
                  value={rawIngredients}
                  onChange={(e) => setRawIngredients(e.target.value)}
                  placeholder="לדוגמה:&#10;2 כוסות קמח&#10;1/2 כוס סוכר&#10;3 ביצים"
                  className="w-full p-3 border border-stone-300 rounded-xl text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <h2 className="font-bold text-lg mb-2">2. שלבי הכנה (מזהה זמנים אוטומטית)</h2>
                <textarea
                  rows={5}
                  value={rawSteps}
                  onChange={(e) => setRawSteps(e.target.value)}
                  placeholder="לדוגמה: אופים 35 דקות ב-180 מעלות..."
                  className="w-full p-3 border border-stone-300 rounded-xl text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </section>
          )}

          <section className="space-y-6 bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
            <div>
              <div className="flex justify-between items-center mb-3">
                <h2 className="font-bold text-lg">
                  מצרכים מותאמים ({targetServings} מנות)
                </h2>
                <button
                  onClick={handleCopyRecipe}
                  className="px-3 py-1.5 text-xs font-medium bg-stone-100 hover:bg-stone-200 rounded-lg text-stone-700 cursor-pointer"
                >
                  {copied ? 'הועתק!' : 'העתק רשימה'}
                </button>
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
                          ? 'bg-stone-50 border-stone-200 text-stone-400 line-through'
                          : 'bg-amber-50/30 border-amber-200/70 hover:bg-amber-50')
                      }
                    >
                      <div className="font-medium text-base">{item.displayText}</div>
                      {item.substitutionNote && (
                        <div className="text-xs text-emerald-700 mt-1 font-medium">
                          החלפה חכמה: {item.substitutionNote}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {stepsWithTimers.length > 0 && (
              <div className="pt-4 border-t border-stone-200">
                <h2 className="font-bold text-lg mb-3">שלבי הכנה וטיימרים</h2>
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
                            ? 'bg-stone-50 border-stone-200 text-stone-400'
                            : 'bg-white border-stone-200 hover:border-stone-300')
                        }
                      >
                        <div
                          onClick={() => toggleCheck(key)}
                          className="flex gap-3 items-start cursor-pointer select-none"
                        >
                          <span className="w-6 h-6 rounded-full bg-stone-900 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                            {step.stepNumber}
                          </span>
                          <span className={'text-sm leading-relaxed ' + (isChecked ? 'line-through' : '')}>
                            {step.text}
                          </span>
                        </div>

                        {step.detectedTimers.length > 0 && (
                          <div className="flex flex-wrap gap-2 pr-9">
                            {step.detectedTimers.map((dt) => {
                              const active = timers[dt.id];
                              const btnLabel = active
                                ? active.finished
                                  ? 'הסתיים (' + dt.label + ') - הפעל שוב'
                                  : formatSecondsClock(active.remaining) + (active.running ? ' (פועל)' : ' (מושהה)')
                                : 'הפעל טיימר: ' + dt.label;

                              return (
                                <button
                                  key={dt.id}
                                  type="button"
                                  onClick={() => startOrToggleTimer(dt.id, dt.seconds, dt.label, step.stepNumber)}
                                  className={
                                    'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ' +
                                    (active?.running
                                      ? 'bg-amber-500 text-stone-950 shadow-sm'
                                      : active?.finished
                                      ? 'bg-red-600 text-white'
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
      </div>
    </main>
  );
}
`;

fs.mkdirSync(path.join(process.cwd(), 'lib'), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), 'lib', 'recipeEngine.ts'), engineCode, 'utf8');
fs.writeFileSync(path.join(process.cwd(), 'app', 'page.tsx'), pageCode, 'utf8');

console.log('עודכן בהצלחה: זיהוי טיימרים אוטומטי נוסף ל-lib/recipeEngine.ts ו-app/page.tsx');