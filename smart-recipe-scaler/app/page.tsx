'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { parseAndScaleLine, DietMode } from '@/lib/recipeEngine';

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
  'מחממים תנור ל-180 מעלות ומשמנים תבנית.',
  'מערבבים בקערה את הביצים, הסוכר, השמן והחלב עד לקבלת תערובת אחידה.',
  'מוסיפים את הקמח, אבקת האפייה והמלח ומערבבים רק עד לאיחוד.',
  'אופים כ-35 דקות עד שקיסם יוצא יבש.',
].join('\n');

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

  const stepsList = useMemo(() => {
    return rawSteps
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [rawSteps]);

  const toggleCheck = (key: string) => {
    setCheckedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCopyRecipe = () => {
    const text = parsedIngredients.map((item) => '• ' + item.displayText).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main dir="rtl" className="min-h-screen bg-stone-50 text-stone-900 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-stone-900">
              ממיר מתכונים חכם
            </h1>
            <p className="text-stone-500 text-sm mt-1">
              התאמת כמויות, המרה לגרמים והחלפת רכיבים תזונתית — חישוב מיידי ללא AI
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
                  <h2 className="font-bold text-lg">1. הדבקת מצרכים</h2>
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
                <h2 className="font-bold text-lg mb-2">2. שלבי הכנה (אופציונלי)</h2>
                <textarea
                  rows={5}
                  value={rawSteps}
                  onChange={(e) => setRawSteps(e.target.value)}
                  placeholder="הדביקו כאן את הוראות ההכנה..."
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

            {stepsList.length > 0 && (
              <div className="pt-4 border-t border-stone-200">
                <h2 className="font-bold text-lg mb-3">שלבי הכנה</h2>
                <ol className="space-y-3">
                  {stepsList.map((step, idx) => {
                    const key = 'step-' + idx;
                    const isChecked = !!checkedItems[key];
                    return (
                      <li
                        key={key}
                        onClick={() => toggleCheck(key)}
                        className={
                          'p-3.5 rounded-xl border transition-all cursor-pointer flex gap-3 items-start ' +
                          (isChecked
                            ? 'bg-stone-50 border-stone-200 text-stone-400 line-through'
                            : 'bg-white border-stone-200 hover:border-stone-300')
                        }
                      >
                        <span className="w-6 h-6 rounded-full bg-stone-900 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="text-sm leading-relaxed">{step}</span>
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
