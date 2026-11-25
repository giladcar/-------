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

export interface BookPagedRecipe {
  recipe: SavedRecipeItem;
  pageNumber: number;
  domId: string;
}

export interface BookPagedSubGroup {
  subCategory: string;
  pageNumber: number;
  domId: string;
  recipes: BookPagedRecipe[];
}

export interface BookPagedCategory {
  category: string;
  pageNumber: number;
  domId: string;
  subGroups: BookPagedSubGroup[];
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

export function buildPagedBook(items: SavedRecipeItem[]): BookPagedCategory[] {
  const baseGroups = groupRecipesByCategory(items);
  let currentPage = 2; // עמוד 1 הוא הכריכה ותוכן העניינים

  return baseGroups.map((catGroup, cIdx) => {
    const catPage = currentPage;
    const catDomId = 'book-cat-' + cIdx;

    const pagedSubGroups: BookPagedSubGroup[] = catGroup.subGroups.map((subGroup, sIdx) => {
      const subPage = currentPage;
      const subDomId = 'book-sub-' + cIdx + '-' + sIdx;

      const pagedRecipes: BookPagedRecipe[] = subGroup.recipes.map((rec, rIdx) => {
        if (rIdx > 0) {
          currentPage += 1;
        }
        const recPage = currentPage;
        const recDomId = 'book-rec-' + cIdx + '-' + sIdx + '-' + rIdx;
        return {
          recipe: rec,
          pageNumber: recPage,
          domId: recDomId,
        };
      });

      currentPage += 1;

      return {
        subCategory: subGroup.subCategory,
        pageNumber: subPage,
        domId: subDomId,
        recipes: pagedRecipes,
      };
    });

    return {
      category: catGroup.category,
      pageNumber: catPage,
      domId: catDomId,
      subGroups: pagedSubGroups,
    };
  });
}
