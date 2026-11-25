import { DietMode } from '@/lib/recipeEngine';

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
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const allSteps = rec.rawSteps
          .split('\n')
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
