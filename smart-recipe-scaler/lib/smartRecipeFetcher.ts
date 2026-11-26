export interface ExtractedRecipePayload {
  title: string;
  servings: number;
  ingredientsText: string;
  stepsText: string;
  sourceTier: 'json-ld' | 'html-fallback' | 'reader-fallback';
  warning?: string;
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Upgrade-Insecure-Requests': '1',
};

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '));
}

function parseServingsNumber(rawYield: unknown): number {
  const text = Array.isArray(rawYield)
    ? rawYield.map((v) => String(v)).join(' ')
    : String(rawYield ?? '');
  const match = text.match(/(\d+)/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num > 0 && num <= 200) return num;
  }
  return 4;
}

function isRecipeNode(node: unknown): node is Record<string, unknown> {
  if (!node || typeof node !== 'object') return false;
  const typeVal = (node as Record<string, unknown>)['@type'];
  if (typeof typeVal === 'string') {
    return typeVal.toLowerCase().includes('recipe');
  }
  if (Array.isArray(typeVal)) {
    return typeVal.some((t) => typeof t === 'string' && t.toLowerCase().includes('recipe'));
  }
  return false;
}

function findRecipeJsonLd(parsed: unknown): Record<string, unknown> | null {
  if (!parsed) return null;

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findRecipeJsonLd(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof parsed === 'object') {
    if (isRecipeNode(parsed)) {
      return parsed;
    }
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) {
      for (const graphNode of obj['@graph']) {
        const found = findRecipeJsonLd(graphNode);
        if (found) return found;
      }
    }
  }

  return null;
}

function flattenInstructions(rawInstructions: unknown): string[] {
  const result: string[] = [];

  const visit = (entry: unknown) => {
    if (!entry) return;
    if (typeof entry === 'string') {
      const clean = stripHtmlTags(entry);
      if (clean) result.push(clean);
      return;
    }
    if (Array.isArray(entry)) {
      for (const sub of entry) visit(sub);
      return;
    }
    if (typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      if (typeof obj.text === 'string') {
        const clean = stripHtmlTags(obj.text);
        if (clean) result.push(clean);
      } else if (typeof obj.name === 'string' && !obj.itemListElement) {
        const clean = stripHtmlTags(obj.name);
        if (clean) result.push(clean);
      }
      if (Array.isArray(obj.itemListElement)) {
        for (const sub of obj.itemListElement) visit(sub);
      }
    }
  };

  visit(rawInstructions);
  return result;
}

function extractFromJsonLdBlocks(html: string): ExtractedRecipePayload | null {
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const rawJson = match[1]?.trim();
    if (!rawJson) continue;

    try {
      const cleanedJson = rawJson.replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
      const parsed = JSON.parse(cleanedJson);
      const recipeNode = findRecipeJsonLd(parsed);

      if (recipeNode) {
        const title = stripHtmlTags(String(recipeNode.name ?? 'מתכון מיובא'));
        const servings = parseServingsNumber(recipeNode.recipeYield);

        const rawIngredients = Array.isArray(recipeNode.recipeIngredient)
          ? recipeNode.recipeIngredient
          : Array.isArray(recipeNode.ingredients)
          ? recipeNode.ingredients
          : [];

        const ingredients = rawIngredients
          .map((item) => stripHtmlTags(String(item)))
          .filter(Boolean);

        const steps = flattenInstructions(recipeNode.recipeInstructions);

        if (ingredients.length >= 2) {
          return {
            title: title || 'מתכון מיובא',
            servings,
            ingredientsText: ingredients.join('\n'),
            stepsText: steps.join('\n'),
            sourceTier: 'json-ld',
          };
        }
      }
    } catch {
      // המשך לבלוק JSON-LD הבא אם בלוק אחד לא תקין תחבירית
    }
  }

  return null;
}

function extractFromPlainHtml(html: string): ExtractedRecipePayload | null {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtmlTags(titleMatch[1]).split('|')[0].trim() : 'מתכון מיובא';

  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '\n')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '\n');

  const liMatches = [...withoutScripts.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => stripHtmlTags(m[1]))
    .filter((line) => line.length >= 3 && line.length <= 240);

  const ingredientLinePattern =
    /^(?:\d+|½|⅓|⅔|¼|¾|כוס|כף|כפות|כפית|כפיות|גרם|ק"ג|מ"ל|ליטר|חבילת|שקית|קמצוץ|ביצים|ביצה|בצל|שום)/;

  const ingredients = liMatches.filter((line) => ingredientLinePattern.test(line));
  const steps = liMatches.filter((line) => !ingredientLinePattern.test(line) && line.length > 25);

  if (ingredients.length >= 2) {
    return {
      title: title || 'מתכון מיובא',
      servings: 4,
      ingredientsText: ingredients.join('\n'),
      stepsText: steps.slice(0, 20).join('\n'),
      sourceTier: 'html-fallback',
    };
  }

  return null;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 8500
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchViaReaderFallback(targetUrl: string): Promise<ExtractedRecipePayload | null> {
  try {
    const readerUrl = 'https://r.jina.ai/' + targetUrl;
    const res = await fetchWithTimeout(
      readerUrl,
      {
        headers: {
          Accept: 'text/plain',
          'X-Return-Format': 'markdown',
        },
      },
      11000
    );

    if (!res.ok) return null;
    const markdown = await res.text();
    if (!markdown || markdown.length < 120) return null;

    const lines = markdown
      .split('\n')
      .map((l) => l.replace(/^[#*\-•>\s]+/, '').trim())
      .filter((l) => l.length >= 3 && !l.startsWith('http') && !l.startsWith('!['));

    const titleLine = lines[0] || 'מתכון מיובא';
    const ingredientPattern =
      /^(?:\d+|½|⅓|⅔|¼|¾|כוס|כף|כפות|כפית|כפיות|גרם|ק"ג|מ"ל|ליטר|חבילת|שקית|קמצוץ|ביצים|ביצה|בצל|שום)/;

    const ingredients = lines.filter((l) => ingredientPattern.test(l) && l.length <= 160);
    const steps = lines.filter((l) => /^\d+[.)]\s+/.test(l) || (!ingredientPattern.test(l) && l.length > 35));

    if (ingredients.length >= 2) {
      return {
        title: titleLine.slice(0, 90),
        servings: 4,
        ingredientsText: ingredients.join('\n'),
        stepsText: steps.slice(0, 25).join('\n'),
        sourceTier: 'reader-fallback',
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function fetchRecipeFromUrlSmart(rawUrl: string): Promise<ExtractedRecipePayload> {
  const parsedUrl = new URL(rawUrl.trim());
  const origin = parsedUrl.origin;

  // שכבה 1: שליפה ישירה עם כותרות דפדפן אמיתיות + Referer
  let html = '';
  let blockedStatus: number | null = null;

  try {
    const response = await fetchWithTimeout(parsedUrl.toString(), {
      headers: {
        ...BROWSER_HEADERS,
        Referer: origin + '/',
      },
    });

    if (response.ok) {
      html = await response.text();
    } else {
      blockedStatus = response.status;
    }
  } catch {
    blockedStatus = 0;
  }

  // בדיקת חסימת Cloudflare / Challenge בעמוד שחזר
  const isChallengePage =
    html.includes('cf-browser-verification') ||
    html.includes('Just a moment...') ||
    html.includes('Enable JavaScript and cookies to continue');

  if (html && !isChallengePage) {
    const jsonLdResult = extractFromJsonLdBlocks(html);
    if (jsonLdResult) {
      return jsonLdResult;
    }

    const htmlResult = extractFromPlainHtml(html);
    if (htmlResult) {
      return htmlResult;
    }
  }

  // שכבה 2: גיבוי רינדור עבור אתרי JavaScript / חסימות כותרת קלות
  const readerResult = await fetchViaReaderFallback(parsedUrl.toString());
  if (readerResult) {
    return readerResult;
  }

  // שכבה 3: אם האתר מוגן בחסימת IP קשיחה או חומת תשלום
  const reason =
    blockedStatus === 403 || isChallengePage
      ? 'האתר מפעיל הגנת אנטי-בוט קשיחה (Cloudflare / WAF) שחוסמת שרתי ענן.'
      : 'האתר לא חשף מבנה מתכון קריא או שהוא דורש התחברות / מנוי.';

  return {
    title: '',
    servings: 4,
    ingredientsText: '',
    stepsText: '',
    sourceTier: 'html-fallback',
    warning:
      reason +
      ' ניתן להעתיק את טקסט המתכון מהדפדפן ולהדביק ישירות בתיבת המצרכים או להעלות צילום מסך.',
  };
}