'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  parseAndScaleLine,
  extractTimersFromStep,
  extractRecipeFromText,
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
].join('\n');

const SAMPLE_STEPS = [
  'מחממים תנור ל-180 מעלות ומשמנים תבנית למשך 10 דקות.',
  'מערבבים בקערה את הביצים, הסוכר, השמן והחלב במשך 2 דקות עד לקבלת תערובת אחידה.',
  'מוסיפים את הקמח, אבקת האפייה והמלח ומערבבים רק עד לאיחוד.',
  'אופים כ-35 דקות עד שקיסם יוצא יבש ומניחים לצינון 15 דקות.',
].join('\n');

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
].join('\n');

interface ActiveTimerState {
  id: string;
  label: string;
  sourceLabel: string;
  remaining: number;
  total: number;
  running: boolean;
  finished: boolean;
  reminderSeconds: number | null;
  reminderTriggered: boolean;
}

// מחזיר את משך סבב הצליל במילישניות כדי שנוכל לחזור בדיוק שנייה אחרי שהוא מסתיים
function playAlarmBeep(kind: 'finish' | 'reminder' = 'finish'): number {
  if (typeof window === 'undefined') return 1000;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  if (kind === 'reminder') {
    // צליל ההתראה הוא הצליל שהיה קודם צליל הסיום
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

  // צלצול סופי מתמשך שנחזור עליו שנייה אחרי שסבב הצלצול מסתיים
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
  const reminderSoundPlayedRef = useRef<Record<string, boolean>>({});
  const finishSoundDurationRef = useRef<number>(1600);

  // מצב טיימר מותאם אישית (שעות, דקות, שניות + תזכורת מוקדמת)
  const [customTitle, setCustomTitle] = useState<string>('');
  const [customHours, setCustomHours] = useState<number>(0);
  const [customMinutes, setCustomMinutes] = useState<number>(10);
  const [customSeconds, setCustomSeconds] = useState<number>(0);
  const [reminderEnabled, setReminderEnabled] = useState<boolean>(true);
  const [reminderMinutesInput, setReminderMinutesInput] = useState<number>(5);
  const [customTimerError, setCustomTimerError] = useState<string | null>(null);

  // מצב חילוץ אוטומטי (קישור URL או טקסט ארוך)
  const [importerOpen, setImporterOpen] = useState<boolean>(true);
  const [urlInput, setUrlInput] = useState<string>('');
  const [longTextInput, setLongTextInput] = useState<string>(SAMPLE_LONG_TEXT);
  const [importing, setImporting] = useState<boolean>(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

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
              }
            }

            if (nextRem === 0) {
              if (!finishedSoundPlayedRef.current[id]) {
                finishedSoundPlayedRef.current[id] = true;
                finishSoundDurationRef.current = playAlarmBeep('finish');
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

  const hasFinishedTimers = useMemo(
    () => Object.values(timers).some((t) => t.finished),
    [timers]
  );

  // מפעיל את הצלצול הסופי שוב שנייה אחת אחרי שהסבב הקודם הסתיים, עד שלוחצים על אוקיי - סגור
  useEffect(() => {
    if (!hasFinishedTimers) return;

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
  }, [hasFinishedTimers]);

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

  const handleStartCustomTimer = () => {
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
        reminderSeconds: validReminderSec,
        reminderTriggered: false,
      },
    }));
  };

  const scaleFactor = useMemo(() => {
    if (originalServings <= 0 || targetServings <= 0) return 1;
    return targetServings / originalServings;
  }, [originalServings, targetServings]);

  const parsedIngredients = useMemo(() => {
    return rawIngredients
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => parseAndScaleLine(line, scaleFactor, dietMode, convertToGrams));
  }, [rawIngredients, scaleFactor, dietMode, convertToGrams]);

  const stepsWithTimers = useMemo(() => {
    return rawSteps
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text, idx) => ({
        text,
        stepNumber: idx + 1,
        detectedTimers: extractTimersFromStep(text, idx),
      }));
  }, [rawSteps]);

  const applyExtractedData = (ingredients: string[], steps: string[], label: string) => {
    if (ingredients.length > 0) {
      setRawIngredients(ingredients.join('\n'));
    }
    if (steps.length > 0) {
      setRawSteps(steps.join('\n'));
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
          data.sourceMethod === 'json-ld' ? 'חילוץ מובנה (Schema Recipe)' : 'חילוץ דטרמיניסטי מ-HTML';
        applyExtractedData(data.ingredients || [], data.steps || [], methodText);
      }
    } catch {
      setImportStatus('שגיאה בחיבור לשרת המקומי.');
    } finally {
      setImporting(false);
    }
  };

  const startOrToggleTimer = (id: string, totalSeconds: number, label: string, sourceLabel: string) => {
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
            reminderSeconds: null,
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

  const handleCopyRecipe = () => {
    const text = parsedIngredients.map((item) => '• ' + item.displayText).join('\n');
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
              חילוץ מקישור או בלוג, התאמת מנות, המרה לגרמים וטיימרים מותאמים אישית — ללא AI
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

        {/* טיימר ידני מותאם אישית + תזכורת מוקדמת */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-bold text-lg">טיימר מותאם אישית ותזכורת מוקדמת</h2>
              <p className="text-xs text-stone-500">
                הגדירו שעות, דקות ושניות + התראה מקדימה בדקות (עד 60 דקות ולא מעבר לזמן הטיימר)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-stone-500 mb-1">
                שם הטיימר (אופציונלי)
              </label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="למשל: עוגה בתנור / פסטה"
                className="w-full px-3 py-2 border border-stone-300 rounded-xl text-sm focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="md:col-span-4 grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-semibold text-stone-500 text-center mb-1">
                  שעות
                </label>
                <input
                  type="number"
                  min={0}
                  max={24}
                  value={customHours}
                  onChange={(e) => setCustomHours(Math.max(0, Math.min(24, Number(e.target.value))))}
                  className="w-full px-2 py-2 border border-stone-300 rounded-xl text-center font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-500 text-center mb-1">
                  דקות
                </label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(Math.max(0, Math.min(59, Number(e.target.value))))}
                  className="w-full px-2 py-2 border border-stone-300 rounded-xl text-center font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-500 text-center mb-1">
                  שניות
                </label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={customSeconds}
                  onChange={(e) => setCustomSeconds(Math.max(0, Math.min(59, Number(e.target.value))))}
                  className="w-full px-2 py-2 border border-stone-300 rounded-xl text-center font-mono font-bold"
                />
              </div>
            </div>

            <div className="md:col-span-3 space-y-1">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 cursor-pointer">
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
                <span className="text-[11px] text-stone-400">
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
                  const clamped = Math.max(0, Math.min(maxAllowedReminderMinutes, isNaN(val) ? 0 : val));
                  setReminderMinutesInput(clamped);
                }}
                className="w-full px-3 py-2 border border-stone-300 disabled:bg-stone-100 disabled:text-stone-400 rounded-xl text-center font-mono font-semibold"
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
            <div className="text-xs font-medium text-red-600">{customTimerError}</div>
          )}
        </section>

        {/* סרגל טיימרים פעילים */}
        {activeTimerList.length > 0 && (
          <section className="bg-stone-900 text-white p-5 rounded-2xl shadow-md space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sm tracking-wide text-amber-400">
                טיימרים פעילים במטבח ({activeTimerList.length})
              </h2>
              <button
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
                      ? 'bg-red-950/90 border-red-500 animate-pulse'
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
                      onClick={() => removeTimer(t.id)}
                      className="text-xs text-stone-400 hover:text-red-400 px-1 cursor-pointer"
                      title="הסר טיימר"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="text-2xl font-mono font-bold">
                      {t.finished ? 'הזמן נגמר!' : formatSecondsClock(t.remaining)}
                    </div>
                    <div className="flex gap-1.5">
                      {t.finished ? (
                        <>
                          <button
                            onClick={() => removeTimer(t.id)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-bold text-xs cursor-pointer"
                          >
                            אוקיי - סגור
                          </button>
                          <button
                            onClick={() => startOrToggleTimer(t.id, t.total, t.label, t.sourceLabel)}
                            className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs cursor-pointer"
                          >
                            הפעל שוב
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startOrToggleTimer(t.id, t.total, t.label, t.sourceLabel)}
                            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs cursor-pointer"
                          >
                            {t.running ? 'השהה' : 'המשך'}
                          </button>
                          <button
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

        {/* מחלץ מתכון מקישור או טקסט ארוך */}
        {!cookingMode && (
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">חילוץ מתכון מקישור (URL) או טקסט בלוג ללא AI</h2>
              <button
                type="button"
                onClick={() => setImporterOpen(!importerOpen)}
                className="text-xs font-medium text-amber-700 hover:underline cursor-pointer"
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
                    className="flex-1 px-3.5 py-2.5 border border-stone-300 rounded-xl text-sm focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    disabled={importing}
                    onClick={handleExtractFromUrl}
                    className="px-5 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-white text-sm font-medium cursor-pointer"
                  >
                    {importing ? 'מחלץ קישור...' : 'חלץ מקישור'}
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-stone-500">
                    או הדבק טקסט ארוך / בלוג — המערכת תסנן סיפורים ותפריד מצרכים ושלבים לבד:
                  </label>
                  <textarea
                    rows={4}
                    value={longTextInput}
                    onChange={(e) => setLongTextInput(e.target.value)}
                    className="w-full p-3 border border-stone-300 rounded-xl text-sm focus:outline-none focus:border-amber-500"
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
                      <span className="text-xs font-medium text-emerald-700">{importStatus}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-stone-500 uppercase">
                התאמת מנות (פי {scaleFactor.toFixed(2).replace(/\.00$/, '')})
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
                  <h2 className="font-bold text-lg">1. מצרכים (עריכה ידנית או מחולצים)</h2>
                  <button
                    onClick={() => {
                      setRawIngredients('');
                      setRawSteps('');
                      setCheckedItems({});
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
                <h2 className="font-bold text-lg mb-2">2. שלבי הכנה</h2>
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
                                  onClick={() =>
                                    startOrToggleTimer(dt.id, dt.seconds, dt.label, 'שלב ' + step.stepNumber)
                                  }
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
