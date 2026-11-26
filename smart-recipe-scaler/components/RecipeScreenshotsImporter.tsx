'use client';

import React, { useState, useRef } from 'react';
import { createWorker } from 'tesseract.js';
import { cleanOcrNoise } from '@/lib/smartRecipeParser';

interface ScreenshotSlot {
  file: File;
  previewUrl: string;
}

interface RecipeScreenshotsImporterProps {
  darkMode: boolean;
  onExtractedCombinedText: (combinedText: string, imageCount: number) => void;
}

const SLOT_LABELS = ['צילום 1 (התחלה)', 'צילום 2 (המשך)', 'צילום 3 (סוף)'];

function loadHtmlImage(file: File): Promise<{ img: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => resolve({ img, objectUrl });
    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    };
    img.src = objectUrl;
  });
}

// איתור אוטומטי של כרטיסיית הטקסט הבהירה בתוך תמונת סטורי / צילום מסך כדי לא לסרוק אוכל או גלריה מסביב
function detectBrightTextCardBox(
  img: HTMLImageElement
): { x: number; y: number; w: number; h: number } | null {
  const probeW = 240;
  const probeH = Math.max(120, Math.round((img.height / Math.max(1, img.width)) * probeW));
  const probe = document.createElement('canvas');
  probe.width = probeW;
  probe.height = probeH;
  const pCtx = probe.getContext('2d', { willReadFrequently: true });
  if (!pCtx) return null;

  pCtx.drawImage(img, 0, 0, probeW, probeH);
  const { data } = pCtx.getImageData(0, 0, probeW, probeH);

  // דילוג על 5% עליונים (סרגל שעון/סוללה) ו-12% תחתונים (כפתורי ניווט/גלריה)
  const yStart = Math.floor(probeH * 0.05);
  const yEnd = Math.floor(probeH * 0.88);
  const xStart = Math.floor(probeW * 0.06);
  const xEnd = Math.floor(probeW * 0.94);

  let minX = probeW;
  let maxX = 0;
  let minY = probeH;
  let maxY = 0;
  let brightCount = 0;

  for (let y = yStart; y < yEnd; y++) {
    let rowBright = 0;
    let rowMinX = probeW;
    let rowMaxX = 0;
    for (let x = xStart; x < xEnd; x++) {
      const idx = (y * probeW + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // פיקסל לבן/קרם של תיבת טקסט (בהירות גבוהה ורוויה נמוכה)
      const isWhiteCardPixel = r > 215 && g > 210 && b > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 35;
      if (isWhiteCardPixel) {
        rowBright++;
        if (x < rowMinX) rowMinX = x;
        if (x > rowMaxX) rowMaxX = x;
      }
    }
    // שורה שייכת לתיבת טקסט אם לפחות 35% מרוחבה לבן
    if (rowBright >= (xEnd - xStart) * 0.35) {
      brightCount += rowBright;
      if (rowMinX < minX) minX = rowMinX;
      if (rowMaxX > maxX) maxX = rowMaxX;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const boxW = maxX - minX;
  const boxH = maxY - minY;
  const totalArea = probeW * probeH;

  // אם זוהתה תיבת טקסט מרכזית (בין 12% ל-82% משטח התמונה), נחתוך בדיוק אליה עם שוליים קטנים
  if (
    brightCount > totalArea * 0.1 &&
    boxW > probeW * 0.4 &&
    boxH > probeH * 0.15 &&
    boxH < probeH * 0.82
  ) {
    const scaleX = img.width / probeW;
    const scaleY = img.height / probeH;
    const padX = Math.round(img.width * 0.02);
    const padY = Math.round(img.height * 0.015);

    const cropX = Math.max(0, Math.floor(minX * scaleX) - padX);
    const cropY = Math.max(0, Math.floor(minY * scaleY) - padY);
    const cropW = Math.min(img.width - cropX, Math.ceil(boxW * scaleX) + padX * 2);
    const cropH = Math.min(img.height - cropY, Math.ceil(boxH * scaleY) + padY * 2);

    return { x: cropX, y: cropY, w: cropW, h: cropH };
  }

  return null;
}

function buildCleanOcrCanvas(img: HTMLImageElement, invertPolarity: boolean): HTMLCanvasElement {
  const cardBox = !invertPolarity ? detectBrightTextCardBox(img) : null;

  const srcX = cardBox ? cardBox.x : 0;
  const srcY = cardBox ? cardBox.y : 0;
  const srcW = cardBox ? cardBox.w : img.width;
  const srcH = cardBox ? cardBox.h : img.height;

  // הגדלה איכותית ל-~2000px רוחב לקריאה מדויקת של אותיות בעברית
  const targetW = Math.min(2400, Math.max(1600, Math.round(srcW * 2)));
  const scale = targetW / Math.max(1, srcW);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(srcW * scale);
  canvas.height = Math.round(srcH * scale);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

  // חישוב סף Otsu אוטומטי להפרדה נקייה בין טקסט לרקע בלי לאכול אותיות דקות
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const histogram = new Array<number>(256).fill(0);
  const totalPixels = canvas.width * canvas.height;

  for (let i = 0; i < data.length; i += 4) {
    let lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    if (invertPolarity) lum = 255 - lum;
    histogram[lum]++;
  }

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 155;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = totalPixels - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const betweenVar = wB * wF * (mB - mF) * (mB - mF);
    if (betweenVar > maxVar) {
      maxVar = betweenVar;
      threshold = t;
    }
  }

  const lowCut = Math.max(60, threshold - 38);
  const highCut = Math.min(245, threshold + 28);

  for (let i = 0; i < data.length; i += 4) {
    let lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (invertPolarity) lum = 255 - lum;

    let val: number;
    if (lum <= lowCut) {
      val = 0;
    } else if (lum >= highCut) {
      val = 255;
    } else {
      val = Math.round(((lum - lowCut) / Math.max(1, highCut - lowCut)) * 255);
    }

    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
    data[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function scoreHebrewQuality(text: string): number {
  const cleaned = cleanOcrNoise(text);
  const hebrewWords = cleaned.match(/[א-ת]{2,}/g) || [];
  const recipeHits =
    cleaned.match(
      /(?:כוס|כוסות|כף|כפות|כפית|כפיות|גרם|קילו|בצל|בצלים|תפוחי|פרגיות|שמן|מלח|פלפל|מים|תנור|לערבב|להוסיף|לטגן|לבשל|לאפות|דקות|שעה|אפשר|לוודא)/g
    ) || [];
  return hebrewWords.length * 2 + recipeHits.length * 10;
}

export default function RecipeScreenshotsImporter({
  darkMode,
  onExtractedCombinedText,
}: RecipeScreenshotsImporterProps) {
  const [slots, setSlots] = useState<Array<ScreenshotSlot | null>>([null, null, null]);
  const [scanning, setScanning] = useState<boolean>(false);
  const [progressText, setProgressText] = useState<string>('');
  const [progressPct, setProgressPct] = useState<number>(0);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const multiInputRef = useRef<HTMLInputElement | null>(null);
  const singleInputRefs = [
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
    useRef<HTMLInputElement | null>(null),
  ];

  const setSlotFile = (index: number, file: File) => {
    setOcrError(null);
    setSlots((prev) => {
      const next = [...prev];
      if (next[index]?.previewUrl) URL.revokeObjectURL(next[index]!.previewUrl);
      next[index] = { file, previewUrl: URL.createObjectURL(file) };
      return next;
    });
  };

  const handleMultiFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setOcrError(null);
    const imageFiles = Array.from(fileList)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 3);

    if (imageFiles.length === 0) {
      setOcrError('יש לבחור קבצי תמונה בלבד (PNG, JPG, WebP).');
      return;
    }

    setSlots((prev) => {
      const next = [...prev];
      const hasEmpty = next.some((s) => s === null);
      if (!hasEmpty) {
        next.forEach((s) => {
          if (s?.previewUrl) URL.revokeObjectURL(s.previewUrl);
        });
        return [0, 1, 2].map((i) =>
          imageFiles[i]
            ? { file: imageFiles[i], previewUrl: URL.createObjectURL(imageFiles[i]) }
            : null
        );
      }
      let cursor = 0;
      for (let i = 0; i < 3 && cursor < imageFiles.length; i++) {
        if (next[i] === null) {
          const f = imageFiles[cursor++];
          next[i] = { file: f, previewUrl: URL.createObjectURL(f) };
        }
      }
      return next;
    });
  };

  const removeSlot = (index: number) => {
    setSlots((prev) => {
      const next = [...prev];
      if (next[index]?.previewUrl) URL.revokeObjectURL(next[index]!.previewUrl);
      next[index] = null;
      return next;
    });
  };

  const clearAllSlots = () => {
    setSlots((prev) => {
      prev.forEach((s) => {
        if (s?.previewUrl) URL.revokeObjectURL(s.previewUrl);
      });
      return [null, null, null];
    });
    setOcrError(null);
    setProgressText('');
    setProgressPct(0);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedImages: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const f = items[i].getAsFile();
        if (f) pastedImages.push(f);
      }
    }
    if (pastedImages.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      pastedImages.slice(0, 3).forEach((f) => dt.items.add(f));
      handleMultiFiles(dt.files);
    }
  };

  const filledCount = slots.filter(Boolean).length;

  const handleScanScreenshots = async () => {
    const activeEntries = slots
      .map((slot, idx) => (slot ? { slot, idx } : null))
      .filter((x): x is { slot: ScreenshotSlot; idx: number } => x !== null);

    if (activeEntries.length === 0) {
      setOcrError('יש להעלות לפחות צילום מסך אחד (עד 3 תמונות לאותו מתכון ארוך).');
      return;
    }

    setScanning(true);
    setOcrError(null);
    setProgressPct(8);
    setProgressText('מכין מנוע זיהוי טקסט חכם בעברית ובאנגלית...');

    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    try {
      worker = await createWorker(['heb', 'eng'], 1, {
        logger: (m: { status?: string; progress?: number }) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setProgressPct(Math.round(m.progress * 100));
          }
        },
      });

      await worker.setParameters({
        preserve_interword_spaces: '1',
      });

      const extractedParts: string[] = [];

      for (let i = 0; i < activeEntries.length; i++) {
        const entry = activeEntries[i];
        setProgressPct(10);
        setProgressText(
          'סורק ' +
            SLOT_LABELS[entry.idx] +
            ' (' +
            (i + 1) +
            ' מתוך ' +
            activeEntries.length +
            ')...'
        );

        const { img, objectUrl } = await loadHtmlImage(entry.slot.file);
        try {
          const lightCanvas = buildCleanOcrCanvas(img, false);
          const resLight = await worker.recognize(lightCanvas);
          const textLight = resLight?.data?.text || '';
          const scoreLight = scoreHebrewQuality(textLight);

          let bestText = textLight;

          if (scoreLight < 45) {
            setProgressText('מנסה קריאה הפוכה (מצב כהה) עבור ' + SLOT_LABELS[entry.idx] + '...');
            const darkCanvas = buildCleanOcrCanvas(img, true);
            const resDark = await worker.recognize(darkCanvas);
            const textDark = resDark?.data?.text || '';
            const scoreDark = scoreHebrewQuality(textDark);
            if (scoreDark > scoreLight) {
              bestText = textDark;
            }
          }

          const cleaned = cleanOcrNoise(bestText);
          if (cleaned) extractedParts.push(cleaned);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }

      await worker.terminate();
      worker = null;

      const combined = extractedParts.join('\n\n').trim();
      if (!combined) {
        setOcrError('לא זוהה טקסט ברור בתמונות. נסה להעלות צילום מסך חד וקרוב יותר לטקסט.');
      } else {
        onExtractedCombinedText(combined, activeEntries.length);
        setProgressText('הסריקה הושלמה בהצלחה מ-' + activeEntries.length + ' תמונות!');
      }
    } catch (err) {
      if (worker) {
        try {
          await worker.terminate();
        } catch {}
      }
      const msg = err instanceof Error ? err.message : 'שגיאה בסריקת התמונות';
      setOcrError('שגיאה בסריקת התמונות: ' + msg);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div
      dir="rtl"
      onPaste={handlePaste}
      className={
        'p-4 rounded-xl border space-y-3 ' +
        (darkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-amber-50/40 border-amber-200/80')
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold">
            סריקת צילומי מסך / סטורי למתכון (עד 3 תמונות ברצף — ללא AI)
          </h3>
          <p className={'text-[11px] ' + (darkMode ? 'text-slate-400' : 'text-stone-500')}>
            מזהה אוטומטית את תיבת המתכון, מחלץ חומרים ושלבים ומפריד הערות/טיפים לתיבה נפרדת
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={multiInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleMultiFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={scanning}
            onClick={() => multiInputRef.current?.click()}
            className={
              'px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ' +
              (darkMode
                ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-600'
                : 'bg-white hover:bg-amber-50 text-amber-900 border-amber-300')
            }
          >
            בחר עד 3 תמונות יחד
          </button>

          {filledCount > 0 && !scanning && (
            <button
              type="button"
              onClick={clearAllSlots}
              className="text-xs text-red-500 hover:underline px-1 cursor-pointer"
            >
              נקה תמונות
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((idx) => {
          const slot = slots[idx];
          return (
            <div
              key={idx}
              onClick={() => {
                if (!scanning) singleInputRefs[idx].current?.click();
              }}
              className={
                'relative h-32 rounded-xl border-2 border-dashed flex flex-col items-center justify-center overflow-hidden transition cursor-pointer ' +
                (slot
                  ? darkMode
                    ? 'border-amber-500/60 bg-slate-900'
                    : 'border-amber-400 bg-white'
                  : darkMode
                  ? 'border-slate-700 hover:border-amber-400/60 bg-slate-900/40'
                  : 'border-stone-300 hover:border-amber-400 bg-white/70')
              }
            >
              <input
                ref={singleInputRefs[idx]}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setSlotFile(idx, f);
                  e.target.value = '';
                }}
              />

              {slot ? (
                <>
                  <img
                    src={slot.previewUrl}
                    alt={SLOT_LABELS[idx]}
                    className="w-full h-full object-cover opacity-85"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[11px] font-semibold px-2 py-1 flex items-center justify-between">
                    <span>{SLOT_LABELS[idx]}</span>
                    <button
                      type="button"
                      disabled={scanning}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSlot(idx);
                      }}
                      className="text-red-300 hover:text-red-400 font-bold px-1 cursor-pointer"
                      title="הסר תמונה"
                    >
                      ✕
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center px-2 space-y-1">
                  <div className="w-6 h-6 mx-auto rounded-full bg-amber-500/20 text-amber-500 font-bold text-xs flex items-center justify-center">
                    {idx + 1}
                  </div>
                  <div className="text-xs font-semibold">{SLOT_LABELS[idx]}</div>
                  <div className={'text-[10px] ' + (darkMode ? 'text-slate-400' : 'text-stone-400')}>
                    לחץ להעלאת צילום מסך
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={scanning || filledCount === 0}
          onClick={handleScanScreenshots}
          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 text-xs font-bold transition cursor-pointer"
        >
          {scanning
            ? 'סורק תמונות... (' + progressPct + '%)'
            : 'חלץ מתכון והערות מ-' + (filledCount || 3) + ' התמונות (OCR)'}
        </button>

        {progressText && !ocrError && (
          <span className="text-xs font-medium text-emerald-500">{progressText}</span>
        )}
        {ocrError && <span className="text-xs font-medium text-red-500">{ocrError}</span>}
      </div>

      {scanning && (
        <div className="w-full h-1.5 rounded-full bg-slate-700/30 overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-all duration-200"
            style={{ width: Math.max(8, progressPct) + '%' }}
          />
        </div>
      )}
    </div>
  );
}
