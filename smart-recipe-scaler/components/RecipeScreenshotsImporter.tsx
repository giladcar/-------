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

function buildProcessedCanvas(
  img: HTMLImageElement,
  invertPolarity: boolean
): HTMLCanvasElement {
  const aspectRatio = img.height / Math.max(1, img.width);
  const isMobileScreenshot = aspectRatio >= 1.72;

  // חיתוך אוטומטי של סרגל הסטטוס העליון ורצועת הגלריה/ניווט התחתונה בצילומי מסך מהנייד
  const cropTop = isMobileScreenshot ? Math.round(img.height * 0.055) : 0;
  const cropBottom = isMobileScreenshot ? Math.round(img.height * 0.125) : 0;
  const srcWidth = img.width;
  const srcHeight = Math.max(100, img.height - cropTop - cropBottom);

  // הגדלת רזולוציה ל-~2200px רוחב כדי שאותיות בעברית וניקוד/סימנים ייקראו בחדות
  const targetWidth = Math.min(2600, Math.max(1800, Math.round(srcWidth * 2.1)));
  const scale = targetWidth / srcWidth;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(srcWidth * scale);
  canvas.height = Math.round(srcHeight * scale);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    img,
    0,
    cropTop,
    srcWidth,
    srcHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );

  // עיבוד פיקסלים דטרמיניסטי: ניגודיות חדה, ניקוי רקע צבעוני והתאמת מצב בהיר/כהה
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // חישוב בהירות (Luminance)
    let lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (invertPolarity) {
      lum = 255 - lum;
    }

    // חידוד ניגודיות (S-curve) כדי להפריד אותיות כהות מרקע בהיר ולשטוף רעשי תמונה
    let enhanced: number;
    if (lum < 115) {
      enhanced = Math.max(0, Math.round(lum * 0.45));
    } else if (lum > 185) {
      enhanced = 255;
    } else {
      enhanced = Math.min(255, Math.max(0, Math.round((lum - 115) * (255 / 70))));
    }

    data[i] = enhanced;
    data[i + 1] = enhanced;
    data[i + 2] = enhanced;
    data[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function scoreHebrewReadability(text: string): number {
  const cleaned = cleanOcrNoise(text);
  const hebrewWords = cleaned.match(/[א-ת]{2,}/g) || [];
  const recipeKeywords =
    cleaned.match(
      /(?:כוס|כוסות|כף|כפות|כפית|כפיות|גרם|קילו|בצל|שמן|מלח|פלפל|מים|תנור|לערבב|להוסיף|לטגן|לבשל|לאפות|דקות|שעה|אפשר)/g
    ) || [];
  return hebrewWords.length * 2 + recipeKeywords.length * 8;
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
    setProgressText('מכין מנוע קריאה חד בעברית ובאנגלית...');

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
          // סריקה 1: טקסט כהה על רקע בהיר (סטורי / בלוג / תיבת טקסט)
          const lightCanvas = buildProcessedCanvas(img, false);
          const resLight = await worker.recognize(lightCanvas);
          const textLight = resLight?.data?.text || '';
          const scoreLight = scoreHebrewReadability(textLight);

          let bestText = textLight;

          // אם הציון נמוך (למשל צילום מסך במצב כהה Dark Mode או טקסט לבן על רקע כהה), נריץ סריקה הפוכה
          if (scoreLight < 35) {
            setProgressText(
              'מבצע סריקת ניגודיות הפוכה ל-' + SLOT_LABELS[entry.idx] + '...'
            );
            const darkCanvas = buildProcessedCanvas(img, true);
            const resDark = await worker.recognize(darkCanvas);
            const textDark = resDark?.data?.text || '';
            const scoreDark = scoreHebrewReadability(textDark);
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
            מזהה אוטומטית מצרכים, שלבי הכנה והערות/החלפות מתוך כל צילום מסך (כולל סטורי ומצב כהה)
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
