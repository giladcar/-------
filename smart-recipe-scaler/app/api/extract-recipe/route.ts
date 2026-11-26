import { NextRequest, NextResponse } from 'next/server';
import { extractRecipeFromText } from '@/lib/recipeEngine';

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
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
      const cleaned = decodeHtmlEntities(item.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
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

function isChallengeOrBlockedHtml(html: string): boolean {
  if (!html || html.trim().length < 150) return true;
  const lower = html.toLowerCase();
  return (
    lower.includes('cf-browser-verification') ||
    lower.includes('just a moment...') ||
    lower.includes('enable javascript and cookies to continue') ||
    lower.includes('access denied') ||
    lower.includes('attention required! | cloudflare')
  );
}

function extractFromHtmlContent(html: string): {
  ingredients: string[];
  steps: string[];
  sourceMethod: 'json-ld' | 'html-fallback';
} | null {
  if (isChallengeOrBlockedHtml(html)) return null;

  // ניסיון ראשון: חילוץ נתונים מובנים Schema.org JSON-LD
  const jsonLdMatches = [
    ...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];

  for (const match of jsonLdMatches) {
    try {
      const rawJson = match[1].replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
      const parsed = JSON.parse(rawJson);
      const candidates = flattenUnknown(parsed);
      const recipeObj = candidates.find((c) => {
        if (!c || typeof c !== 'object') return false;
        const t = (c as Record<string, unknown>)['@type'];
        if (typeof t === 'string') return t.toLowerCase().includes('recipe');
        if (Array.isArray(t)) {
          return t.some((x) => typeof x === 'string' && x.toLowerCase().includes('recipe'));
        }
        return false;
      }) as Record<string, unknown> | undefined;

      if (recipeObj) {
        const rawIng = Array.isArray(recipeObj.recipeIngredient)
          ? recipeObj.recipeIngredient
              .map((x) => decodeHtmlEntities(String(x).replace(/<[^>]+>/g, ' ')).trim())
              .filter(Boolean)
          : [];
        const rawSteps = extractStepsFromSchema(recipeObj.recipeInstructions);

        if (rawIng.length >= 2 || (rawIng.length > 0 && rawSteps.length > 0)) {
          return {
            ingredients: rawIng,
            steps: rawSteps,
            sourceMethod: 'json-ld',
          };
        }
      }
    } catch {
      // ממשיכים לבלוק ה-JSON-LD הבא
    }
  }

  // ניסיון שני: חילוץ מתוך הטקסט הנקי של העמוד
  const plainText = stripTagsToText(html);
  const extracted = extractRecipeFromText(plainText);
  if (extracted.ingredients.length >= 2) {
    return {
      ingredients: extracted.ingredients,
      steps: extracted.steps,
      sourceMethod: 'html-fallback',
    };
  }

  return null;
}

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 9500
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildBrowserHeaders(targetUrl: string): Record<string, string> {
  let origin = '';
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    origin = targetUrl;
  }
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    Referer: origin + '/',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Cache-Control': 'no-cache',
  };
}

// שכבה 2: רינדור מלא לאתרים שחוסמים בוטים או טוענים תוכן דרך JavaScript
async function fetchViaRenderedReader(targetUrl: string): Promise<{
  ingredients: string[];
  steps: string[];
  sourceMethod: 'reader-fallback';
} | null> {
  try {
    const readerUrl = 'https://r.jina.ai/' + targetUrl;
    const res = await fetchWithTimeout(
      readerUrl,
      {
        Accept: 'text/plain',
        'X-Return-Format': 'markdown',
      },
      12000
    );

    if (!res.ok) return null;
    const markdown = await res.text();
    if (!markdown || markdown.length < 120) return null;

    const cleanedText = markdown
      .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^[#*>-]+\s*/gm, '');

    const extracted = extractRecipeFromText(cleanedText);
    if (extracted.ingredients.length >= 2) {
      return {
        ingredients: extracted.ingredients,
        steps: extracted.steps,
        sourceMethod: 'reader-fallback',
      };
    }
    return null;
  } catch {
    return null;
  }
}

// שכבה 3: שליפת HTML דרך ממסר חיצוני במקרה של חסימת IP ישירה על השרת
async function fetchViaRelayProxy(targetUrl: string): Promise<{
  ingredients: string[];
  steps: string[];
  sourceMethod: 'json-ld' | 'html-fallback';
} | null> {
  try {
    const relayUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl);
    const res = await fetchWithTimeout(
      relayUrl,
      { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      11000
    );
    if (!res.ok) return null;
    const html = await res.text();
    return extractFromHtmlContent(html);
  } catch {
    return null;
  }
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

    let partialFallback: { ingredients: string[]; steps: string[] } | null = null;

    // שכבה 1: שליפה ישירה עם כותרות דפדפן אמיתיות (Chrome 131)
    try {
      const response = await fetchWithTimeout(targetUrl, buildBrowserHeaders(targetUrl), 9500);
      if (response.ok) {
        const html = await response.text();
        const directResult = extractFromHtmlContent(html);
        if (directResult) {
          return NextResponse.json(directResult);
        }
        // שמירת חילוץ חלקי למקרה שכל השכבות הבאות ייכשלו
        const quickText = extractRecipeFromText(stripTagsToText(html));
        if (quickText.ingredients.length > 0 || quickText.steps.length > 0) {
          partialFallback = quickText;
        }
      }
    } catch {
      // מדלגים אוטומטית לשכבה 2 בלי לעצור
    }

    // שכבה 2: דילוג דרך שכבת רינדור JS מלאה (לאתרים שמחזירים שלד חלקי או חוסמים גישה ישירה)
    const readerResult = await fetchViaRenderedReader(targetUrl);
    if (readerResult) {
      return NextResponse.json(readerResult);
    }

    // שכבה 3: דילוג דרך ממסר חיצוני (לעקיפת חסימות IP של שרתי ענן)
    const relayResult = await fetchViaRelayProxy(targetUrl);
    if (relayResult) {
      return NextResponse.json(relayResult);
    }

    if (partialFallback) {
      return NextResponse.json({
        ingredients: partialFallback.ingredients,
        steps: partialFallback.steps,
        sourceMethod: 'html-fallback',
      });
    }

    return NextResponse.json(
      {
        error:
          'האתר מפעיל חומת הגנה קשיחה (Cloudflare / חומת תשלום) שחוסמת גישה חיצונית. ניתן להעתיק את טקסט המתכון ולהדביק ישירות בתיבת המצרכים או להעלות צילום מסך.',
      },
      { status: 422 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה בחילוץ המתכון מהקישור';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
