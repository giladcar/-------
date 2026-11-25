import fs from 'node:fs';
import path from 'node:path';

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

// גודל עמוד קבוע (מספר שורות מקסימלי לעמוד - לא ניתן להקטנה או הגדלה ידנית)
export const FIXED_PAGE_CAPACITY_LINES = 24;

export interface BookPageBlock {
  kind: 'category' | 'subcategory' | 'recipe-part';
  title: string;
  pageNumber: number;
  domId: string;
  category: string;
  subCategory: string;
  recipe?: SavedRecipeItem;
  ingredients?: string[];
  steps?: string[];
  isContinuation?: boolean;
}

export interface BookPageSheet {
  pageNumber: number;
  capacity: number;
  usedLines: number;
  fillFraction: number;
  blocks: BookPageBlock[];
}

export interface TocEntry {
  category: string;
  categoryPage: number;
  categoryDomId: string;
  subCategories: Array<{
    subCategory: string;
    subPage: number;
    subDomId: string;
    recipes: Array<{
      id: string;
      title: string;
      favorite: boolean;
      pageNumber: number;
      domId: string;
    }>;
  }>;
}

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

function estimateLinesForLinesArray(lines: string[], charsPerLine = 46): number {
  let total = 0;
  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;
    total += Math.max(1, Math.ceil(clean.length / charsPerLine));
  }
  return total;
}

export function buildFixedSizeBookPages(items: SavedRecipeItem[]): {
  sheets: BookPageSheet[];
  toc: TocEntry[];
} {
  const groups = groupRecipesByCategory(items);
  const cap = FIXED_PAGE_CAPACITY_LINES;

  const sheets: BookPageSheet[] = [];
  let pageNum = 2; // עמוד 1 הוא הכריכה ותוכן העניינים

  const createSheet = (pNum: number): BookPageSheet => ({
    pageNumber: pNum,
    capacity: cap,
    usedLines: 0,
    fillFraction: 0,
    blocks: [],
  });

  let currentSheet = createSheet(pageNum);

  const finalizeAndPushSheet = (sheet: BookPageSheet) => {
    sheet.fillFraction = Number((sheet.usedLines / cap).toFixed(2));
    sheets.push(sheet);
  };

  const advanceToNextSheet = () => {
    finalizeAndPushSheet(currentSheet);
    pageNum += 1;
    currentSheet = createSheet(pageNum);
  };

  const ensureLinesOnCurrentSheet = (neededLines: number) => {
    const cost = Math.min(cap, Math.max(1, neededLines));
    if (currentSheet.usedLines > 0 && currentSheet.usedLines + cost > cap) {
      advanceToNextSheet();
    }
  };

  const toc: TocEntry[] = [];

  groups.forEach((catGroup, cIdx) => {
    const catDomId = 'book-cat-' + cIdx;
    ensureLinesOnCurrentSheet(3);
    const catPage = currentSheet.pageNumber;
    currentSheet.blocks.push({
      kind: 'category',
      title: catGroup.category,
      pageNumber: catPage,
      domId: catDomId,
      category: catGroup.category,
      subCategory: '',
    });
    currentSheet.usedLines = Math.min(cap, currentSheet.usedLines + 3);

    const tocSubList: TocEntry['subCategories'] = [];

    catGroup.subGroups.forEach((subGroup, sIdx) => {
      const subDomId = 'book-sub-' + cIdx + '-' + sIdx;
      ensureLinesOnCurrentSheet(2);
      const subPage = currentSheet.pageNumber;
      currentSheet.blocks.push({
        kind: 'subcategory',
        title: subGroup.subCategory,
        pageNumber: subPage,
        domId: subDomId,
        category: catGroup.category,
        subCategory: subGroup.subCategory,
      });
      currentSheet.usedLines = Math.min(cap, currentSheet.usedLines + 2);

      const tocRecipeList: TocEntry['subCategories'][number]['recipes'] = [];

      subGroup.recipes.forEach((rec, rIdx) => {
        // כלל השבר: אם העמוד הנוכחי כבר מכיל תוכן והשימוש בו הוא חלקי/שברי (לא 0 ולא עמוד שלם מלא בדיוק),
        // המתכון הבא עובר לעמוד הבא
        const currentFraction = currentSheet.usedLines / cap;
        const isFractionalRemainder =
          currentSheet.usedLines > 0 && currentFraction > 0 && currentFraction < 1 && Math.abs(currentFraction - Math.round(currentFraction)) > 0.001;
        if (isFractionalRemainder) {
          advanceToNextSheet();
        }

        const recDomId = 'book-rec-' + cIdx + '-' + sIdx + '-' + rIdx;
        const recStartPage = currentSheet.pageNumber;

        const allIngs = rec.rawIngredients
          .split('\\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const allSteps = rec.rawSteps
          .split('\\n')
          .map((l) => l.trim())
          .filter(Boolean);

        let ingCursor = 0;
        let stepCursor = 0;
        let partIndex = 0;

        while (partIndex === 0 || ingCursor < allIngs.length || stepCursor < allSteps.length) {
          if (currentSheet.usedLines >= cap) {
            advanceToNextSheet();
          }

          const available = cap - currentSheet.usedLines;
          const headerCost = 3;
          if (available <= headerCost) {
            advanceToNextSheet();
          }

          let budget = cap - currentSheet.usedLines - headerCost;
          const partIngs: string[] = [];
          const partSteps: string[] = [];

          while (ingCursor < allIngs.length) {
            const lineCost = Math.max(1, Math.ceil(allIngs[ingCursor].length / 46));
            if (partIngs.length > 0 && budget < lineCost) break;
            if (budget < lineCost && partIngs.length === 0 && partSteps.length > 0) break;
            partIngs.push(allIngs[ingCursor]);
            budget = Math.max(0, budget - lineCost);
            ingCursor += 1;
          }

          while (stepCursor < allSteps.length) {
            const lineCost = Math.max(1, Math.ceil(allSteps[stepCursor].length / 46));
            if (partSteps.length > 0 && budget < lineCost) break;
            if (budget < lineCost && (partIngs.length > 0 || partSteps.length > 0)) break;
            partSteps.push(allSteps[stepCursor]);
            budget = Math.max(0, budget - lineCost);
            stepCursor += 1;
          }

          const actualUsed =
            headerCost +
            estimateLinesForLinesArray(partIngs) +
            estimateLinesForLinesArray(partSteps);

          currentSheet.blocks.push({
            kind: 'recipe-part',
            title: rec.title,
            pageNumber: currentSheet.pageNumber,
            domId: partIndex === 0 ? recDomId : recDomId + '-p' + partIndex,
            category: catGroup.category,
            subCategory: subGroup.subCategory,
            recipe: rec,
            ingredients: partIngs,
            steps: partSteps,
            isContinuation: partIndex > 0,
          });

          currentSheet.usedLines = Math.min(cap, currentSheet.usedLines + Math.max(1, actualUsed));
          partIndex += 1;

          // אם נשארו עוד חלקים למתכון הזה, עוברים לעמוד הבא
          if (ingCursor < allIngs.length || stepCursor < allSteps.length) {
            advanceToNextSheet();
          }
        }

        tocRecipeList.push({
          id: rec.id,
          title: rec.title,
          favorite: rec.favorite,
          pageNumber: recStartPage,
          domId: recDomId,
        });

        // אחרי סיום מתכון, אם העמוד יצא עם שבר (למשל 0.7 או 1.4), המתכון הבא יעבור לעמוד הבא
        const afterRecipeFraction = currentSheet.usedLines / cap;
        if (currentSheet.usedLines > 0 && afterRecipeFraction % 1 !== 0) {
          advanceToNextSheet();
        }
      });

      tocSubList.push({
        subCategory: subGroup.subCategory,
        subPage,
        subDomId,
        recipes: tocRecipeList,
      });
    });

    toc.push({
      category: catGroup.category,
      categoryPage: catPage,
      categoryDomId: catDomId,
      subCategories: tocSubList,
    });
  });

  if (currentSheet.blocks.length > 0 || sheets.length === 0) {
    finalizeAndPushSheet(currentSheet);
  }

  return { sheets, toc };
}
`;

const pdfExportHelperCode = `import { BookPageSheet, TocEntry, FIXED_PAGE_CAPACITY_LINES } from '@/lib/recipeBook';
import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';

function escapePdfText(text: string): string {
  return text
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/\\(/g, '\\\\(')
    .replace(/\\)/g, '\\\\)')
    .replace(/[^\\x20-\\x7E]/g, '?');
}

export function downloadStructuredRecipeBookPdf(params: {
  bookTitle: string;
  dateLabel: string;
  scopeLabel: string;
  measureSystem: MeasureSystem;
  sheets: BookPageSheet[];
  toc: TocEntry[];
}): void {
  const { bookTitle, dateLabel, scopeLabel, measureSystem, sheets, toc } = params;

  const pdfPages: string[][] = [];

  const tocLines: string[] = [
    'PAGE 1 - FIXED CAPACITY (' + FIXED_PAGE_CAPACITY_LINES + ' lines/page)',
    'Book: ' + bookTitle,
    'Scope: ' + scopeLabel + ' | Date: ' + dateLabel + ' | Units: ' + measureSystem.toUpperCase(),
    '------------------------------------------------------------------------',
  ];

  for (const cat of toc) {
    tocLines.push('Category: ' + cat.category + ' [Page ' + cat.categoryPage + ']');
    for (const sub of cat.subCategories) {
      tocLines.push('  Subcategory: ' + sub.subCategory + ' [Page ' + sub.subPage + ']');
      for (const r of sub.recipes) {
        tocLines.push('    - ' + r.title + ' [Page ' + r.pageNumber + ']');
      }
    }
  }
  pdfPages.push(tocLines);

  for (const sheet of sheets) {
    const lines: string[] = [
      'PAGE ' +
        sheet.pageNumber +
        ' | Fixed Size: ' +
        sheet.usedLines +
        '/' +
        sheet.capacity +
        ' (' +
        sheet.fillFraction +
        ')',
      '------------------------------------------------------------------------',
    ];

    for (const blk of sheet.blocks) {
      if (blk.kind === 'category') {
        lines.push('[Category] ' + blk.title + ' (Page ' + blk.pageNumber + ')');
      } else if (blk.kind === 'subcategory') {
        lines.push('  [Subcategory] ' + blk.category + ' / ' + blk.title + ' (Page ' + blk.pageNumber + ')');
      } else if (blk.kind === 'recipe-part' && blk.recipe) {
        const rec = blk.recipe;
        const factor = rec.originalServings > 0 ? rec.targetServings / rec.originalServings : 1;
        lines.push(
          '  Recipe: ' +
            rec.title +
            (blk.isContinuation ? ' (cont.)' : '') +
            ' [' +
            rec.targetServings +
            ' servings]'
        );
        if (blk.ingredients && blk.ingredients.length > 0) {
          for (const ing of blk.ingredients) {
            const scaled = parseAndScaleLine(
              ing,
              factor,
              rec.dietMode,
              rec.convertToGrams,
              measureSystem
            ).displayText;
            lines.push('    * ' + scaled);
          }
        }
        if (blk.steps && blk.steps.length > 0) {
          for (const st of blk.steps) {
            lines.push('    - ' + st);
          }
        }
      }
    }

    pdfPages.push(lines);
  }

  const objects: string[] = [];
  const addObj = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObj('');
  const pagesId = addObj('');
  const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageObjIds: number[] = [];

  for (let i = 0; i < pdfPages.length; i++) {
    const contentLines = pdfPages[i];
    const streamParts: string[] = ['BT', '/F1 10.5 Tf', '48 760 Td', '14 TL'];

    contentLines.slice(0, FIXED_PAGE_CAPACITY_LINES + 6).forEach((line, idx) => {
      const safe = escapePdfText(line);
      if (idx === 0) {
        streamParts.push('(' + safe + ') Tj');
      } else {
        streamParts.push('T* (' + safe + ') Tj');
      }
    });

    streamParts.push('ET');
    const streamData = streamParts.join('\\n');
    const contentId = addObj(
      '<< /Length ' + streamData.length + ' >>\\nstream\\n' + streamData + '\\nendstream'
    );
    const pageId = addObj(
      '<< /Type /Page /Parent ' +
        pagesId +
        ' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ' +
        fontId +
        ' 0 R >> >> /Contents ' +
        contentId +
        ' 0 R >>'
    );
    pageObjIds.push(pageId);
  }

  objects[catalogId - 1] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>';
  objects[pagesId - 1] =
    '<< /Type /Pages /Kids [' +
    pageObjIds.map((id) => id + ' 0 R').join(' ') +
    '] /Count ' +
    pageObjIds.length +
    ' >>';

  let pdf = '%PDF-1.4\\n';
  const offsets: number[] = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += i + 1 + ' 0 obj\\n' + objects[i] + '\\nendobj\\n';
  }

  const xrefStart = pdf.length;
  pdf += 'xref\\n0 ' + (objects.length + 1) + '\\n';
  pdf += '0000000000 65535 f \\n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \\n';
  }

  pdf +=
    'trailer\\n<< /Size ' +
    (objects.length + 1) +
    ' /Root ' +
    catalogId +
    ' 0 R >>\\nstartxref\\n' +
    xrefStart +
    '\\n%%EOF';

  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeFileName = (bookTitle.trim() || 'recipe-book').replace(/[^a-zA-Z0-9_-]+/g, '-');
  link.href = url;
  link.download = safeFileName + '.pdf';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
`;

const vaultBookSectionReplacement = `{bookOpen && (
        <section className={'p-6 rounded-2xl shadow-md border space-y-6 ' + surfaceClass}>
          {/* עמוד 1: כריכה ותוכן עניינים עם גודל עמוד קבוע */}
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
              אין מתכונים להצגה עבור הבחירה הנוכית.
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
      )}`;

const vaultPath = path.join(process.cwd(), 'components', 'RecipeBookVault.tsx');

fs.mkdirSync(path.join(process.cwd(), 'lib'), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), 'lib', 'recipeBook.ts'), recipeBookLibCode, 'utf8');
fs.writeFileSync(path.join(process.cwd(), 'lib', 'pdfBookExporter.ts'), pdfExportHelperCode, 'utf8');

if (fs.existsSync(vaultPath)) {
  let content = fs.readFileSync(vaultPath, 'utf8');

  content = content.replace(
    /import \{[\s\S]*?\} from '@\/lib\/recipeBook';/,
    `import {
  DEFAULT_CATEGORIES,
  SavedRecipeItem,
  BookExportScope,
  FIXED_PAGE_CAPACITY_LINES,
  buildFixedSizeBookPages,
} from '@/lib/recipeBook';`
  );

  if (!content.includes('downloadStructuredRecipeBookPdf')) {
    content = content.replace(
      "import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';",
      "import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';\nimport { downloadStructuredRecipeBookPdf } from '@/lib/pdfBookExporter';"
    );
  }

  content = content.replace(
    /const groupedBook = useMemo\(\(\) => groupRecipesByCategory\(recipesForBook\), \[recipesForBook\]\);/,
    `const { sheets, toc } = useMemo(
    () => buildFixedSizeBookPages(recipesForBook),
    [recipesForBook]
  );`
  );

  content = content.replace(
    /const buildBookPlainText = \(\) => \{[\s\S]*?return lines\.join\('\\\\n'\);\n  \};/,
    `const buildBookPlainText = () => {
    if (sheets.length === 0) return 'אין מתכונים תואמים להצגה בספר המתכונים.';
    const lines: string[] = [
      '📖 ' + (bookTitle.trim() || 'ספר המתכונים שלי'),
      'עמוד 1 — כריכה ותוכן עניינים | גודל עמוד קבוע: ' + FIXED_PAGE_CAPACITY_LINES + ' שורות | תאריך: ' + generatedDateLabel,
      '====================================',
    ];

    for (const sheet of sheets) {
      lines.push('\\n--- עמוד ' + sheet.pageNumber + ' (' + sheet.usedLines + '/' + sheet.capacity + ') ---');
      for (const blk of sheet.blocks) {
        if (blk.kind === 'category') {
          lines.push('📁 ' + blk.title + ' [עמוד ' + blk.pageNumber + ']');
        } else if (blk.kind === 'subcategory') {
          lines.push('  📂 ' + blk.category + ' ← ' + blk.title + ' [עמוד ' + blk.pageNumber + ']');
        } else if (blk.kind === 'recipe-part' && blk.recipe) {
          lines.push('    • ' + blk.recipe.title + (blk.isContinuation ? ' (המשך)' : '') + ' [עמוד ' + blk.pageNumber + ']');
          (blk.ingredients || []).forEach((ing) => lines.push('        * ' + ing));
          (blk.steps || []).forEach((st, i) => lines.push('        ' + (i + 1) + '. ' + st));
        }
      }
    }

    return lines.join('\\\\n');
  };`
  );

  const bookStartIdx = content.indexOf('{bookOpen && (');
  const finalReturnIdx = content.lastIndexOf('    </div>\n  );\n}');
  if (bookStartIdx !== -1 && finalReturnIdx !== -1) {
    content =
      content.slice(0, bookStartIdx) +
      vaultBookSectionReplacement +
      '\n' +
      content.slice(finalReturnIdx);
  }

  fs.writeFileSync(vaultPath, content, 'utf8');
}

console.log('עודכן בהצלחה דרך update-fixed-pages.mjs: גודל עמוד קבוע, גלישה אוטומטית לעמוד הבא וכלל שבר בין מתכונים.');