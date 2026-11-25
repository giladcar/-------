'use client';

import React, { useState, useMemo } from 'react';
import {
  DEFAULT_CATEGORIES,
  SavedRecipeItem,
  BookExportScope,
  groupRecipesByCategory,
} from '@/lib/recipeBook';
import { parseAndScaleLine } from '@/lib/recipeEngine';

interface RecipeBookVaultProps {
  savedRecipes: SavedRecipeItem[];
  onSaveCurrentRecipe: (meta: {
    title: string;
    category: string;
    subCategory: string;
    favorite: boolean;
  }) => void;
  onLoadRecipeToScaler: (item: SavedRecipeItem) => void;
  onToggleFavorite: (id: string) => void;
  onDeleteRecipe: (id: string) => void;
  onUpdateRecipeCategory: (id: string, category: string, subCategory: string) => void;
  darkMode: boolean;
}

export default function RecipeBookVault({
  savedRecipes,
  onSaveCurrentRecipe,
  onLoadRecipeToScaler,
  onToggleFavorite,
  onDeleteRecipe,
  onUpdateRecipeCategory,
  darkMode,
}: RecipeBookVaultProps) {
  const [newTitle, setNewTitle] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('קינוחים');
  const [customCategory, setCustomCategory] = useState<string>('');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>('עוגות');
  const [customSubCategory, setCustomSubCategory] = useState<string>('');
  const [newFavorite, setNewFavorite] = useState<boolean>(false);

  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [exportScope, setExportScope] = useState<BookExportScope>('all');
  const [bookOpen, setBookOpen] = useState<boolean>(false);
  const [copiedBook, setCopiedBook] = useState<boolean>(false);

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

  const buildBookPlainText = () => {
    if (groupedBook.length === 0) return 'אין מתכונים תואמים להצגה בספר המתכונים.';
    const lines: string[] = ['📖 ספר המתכונים שלי', '===================================='];

    for (const catGroup of groupedBook) {
      lines.push('\n📁 ' + catGroup.category);
      for (const subGroup of catGroup.subGroups) {
        lines.push('  📂 ' + subGroup.subCategory);
        for (const rec of subGroup.recipes) {
          const factor = rec.originalServings > 0 ? rec.targetServings / rec.originalServings : 1;
          const scaledIngs = rec.rawIngredients
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => '      • ' + parseAndScaleLine(l, factor, rec.dietMode, rec.convertToGrams).displayText);
          const steps = rec.rawSteps
            .split('\n')
            .filter((l) => l.trim())
            .map((s, i) => '      ' + (i + 1) + '. ' + s.trim());

          lines.push('    • ' + (rec.favorite ? '⭐ ' : '') + rec.title + ' (' + rec.targetServings + ' מנות)');
          lines.push('      מצרכים:');
          lines.push(...scaledIngs);
          if (steps.length > 0) {
            lines.push('      אופן ההכנה:');
            lines.push(...steps);
          }
        }
      }
    }

    return lines.join('\n');
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
                const firstSub = (DEFAULT_CATEGORIES[nextCat] && DEFAULT_CATEGORIES[nextCat][0]) || 'כללי';
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

      {/* רשימת מתכונים שמורים, מועדפים, בחירה ומחיקה */}
      <section className={'p-6 rounded-2xl shadow-sm border space-y-4 ' + surfaceClass}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-lg">
              מתכונים שמורים ({savedRecipes.length}) • מועדפים ({savedRecipes.filter((r) => r.favorite).length})
            </h2>
            <p className={mutedClass + ' text-xs'}>
              סמן תיבת בחירה למתכונים שתרצה לכלול בייצוא &ldquo;רק נבחרים&rdquo;, או סמן ⭐ למועדפים
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
              return (
                <div
                  key={rec.id}
                  className={
                    'p-4 rounded-xl border flex flex-col justify-between gap-3 ' +
                    (darkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-stone-50/70 border-stone-200')
                  }
                >
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
                              (darkMode ? 'bg-slate-700 text-slate-300' : 'bg-stone-200/80 text-stone-700')
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

                    <div className="flex items-center gap-1.5">
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
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* תצוגת ספר המתכונים הממוין לפי קטגוריות ותתי-קטגוריות */}
      {bookOpen && (
        <section className={'p-6 rounded-2xl shadow-md border space-y-5 ' + surfaceClass}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-500/20 pb-4">
            <div>
              <h2 className="text-xl font-bold">
                ספר מתכונים (
                {exportScope === 'all'
                  ? 'הכל'
                  : exportScope === 'favorites'
                  ? 'רק מועדפים'
                  : 'רק נבחרים'}
                )
              </h2>
              <p className={mutedClass + ' text-xs mt-0.5'}>
                ממוין אוטומטית לפי קטגוריה ותת-קטגוריה ({recipesForBook.length} מתכונים)
              </p>
            </div>

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
              {groupedBook.map((catGroup) => (
                <div key={catGroup.category} className="space-y-4">
                  <h3 className="text-lg font-bold text-amber-500 border-r-4 border-amber-500 pr-3">
                    {catGroup.category}
                  </h3>

                  <div className="space-y-4 pr-3">
                    {catGroup.subGroups.map((subGroup) => (
                      <div
                        key={catGroup.category + '-' + subGroup.subCategory}
                        className={
                          'p-4 rounded-xl border space-y-3 ' +
                          (darkMode ? 'bg-slate-800/40 border-slate-700/80' : 'bg-amber-50/20 border-amber-200/70')
                        }
                      >
                        <h4 className="font-bold text-sm">
                          {catGroup.category} — {subGroup.subCategory} ({subGroup.recipes.length})
                        </h4>

                        <div className="space-y-3">
                          {subGroup.recipes.map((rec) => {
                            const factor =
                              rec.originalServings > 0 ? rec.targetServings / rec.originalServings : 1;
                            const ings = rec.rawIngredients
                              .split('\n')
                              .filter((l) => l.trim())
                              .map(
                                (l) =>
                                  parseAndScaleLine(l, factor, rec.dietMode, rec.convertToGrams)
                                    .displayText
                              );
                            const steps = rec.rawSteps
                              .split('\n')
                              .map((s) => s.trim())
                              .filter(Boolean);

                            return (
                              <article
                                key={rec.id}
                                className={
                                  'p-4 rounded-xl border space-y-2 ' +
                                  (darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-stone-200')
                                }
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <h5 className="font-bold text-base">
                                    {rec.favorite ? '⭐ ' : ''}
                                    {rec.title}
                                  </h5>
                                  <span className={mutedClass + ' text-xs'}>{rec.targetServings} מנות</span>
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
