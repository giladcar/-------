import { NextRequest, NextResponse } from 'next/server';
import { extractRecipeFromText } from '@/lib/recipeEngine';

interface ExtractionResult {
  ingredients: string[];
  steps: string[];
  sourceMethod: string;
}

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

function cleanTagText(htmlSnippet: string): string {
  return decodeHtmlEntities(htmlSnippet.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTagsToText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');

  const withBreaks = withoutNoise.replace(
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
    const nested: unknown[] = [obj];
    if (Array.isArray(obj['@graph'])) nested.push(...flattenUnknown(obj['@graph']));
    if (obj.mainEntity) nested.push(...flattenUnknown(obj.mainEntity));
    if (obj.mainEntityOfPage) nested.push(...flattenUnknown(obj.mainEntityOfPage));
    return nested;
  }
  return [];
}

function extractStepsFromSchema(rawInstructions: unknown): string[] {
  const steps: string[] = [];
  const walk = (item: unknown) => {
    if (!item) return;
    if (typeof item === 'string') {
      const cleaned = cleanTagText(item);
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
    lower.includes('attention required! | cloudflare') ||
    (lower.includes('access denied') && html.length < 4000)
  );
}

function extractMicrodataAndPlugins(html: string): { ingredients: string[]; steps: string[] } | null {
  const ingSet = new Set<string>();
  const stepSet = new Set<string>();

  const ingPatterns = [
    /<[^>]+itemprop=["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/gi,
    /<li[^>]+class=["'][^"']*(?:wprm-recipe-ingredient|tasty-recipes-ingredient|mv-create-ingredient|recipe-ingredient)[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
  ];

  for (const regex of ingPatterns) {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
      const txt = cleanTagText(m[1]).replace(/^[•\-*▪▫]+\s*/, '').trim();
      if (txt.length >= 2 && txt.length <= 220) ingSet.add(txt);
    }
  }

  const stepPatterns = [
    /<[^>]+itemprop=["'](?:recipeInstructions|step)["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/gi,
    /<li[^>]+class=["'][^"']*(?:wprm-recipe-instruction|tasty-recipes-instruction|mv-create-instruction|recipe-step)[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
  ];

  for (const regex of stepPatterns) {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
      const txt = cleanTagText(m[1]).replace(/^\d+[.)]\s*/, '').trim();
      if (txt.length >= 5 && txt.length <= 600) stepSet.add(txt);
    }
  }

  const ingredients = Array.from(ingSet);
  const steps = Array.from(stepSet);
  return ingredients.length >= 2 ? { ingredients, steps } : null;
}

function extractFromHtmlContent(html: string): ExtractionResult | null {
  if (isChallengeOrBlockedHtml(html)) return null;

  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const rawJson = match[1]
        .replace(/^\s*<!--/, '')
        .replace(/-->\s*$/, '')
        .replace(/,\s*([}\]])/g, '$1')
        .trim();
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
          ? recipeObj.recipeIngredient.map((x) => cleanTagText(String(x))).filter(Boolean)
          : Array.isArray(recipeObj.ingredients)
          ? recipeObj.ingredients.map((x) => cleanTagText(String(x))).filter(Boolean)
          : [];
        const rawSteps = extractStepsFromSchema(recipeObj.recipeInstructions);

        if (rawIng.length >= 2 || (rawIng.length > 0 && rawSteps.length > 0)) {
          return { ingredients: rawIng, steps: rawSteps, sourceMethod: 'json-ld' };
        }
      }
    } catch {}
  }

  const microdata = extractMicrodataAndPlugins(html);
  if (microdata) {
    return {
      ingredients: microdata.ingredients,
      steps: microdata.steps,
      sourceMethod: 'microdata-wprm',
    };
  }

  const extracted = extractRecipeFromText(stripTagsToText(html));
  if (extracted.ingredients.length >= 2) {
    return {
      ingredients: extracted.ingredients,
      steps: extracted.steps,
      sourceMethod: 'html-fallback',
    };
  }

  return null;
}

function extractFromMarkdownSections(markdown: string): { ingredients: string[]; steps: string[] } {
  const lines = markdown
    .split('\n')
    .map((l) => l.replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim())
    .filter(Boolean);

  let section: 'none' | 'ing' | 'steps' = 'none';
  const ingredients: string[] = [];
  const steps: string[] = [];

  for (const rawLine of lines) {
    const cleanHeader = rawLine.replace(/^[#*>-]+\s*/, '').replace(/:$/, '').trim();
    if (rawLine.length <= 45 && /^(?:מצרכים|רכיבים|חומרים|ingredients)/i.test(cleanHeader)) {
      section = 'ing';
      continue;
    }
    if (rawLine.length <= 45 && /^(?:אופן ההכנה|שלבי הכנה|הוראות הכנה|הכנה|instructions|directions|method)/i.test(cleanHeader)) {
      section = 'steps';
      continue;
    }
    if (/^#{1,3}\s+/.test(rawLine) && section !== 'none') {
      section = 'none';
      continue;
    }

    if (section === 'ing') {
      const item = rawLine.replace(/^[•\-*▪▫]\s*/, '').trim();
      if (item.length >= 2 && item.length <= 160 && !item.startsWith('http')) ingredients.push(item);
    } else if (section === 'steps') {
      const step = rawLine.replace(/^(?:\d+[.)]|[•\-*])\s*/, '').trim();
      if (step.length >= 8 && step.length <= 600 && !step.startsWith('http')) steps.push(step);
    }
  }

  return { ingredients, steps };
}

async function fetchWithTimeout(url: string, headers: Record<string, string>, timeoutMs = 8500): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers, redirect: 'follow' });
  } finally {
    clearTimeout(timeoutId);
  }
}

function firstNonNull<T>(promises: Array<Promise<T | null>>): Promise<T | null> {
  return new Promise((resolve) => {
    let pending = promises.length;
    if (pending === 0) return resolve(null);
    for (const p of promises) {
      p.then((val) => {
        if (val !== null) resolve(val);
        else if (--pending === 0) resolve(null);
      }).catch(() => {
        if (--pending === 0) resolve(null);
      });
    }
  });
}

async function tier1DesktopGoogleReferer(targetUrl: string): Promise<ExtractionResult | null> {
  try {
    const res = await fetchWithTimeout(targetUrl, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      Referer: 'https://www.google.com/',
    }, 8000);
    if (!res.ok) return null;
    return extractFromHtmlContent(await res.text());
  } catch {
    return null;
  }
}

async function tier2MobileSafari(targetUrl: string): Promise<ExtractionResult | null> {
  try {
    const res = await fetchWithTimeout(targetUrl, {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
      Referer: 'https://www.google.co.il/',
    }, 7500);
    if (!res.ok) return null;
    return extractFromHtmlContent(await res.text());
  } catch {
    return null;
  }
}

async function tier3RenderedReader(targetUrl: string): Promise<ExtractionResult | null> {
  try {
    const res = await fetchWithTimeout('https://r.jina.ai/' + targetUrl, {
      Accept: 'text/plain',
      'X-Return-Format': 'markdown',
    }, 11500);
    if (!res.ok) return null;
    const markdown = await res.text();
    if (!markdown || markdown.length < 100) return null;

    const sectionParsed = extractFromMarkdownSections(markdown);
    if (sectionParsed.ingredients.length >= 2) {
      return { ...sectionParsed, sourceMethod: 'reader-fallback' };
    }

    const cleanedText = markdown
      .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^[#*>-]+\s*/gm, '');
    const fallbackParsed = extractRecipeFromText(cleanedText);
    if (fallbackParsed.ingredients.length >= 2) {
      return {
        ingredients: fallbackParsed.ingredients,
        steps: fallbackParsed.steps,
        sourceMethod: 'reader-fallback',
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function tier4MultiProxyRace(targetUrl: string): Promise<ExtractionResult | null> {
  const encoded = encodeURIComponent(targetUrl);
  const fetchProxy = async (proxyUrl: string, unwrapJson: boolean): Promise<ExtractionResult | null> => {
    try {
      const res = await fetchWithTimeout(proxyUrl, { Accept: 'text/html,application/json,*/*;q=0.8' }, 9500);
      if (!res.ok) return null;
      const html = unwrapJson ? ((await res.json()) as { contents?: string }).contents || '' : await res.text();
      const parsed = extractFromHtmlContent(html);
      return parsed ? { ...parsed, sourceMethod: parsed.sourceMethod === 'json-ld' ? 'json-ld' : 'relay-proxy' } : null;
    } catch {
      return null;
    }
  };

  return firstNonNull([
    fetchProxy('https://corsproxy.io/?' + encoded, false),
    fetchProxy('https://api.codetabs.com/v1/proxy?quest=' + encoded, false),
    fetchProxy('https://api.allorigins.win/get?url=' + encoded, true),
  ]);
}

async function tier5WebArchiveFallback(targetUrl: string): Promise<ExtractionResult | null> {
  try {
    const metaRes = await fetchWithTimeout(
      'https://archive.org/wayback/available?url=' + encodeURIComponent(targetUrl),
      { Accept: 'application/json' },
      5000
    );
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { archived_snapshots?: { closest?: { available?: boolean; url?: string } } };
    const snapUrl = meta?.archived_snapshots?.closest?.url;
    if (!meta?.archived_snapshots?.closest?.available || !snapUrl) return null;

    const rawSnapUrl = snapUrl.replace(/\/web\/(\d+)\//, '/web/$1id_/');
    const pageRes = await fetchWithTimeout(rawSnapUrl, { Accept: 'text/html' }, 8500);
    if (!pageRes.ok) return null;
    const parsed = extractFromHtmlContent(await pageRes.text());
    return parsed ? { ...parsed, sourceMethod: 'web-archive' } : null;
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

    const directWinner = await firstNonNull([
      tier1DesktopGoogleReferer(targetUrl),
      tier2MobileSafari(targetUrl),
    ]);
    if (directWinner) return NextResponse.json(directWinner);

    const bypassWinner = await firstNonNull([
      tier3RenderedReader(targetUrl),
      tier4MultiProxyRace(targetUrl),
    ]);
    if (bypassWinner) return NextResponse.json(bypassWinner);

    const archiveWinner = await tier5WebArchiveFallback(targetUrl);
    if (archiveWinner) return NextResponse.json(archiveWinner);

    return NextResponse.json(
      {
        error:
          'האתר חוסם גישה אוטומטית ברמת השרת. העלה למעלה עד 3 צילומי מסך של המתכון או הדבק את הטקסט.',
      },
      { status: 422 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה בחילוץ המתכון מהקישור';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
