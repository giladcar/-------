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

// גודל דף קבוע ביחס דף PDF (A4) ובמכסת שורות קבועה
export const FIXED_PAGE_CAPACITY_LINES = 32;

export interface BookPageBlock {
  kind: 'category-banner' | 'subcategory-banner' | 'recipe-part';
  title: string;
  pageNumber: number;
  domId: string;
  category: string;
  subCategory: string;
  recipeCount?: number;
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

function estimateLinesForLinesArray(lines: string[], charsPerLine = 42): number {
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
    if (currentSheet.blocks.length > 0) {
      finalizeAndPushSheet(currentSheet);
      pageNum += 1;
      currentSheet = createSheet(pageNum);
    }
  };

  const toc: TocEntry[] = [];

  groups.forEach((catGroup, cIdx) => {
    const catDomId = 'book-cat-' + cIdx;

    // כותרת קטגוריה ראשית מופיעה ככותרת גדולה על דף משלה
    if (currentSheet.blocks.length > 0) {
      advanceToNextSheet();
    }
    const catPage = currentSheet.pageNumber;
    const totalCatRecipes = catGroup.subGroups.reduce((acc, sg) => acc + sg.recipes.length, 0);

    currentSheet.blocks.push({
      kind: 'category-banner',
      title: catGroup.category,
      pageNumber: catPage,
      domId: catDomId,
      category: catGroup.category,
      subCategory: '',
      recipeCount: totalCatRecipes,
    });
    currentSheet.usedLines = cap;
    advanceToNextSheet();

    const tocSubList: TocEntry['subCategories'] = [];

    catGroup.subGroups.forEach((subGroup, sIdx) => {
      const subDomId = 'book-sub-' + cIdx + '-' + sIdx;

      // כותרת תת-קטגוריה מופיעה ככותרת בולטת על דף משלה
      if (currentSheet.blocks.length > 0) {
        advanceToNextSheet();
      }
      const subPage = currentSheet.pageNumber;
      currentSheet.blocks.push({
        kind: 'subcategory-banner',
        title: subGroup.subCategory,
        pageNumber: subPage,
        domId: subDomId,
        category: catGroup.category,
        subCategory: subGroup.subCategory,
        recipeCount: subGroup.recipes.length,
      });
      currentSheet.usedLines = cap;
      advanceToNextSheet();

      const tocRecipeList: TocEntry['subCategories'][number]['recipes'] = [];

      subGroup.recipes.forEach((rec, rIdx) => {
        // כלל השבר: אם העמוד הנוכחי כבר מכיל תוכן ומסתיים עם שבר (לא עמוד שלם מלא בדיוק),
        // המתכון הבא עובר לעמוד הבא
        const currentFraction = currentSheet.usedLines / cap;
        const isFractionalRemainder =
          currentSheet.usedLines > 0 &&
          currentFraction > 0 &&
          currentFraction < 1 &&
          currentFraction % 1 !== 0;

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

          const headerCost = 3;
          if (cap - currentSheet.usedLines <= headerCost && currentSheet.blocks.length > 0) {
            advanceToNextSheet();
          }

          let budget = Math.max(1, cap - currentSheet.usedLines - headerCost);
          const partIngs: string[] = [];
          const partSteps: string[] = [];

          while (ingCursor < allIngs.length) {
            const lineCost = Math.max(1, Math.ceil(allIngs[ingCursor].length / 42));
            if (partIngs.length > 0 && budget < lineCost) break;
            if (budget < lineCost && partIngs.length === 0 && partSteps.length > 0) break;
            partIngs.push(allIngs[ingCursor]);
            budget = Math.max(0, budget - lineCost);
            ingCursor += 1;
          }

          while (stepCursor < allSteps.length) {
            const lineCost = Math.max(1, Math.ceil(allSteps[stepCursor].length / 42));
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

  if (currentSheet.blocks.length > 0) {
    finalizeAndPushSheet(currentSheet);
  }

  return { sheets, toc };
}
`;

const vaultPath = path.join(process.cwd(), 'components', 'RecipeBookVault.tsx');

fs.mkdirSync(path.join(process.cwd(), 'lib'), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), 'lib', 'recipeBook.ts'), recipeBookLibCode, 'utf8');

if (fs.existsSync(vaultPath)) {
  let content = fs.readFileSync(vaultPath, 'utf8');

  content = content.replace(
    /const buildBookPlainText = \(\) => \{[\s\S]*?return lines\.join\('\\\\n'\);\n  \};/,
    `const buildBookPlainText = () => {
    if (sheets.length === 0) return 'אין מתכונים תואמים להצגה בספר המתכונים.';
    const lines: string[] = [
      '📖 ' + (bookTitle.trim() || 'ספר המתכונים שלי'),
      'עמוד 1 — כריכה ותוכן עניינים | גודל דף קבוע (A4 / ' +
        FIXED_PAGE_CAPACITY_LINES +
        ' שורות) | תאריך: ' +
        generatedDateLabel,
      '====================================',
    ];

    for (const sheet of sheets) {
      lines.push(
        '\\n--- עמוד ' + sheet.pageNumber + ' (' + sheet.usedLines + '/' + sheet.capacity + ') ---'
      );
      for (const blk of sheet.blocks) {
        if (blk.kind === 'category-banner') {
          lines.push('=== ' + blk.title + ' [עמוד ' + blk.pageNumber + '] ===');
        } else if (blk.kind === 'subcategory-banner') {
          lines.push('  == ' + blk.category + ' ← ' + blk.title + ' [עמוד ' + blk.pageNumber + '] ==');
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

    return lines.join('\\\\n');
  };`
  );

  const sheetsRenderStart = content.indexOf('{sheets.map((sheet) => (');
  const sheetsRenderEnd = content.indexOf('            </div>\n          )}\n        </section>\n      )}');

  if (sheetsRenderStart !== -1 && sheetsRenderEnd !== -1) {
    const newSheetsRender = `{sheets.map((sheet) => {
                const isBannerSheet =
                  sheet.blocks.length === 1 &&
                  (sheet.blocks[0].kind === 'category-banner' ||
                    sheet.blocks[0].kind === 'subcategory-banner');
                const recipeBlocks = sheet.blocks.filter((b) => b.kind === 'recipe-part');

                return (
                  <div
                    key={sheet.pageNumber}
                    style={{
                      width: '100%',
                      maxWidth: '720px',
                      aspectRatio: '210 / 297',
                      pageBreakAfter: 'always',
                      breakAfter: 'page',
                    }}
                    className={
                      'mx-auto p-6 rounded-2xl border flex flex-col justify-between overflow-hidden ' +
                      (darkMode
                        ? 'bg-slate-800/40 border-slate-700'
                        : 'bg-stone-50/70 border-stone-300')
                    }
                  >
                    <div className="flex items-center justify-between border-b border-stone-500/20 pb-2 text-xs shrink-0">
                      <span className="font-bold text-amber-500">עמוד {sheet.pageNumber}</span>
                      <span className={mutedClass + ' font-mono'}>
                        דף PDF (A4) • {sheet.usedLines}/{sheet.capacity} שורות ({sheet.fillFraction})
                      </span>
                    </div>

                    {isBannerSheet ? (
                      <div
                        id={sheet.blocks[0].domId}
                        className="flex-1 flex flex-col items-center justify-center text-center px-6 space-y-4"
                      >
                        <div className="text-xs uppercase tracking-widest font-bold text-amber-500">
                          {sheet.blocks[0].kind === 'category-banner'
                            ? 'קטגוריה ראשית • עמוד ' + sheet.blocks[0].pageNumber
                            : sheet.blocks[0].category + ' • עמוד ' + sheet.blocks[0].pageNumber}
                        </div>
                        <h3
                          className={
                            sheet.blocks[0].kind === 'category-banner'
                              ? 'text-4xl md:text-5xl font-extrabold text-amber-500'
                              : 'text-3xl md:text-4xl font-bold'
                          }
                        >
                          {sheet.blocks[0].title}
                        </h3>
                        <p className={mutedClass + ' text-sm'}>
                          {sheet.blocks[0].recipeCount || 0} מתכונים בחלק זה
                        </p>
                      </div>
                    ) : (
                      <div
                        className={
                          'flex-1 my-3 overflow-hidden ' +
                          (recipeBlocks.length > 1
                            ? 'grid grid-cols-1 sm:grid-cols-2 gap-3 content-start'
                            : 'space-y-3')
                        }
                      >
                        {sheet.blocks.map((blk, bIdx) => {
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
                                  'p-3.5 rounded-xl border space-y-1.5 ' +
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
                                  <span className={mutedClass + ' text-[11px] shrink-0'}>
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
                    )}

                    <div
                      className={
                        mutedClass +
                        ' pt-2 border-t border-stone-500/15 text-[11px] flex justify-between shrink-0'
                      }
                    >
                      <span>{bookTitle.trim() || 'ספר המתכונים שלי'}</span>
                      <span className="font-bold">עמוד {sheet.pageNumber}</span>
                    </div>
                  </div>
                );
              })}`;

    content =
      content.slice(0, sheetsRenderStart) +
      newSheetsRender +
      content.slice(sheetsRenderEnd);
  }

  fs.writeFileSync(vaultPath, content, 'utf8');
}

console.log('עודכן בהצלחה דרך update-book-layout.mjs: יחס דף PDF (A4), כותרות גדולות לקטגוריות/תת-קטגוריות ופריסת עמודות מסודרת.');