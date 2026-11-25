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
