import { NextRequest, NextResponse } from 'next/server';
import { extractRecipeFromText } from '@/lib/recipeEngine';

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTagsToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');

  const withBreaks = withoutScripts.replace(
    /<\/?(p|div|br|li|ul|ol|h1|h2|h3|h4|h5|h6|tr|section|article)[^>]*>/gi,
    '\n'
  );

  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ' '));
}

function flattenUnknown(val: unknown): unknown[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.flatMap(flattenUnknown);
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) return flattenUnknown(obj['@graph']);
    return [obj];
  }
  return [];
}

function extractStepsFromSchema(rawInstructions: unknown): string[] {
  const steps: string[] = [];
  const walk = (item: unknown) => {
    if (!item) return;
    if (typeof item === 'string') {
      const cleaned = decodeHtmlEntities(item).replace(/\s+/g, ' ').trim();
      if (cleaned) steps.push(cleaned);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }
    if (typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (typeof obj.text === 'string') walk(obj.text);
      if (Array.isArray(obj.itemListElement)) walk(obj.itemListElement);
      if (Array.isArray(obj.steps)) walk(obj.steps);
    }
  };
  walk(rawInstructions);
  return steps;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: string };
    const targetUrl = (body.url || '').trim();

    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      return NextResponse.json(
        { error: 'יש להזין קישור תקין שמתחיל ב-http:// או https://' },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SmartRecipeScaler/1.0)',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    clearTimeout(timeoutId);

    if (response.status === 403) {
      return NextResponse.json(
        { error: 'אין הרשאה לאתר!' },
        { status: 403 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: 'לא ניתן היה לטעון את העמוד (קוד ' + response.status + ')' },
        { status: 502 }
      );
    }

    const html = await response.text();

    const jsonLdMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const match of jsonLdMatches) {
      try {
        const parsed = JSON.parse(match[1].trim());
        const candidates = flattenUnknown(parsed);
        const recipeObj = candidates.find((c) => {
          if (!c || typeof c !== 'object') return false;
          const t = (c as Record<string, unknown>)['@type'];
          if (typeof t === 'string') return t.toLowerCase() === 'recipe';
          if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && x.toLowerCase() === 'recipe');
          return false;
        }) as Record<string, unknown> | undefined;

        if (recipeObj) {
          const rawIng = Array.isArray(recipeObj.recipeIngredient)
            ? recipeObj.recipeIngredient.map((x) => decodeHtmlEntities(String(x)).trim()).filter(Boolean)
            : [];
          const rawSteps = extractStepsFromSchema(recipeObj.recipeInstructions);

          if (rawIng.length > 0 || rawSteps.length > 0) {
            return NextResponse.json({
              ingredients: rawIng,
              steps: rawSteps,
              sourceMethod: 'json-ld',
            });
          }
        }
      } catch {
        // ממשיכים לבלוק ה-JSON-LD הבא או לחילוץ טקסט
      }
    }

    const plainText = stripTagsToText(html);
    const extracted = extractRecipeFromText(plainText);

    return NextResponse.json({
      ingredients: extracted.ingredients,
      steps: extracted.steps,
      sourceMethod: 'html-fallback',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה בחילוץ המתכון מהקישור';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
