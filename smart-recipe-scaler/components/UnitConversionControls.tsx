'use client';

import React from 'react';
import { CONVERSION_UNITS, ConversionUnit } from '@/lib/unitConverter';

interface GlobalUnitBarProps {
  globalUnit: ConversionUnit;
  onChangeGlobalUnit: (unit: ConversionUnit) => void;
  hasOverrides: boolean;
  onResetAll: () => void;
  darkMode?: boolean;
}

export function GlobalUnitBar({
  globalUnit,
  onChangeGlobalUnit,
  hasOverrides,
  onResetAll,
  darkMode = false,
}: GlobalUnitBarProps) {
  return (
    <div
      dir="rtl"
      className={
        'mb-4 p-3 rounded-xl border space-y-2 ' +
        (darkMode
          ? 'bg-slate-800/70 border-slate-700'
          : 'bg-stone-50 border-stone-200')
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={
            'text-xs font-bold ' +
            (darkMode ? 'text-amber-400' : 'text-amber-700')
          }
        >
          המר את כל המצרכים ליחידת מידה:
        </span>
        {(globalUnit !== 'original' || hasOverrides) && (
          <button
            type="button"
            onClick={onResetAll}
            className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-300 border border-amber-500/30 transition cursor-pointer"
          >
            איפוס הכל למקורי
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CONVERSION_UNITS.map((u) => {
          const active = globalUnit === u.id;
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => onChangeGlobalUnit(u.id)}
              className={
                'px-2.5 py-1 rounded-lg text-xs font-semibold transition border cursor-pointer ' +
                (active
                  ? 'bg-amber-500 text-stone-950 border-amber-500 font-bold shadow-xs'
                  : darkMode
                  ? 'bg-slate-900/80 text-slate-300 border-slate-700 hover:border-amber-400/50 hover:text-white'
                  : 'bg-white text-stone-700 border-stone-200 hover:border-amber-400 hover:bg-amber-50/50')
              }
            >
              {u.label}
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
  darkMode?: boolean;
}

export function IngredientUnitSelect({
  value,
  isOverridden,
  onChange,
  darkMode = false,
}: IngredientUnitSelectProps) {
  return (
    <select
      dir="rtl"
      aria-label="בחר יחידת מידה למצרך"
      value={value}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        onChange(e.target.value as ConversionUnit);
      }}
      title={isOverridden ? 'יחידה מותאמת אישית למצרך זה' : 'המר מצרך זה בנפרד'}
      className={
        'shrink-0 text-xs font-semibold rounded-lg px-2 py-1 border focus:outline-none cursor-pointer transition ' +
        (isOverridden
          ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500 font-bold'
          : darkMode
          ? 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-500'
          : 'bg-white text-stone-700 border-stone-300 hover:border-amber-400')
      }
    >
      {CONVERSION_UNITS.map((u) => (
        <option
          key={u.id}
          value={u.id}
          className={darkMode ? 'bg-slate-900 text-slate-100' : 'bg-white text-stone-900'}
        >
          {u.label}
        </option>
      ))}
    </select>
  );
}
