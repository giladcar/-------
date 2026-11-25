'use client';

import React, { useState, useMemo } from 'react';
import {
  DEFAULT_CATEGORIES,
  SavedRecipeItem,
  BookExportScope,
  FIXED_PAGE_CAPACITY_LINES,
  buildFixedSizeBookPages,
} from '@/lib/recipeBook';
import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';
import { downloadStructuredRecipeBookPdf } from '@/lib/pdfBookExporter';

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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editCategory, setEditCategory] = useState<string>('');
  const [editSubCategory, setEditSubCategory] = useState<string>('');
  const [editOriginalServings, setEditOriginalServings] = useState<number>(4);
  const [editTargetServings, setEditTargetServings] = useState<number>(4);
  const [editIngredients, setEditIngredients] = useState<string>('');
  const [editSteps, setEditSteps] = useState<string>('');

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

  const { sheets, toc } = useMemo(
    () => buildFixedSizeBookPages(recipesForBook),
    [recipesForBook]
  );

  const scrollToSection = (elementId: string) => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(elementId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const buildBookPlainText = () => {
    if (sheets.length === 0) return 'אין מתכונים תואמים להצגה בספר המתכונים.';
    const lines: string[] = [
      '📖 ' + (bookTitle.trim() || 'ספר המתכונים שלי'),
      'עמוד 1 — כריכה ותוכן עניינים | גודל עמוד קבוע: ' +
        FIXED_PAGE_CAPACITY_LINES +
        ' שורות | תאריך: ' +
        generatedDateLabel,
      '====================================',
    ];

    for (const sheet of sheets) {
      lines.push(
        '\n--- עמוד ' + sheet.pageNumber + ' (' + sheet.usedLines + '/' + sheet.capacity + ') ---'
      );
      for (const blk of sheet.blocks) {
        if (blk.kind === 'category') {
          lines.push('📁 ' + blk.title + ' [עמוד ' + blk.pageNumber + ']');
        } else if (blk.kind === 'subcategory') {
          lines.push(
            '  📂 ' + blk.category + ' ← ' + blk.title + ' [עמוד ' + blk.pageNumber + ']'
          );
        } else if (blk.kind === 'recipe-part' && blk.recipe) {
          lines.push(
            '    • ' +
              blk.recipe.title +
              (blk.isContinuation ? ' (המשך)' : '') +
              ' [עמוד ' +
              blk.pageNumber +
              ']'
          );
          (blk.ingredients || []).forEach((ing) => lines.push('        * ' + ing));
          (blk.steps || []).forEach((st, i) => lines.push('        ' + (i + 1) + '. ' + st));
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
                            onClick={() => {
                              if (
                                typeof window === 'undefined' ||
                                window.confirm(
                                  'האם אתה בטוח שאתה רוצה למחוק את "' + rec.title + '"?'
                                )
                              ) {
                                onDeleteRecipe(rec.id);
                              }
                            }}
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

      {bookOpen && (
        <section className={'p-6 rounded-2xl shadow-md border space-y-6 ' + surfaceClass}>
          <div
            style={{ pageBreakAfter: 'always', breakAfter: 'page' }}
            className={
              'p-6 rounded-2xl border space-y-4 ' +
              (darkMode
                ? 'bg-gradient-to-b from-amber-500/15 to-slate-900 border-amber-500/30'
                : 'bg-gradient-to-b from-amber-50 to-white border-amber-200')
            }
          >
            <div className="flex items-center justify-between text-xs font-bold text-amber-500">
              <span>
                מהדורת ספר מתכונים • גודל עמוד קבוע ({FIXED_PAGE_CAPACITY_LINES} שורות לעמוד)
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15">עמוד 1</span>
            </div>

            <div className="text-center space-y-1.5 py-2">
              <h2 className="text-2xl md:text-3xl font-bold">
                {bookTitle.trim() || 'ספר המתכונים שלי'}
              </h2>
              <p className={mutedClass + ' text-xs'}>
                תאריך הפקה: {generatedDateLabel} • {recipesForBook.length} מתכונים • {sheets.length}{' '}
                עמודי תוכן • מידות:{' '}
                {measureSystem === 'us' ? 'אמריקאיות (cup / tbsp / oz)' : 'מטריות / ישראליות'}
              </p>
            </div>

            {toc.length > 0 && (
              <div
                className={
                  'p-4 rounded-xl border space-y-3 ' +
                  (darkMode ? 'bg-slate-900/80 border-slate-700' : 'bg-white border-amber-200/80')
                }
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-base">תוכן עניינים</h3>
                  <span className={mutedClass + ' text-xs'}>עמוד 1</span>
                </div>

                <div className="space-y-3">
                  {toc.map((cat) => (
                    <div
                      key={cat.category}
                      className="space-y-1.5 border-b border-stone-500/15 pb-2.5 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => scrollToSection(cat.categoryDomId)}
                          className="font-bold text-sm text-amber-500 hover:underline cursor-pointer text-right"
                        >
                          {cat.category}
                        </button>
                        <span className="text-xs font-bold text-amber-500">
                          עמוד {cat.categoryPage}
                        </span>
                      </div>

                      <ul className="space-y-1.5 pr-3 text-xs">
                        {cat.subCategories.map((sub) => (
                          <li key={sub.subCategory} className="space-y-1">
                            <div className="flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() => scrollToSection(sub.subDomId)}
                                className="font-semibold hover:underline cursor-pointer text-right"
                              >
                                {sub.subCategory} ({sub.recipes.length})
                              </button>
                              <span className={mutedClass + ' font-medium'}>
                                עמוד {sub.subPage}
                              </span>
                            </div>

                            <ul className="pr-4 space-y-0.5">
                              {sub.recipes.map((r) => (
                                <li
                                  key={r.id}
                                  className="flex items-center justify-between text-[11px]"
                                >
                                  <button
                                    type="button"
                                    onClick={() => scrollToSection(r.domId)}
                                    className={
                                      mutedClass + ' hover:underline cursor-pointer text-right'
                                    }
                                  >
                                    {r.favorite ? '⭐ ' : ''}
                                    {r.title}
                                  </button>
                                  <span className={mutedClass}>עמוד {r.pageNumber}</span>
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-500/20 pb-4">
            <span className={mutedClass + ' text-xs'}>
              גודל עמוד קבוע ({FIXED_PAGE_CAPACITY_LINES} שורות) • גלישה אוטומטית לעמוד הבא וכלל שבר בין מתכונים
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
                onClick={() =>
                  downloadStructuredRecipeBookPdf({
                    bookTitle: bookTitle.trim() || 'ספר המתכונים שלי',
                    dateLabel: generatedDateLabel,
                    scopeLabel:
                      exportScope === 'all'
                        ? 'הכל'
                        : exportScope === 'favorites'
                        ? 'רק מועדפים'
                        : 'רק נבחרים',
                    measureSystem,
                    sheets,
                    toc,
                  })
                }
                className={
                  'px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer ' +
                  (darkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-stone-100 border-stone-200 text-stone-800 hover:bg-stone-200')
                }
              >
                הורד קובץ PDF מסודר
              </button>
            </div>
          </div>

          {sheets.length === 0 ? (
            <div className={mutedClass + ' text-sm py-6 text-center'}>
              אין מתכונים להצגה עבור הבחירה הנוכחית.
            </div>
          ) : (
            <div className="space-y-6">
              {sheets.map((sheet) => (
                <div
                  key={sheet.pageNumber}
                  style={{
                    height: '540px',
                    overflow: 'hidden',
                    pageBreakAfter: 'always',
                    breakAfter: 'page',
                  }}
                  className={
                    'p-5 rounded-2xl border flex flex-col justify-between ' +
                    (darkMode
                      ? 'bg-slate-800/40 border-slate-700'
                      : 'bg-stone-50/70 border-stone-300')
                  }
                >
                  <div className="space-y-3 overflow-hidden">
                    <div className="flex items-center justify-between border-b border-stone-500/20 pb-2 text-xs">
                      <span className="font-bold text-amber-500">עמוד {sheet.pageNumber}</span>
                      <span className={mutedClass + ' font-mono'}>
                        גודל קבוע: {sheet.usedLines}/{sheet.capacity} שורות ({sheet.fillFraction})
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {sheet.blocks.map((blk, bIdx) => {
                        if (blk.kind === 'category') {
                          return (
                            <div
                              key={blk.domId + '-' + bIdx}
                              id={blk.domId}
                              className="text-base font-bold text-amber-500 border-r-4 border-amber-500 pr-2.5"
                            >
                              {blk.title} — עמוד {blk.pageNumber}
                            </div>
                          );
                        }
                        if (blk.kind === 'subcategory') {
                          return (
                            <div
                              key={blk.domId + '-' + bIdx}
                              id={blk.domId}
                              className="text-xs font-bold pr-3"
                            >
                              {blk.category} ← {blk.title} (עמוד {blk.pageNumber})
                            </div>
                          );
                        }
                        if (blk.kind === 'recipe-part' && blk.recipe) {
                          const rec = blk.recipe;
                          const factor =
                            rec.originalServings > 0
                              ? rec.targetServings / rec.originalServings
                              : 1;
                          const ings = (blk.ingredients || []).map(
                            (l) =>
                              parseAndScaleLine(
                                l,
                                factor,
                                rec.dietMode,
                                rec.convertToGrams,
                                measureSystem
                              ).displayText
                          );
                          const steps = blk.steps || [];

                          return (
                            <article
                              key={blk.domId + '-' + bIdx}
                              id={blk.domId}
                              className={
                                'p-3 rounded-xl border space-y-1.5 ' +
                                (darkMode
                                  ? 'bg-slate-900 border-slate-800'
                                  : 'bg-white border-stone-200')
                              }
                            >
                              <div className="flex items-center justify-between gap-2">
                                <h5 className="font-bold text-sm">
                                  {rec.favorite ? '⭐ ' : ''}
                                  {rec.title}
                                  {blk.isContinuation ? ' (המשך)' : ''}
                                </h5>
                                <span className={mutedClass + ' text-[11px]'}>
                                  {rec.targetServings} מנות • עמוד {blk.pageNumber}
                                </span>
                              </div>

                              {ings.length > 0 && (
                                <ul className="list-disc list-inside text-[11px] space-y-0.5">
                                  {ings.map((line, i) => (
                                    <li key={i}>{line}</li>
                                  ))}
                                </ul>
                              )}

                              {steps.length > 0 && (
                                <ol className="list-decimal list-inside text-[11px] space-y-0.5">
                                  {steps.map((st, i) => (
                                    <li key={i}>{st}</li>
                                  ))}
                                </ol>
                              )}
                            </article>
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>

                  <div
                    className={
                      mutedClass +
                      ' pt-2 border-t border-stone-500/15 text-[11px] flex justify-between'
                    }
                  >
                    <span>{bookTitle.trim() || 'ספר המתכונים שלי'}</span>
                    <span className="font-bold">עמוד {sheet.pageNumber}</span>
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
