import { BookPageSheet, TocEntry, FIXED_PAGE_CAPACITY_LINES } from '@/lib/recipeBook';
import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';

function wrapHebrewLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawRtlLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  rightX: number,
  y: number,
  font: string,
  color: string
): void {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.direction = 'rtl';
  ctx.fillText(text, rightX, y);
  ctx.restore();
}

function renderPagesToJpegDataUrls(params: {
  bookTitle: string;
  dateLabel: string;
  scopeLabel: string;
  measureSystem: MeasureSystem;
  sheets: BookPageSheet[];
  toc: TocEntry[];
}): Array<{ jpegBytes: Uint8Array; widthPx: number; heightPx: number }> {
  const { bookTitle, dateLabel, scopeLabel, measureSystem, sheets, toc } = params;

  // יחס A4 ברזולוציה חדה (פי 2 מ-595x842)
  const widthPx = 1190;
  const heightPx = 1684;
  const marginX = 76;
  const contentWidth = widthPx - marginX * 2;
  const rightEdge = widthPx - marginX;

  const pageCanvases: HTMLCanvasElement[] = [];

  const createPageCanvas = (pageNum: number, subtitle: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthPx, heightPx);

    // כותרת עליונה
    drawRtlLine(
      ctx,
      'עמוד ' + pageNum + ' • ' + subtitle,
      rightEdge,
      44,
      'bold 22px Arial, sans-serif',
      '#d97706'
    );

    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marginX, 82);
    ctx.lineTo(rightEdge, 82);
    ctx.stroke();

    // כותרת תחתונה
    ctx.beginPath();
    ctx.moveTo(marginX, heightPx - 82);
    ctx.lineTo(rightEdge, heightPx - 82);
    ctx.stroke();

    drawRtlLine(ctx, bookTitle, rightEdge, heightPx - 64, '18px Arial, sans-serif', '#6b7280');
    drawRtlLine(
      ctx,
      'עמוד ' + pageNum,
      marginX + 80,
      heightPx - 64,
      'bold 18px Arial, sans-serif',
      '#374151'
    );

    return { canvas, ctx };
  };

  // עמוד 1: כריכה ותוכן עניינים
  const cover = createPageCanvas(
    1,
    'גודל עמוד קבוע (' + FIXED_PAGE_CAPACITY_LINES + ' שורות לעמוד)'
  );
  if (cover) {
    const { canvas, ctx } = cover;
    let y = 110;

    drawRtlLine(ctx, bookTitle, rightEdge, y, 'bold 40px Arial, sans-serif', '#111827');
    y += 56;
    drawRtlLine(
      ctx,
      'תאריך: ' +
        dateLabel +
        ' | היקף: ' +
        scopeLabel +
        ' | מידות: ' +
        (measureSystem === 'us' ? 'אמריקאיות' : 'מטריות'),
      rightEdge,
      y,
      '20px Arial, sans-serif',
      '#4b5563'
    );
    y += 46;
    drawRtlLine(ctx, 'תוכן עניינים', rightEdge, y, 'bold 28px Arial, sans-serif', '#b45309');
    y += 42;

    for (const cat of toc) {
      if (y > heightPx - 130) break;
      const catWrapped = wrapHebrewLine(
        ctx,
        'קטגוריה: ' + cat.category + ' — עמוד ' + cat.categoryPage,
        contentWidth
      );
      for (const line of catWrapped) {
        if (y > heightPx - 130) break;
        drawRtlLine(ctx, line, rightEdge, y, 'bold 22px Arial, sans-serif', '#b45309');
        y += 30;
      }

      for (const sub of cat.subCategories) {
        if (y > heightPx - 130) break;
        const subWrapped = wrapHebrewLine(
          ctx,
          '   תת-קטגוריה: ' + sub.subCategory + ' — עמוד ' + sub.subPage,
          contentWidth - 20
        );
        for (const line of subWrapped) {
          if (y > heightPx - 130) break;
          drawRtlLine(ctx, line, rightEdge - 16, y, 'bold 19px Arial, sans-serif', '#1f2937');
          y += 26;
        }

        for (const r of sub.recipes) {
          if (y > heightPx - 130) break;
          const recWrapped = wrapHebrewLine(
            ctx,
            '      • ' + r.title + ' (עמוד ' + r.pageNumber + ')',
            contentWidth - 40
          );
          for (const line of recWrapped) {
            if (y > heightPx - 130) break;
            drawRtlLine(ctx, line, rightEdge - 32, y, '17px Arial, sans-serif', '#374151');
            y += 24;
          }
        }
      }
      y += 10;
    }

    pageCanvases.push(canvas);
  }

  // עמודי התוכן של הספר
  for (const sheet of sheets) {
    const pageObj = createPageCanvas(
      sheet.pageNumber,
      'גודל קבוע: ' + sheet.usedLines + '/' + sheet.capacity + ' (' + sheet.fillFraction + ')'
    );
    if (!pageObj) continue;
    const { canvas, ctx } = pageObj;

    const isBannerSheet =
      sheet.blocks.length === 1 &&
      (sheet.blocks[0].kind === 'category-banner' ||
        sheet.blocks[0].kind === 'subcategory-banner');

    if (isBannerSheet) {
      const banner = sheet.blocks[0];
      const isCat = banner.kind === 'category-banner';
      drawRtlLine(
        ctx,
        isCat ? 'קטגוריה ראשית' : banner.category,
        rightEdge,
        540,
        'bold 28px Arial, sans-serif',
        '#d97706'
      );
      const bigTitleLines = wrapHebrewLine(ctx, banner.title, contentWidth);
      let by = 600;
      for (const bLine of bigTitleLines) {
        drawRtlLine(
          ctx,
          bLine,
          rightEdge,
          by,
          isCat ? 'bold 64px Arial, sans-serif' : 'bold 52px Arial, sans-serif',
          isCat ? '#b45309' : '#111827'
        );
        by += isCat ? 80 : 66;
      }
      drawRtlLine(
        ctx,
        (banner.recipeCount || 0) + ' מתכונים • עמוד ' + banner.pageNumber,
        rightEdge,
        by + 20,
        '24px Arial, sans-serif',
        '#4b5563'
      );
      pageCanvases.push(canvas);
      continue;
    }

    let y = 110;
    for (const blk of sheet.blocks) {
      if (y > heightPx - 130) break;
      if (blk.kind === 'recipe-part' && blk.recipe) {
        const rec = blk.recipe;
        const factor = rec.originalServings > 0 ? rec.targetServings / rec.originalServings : 1;

        const titleText =
          (rec.favorite ? '★ ' : '') +
          rec.title +
          (blk.isContinuation ? ' (המשך)' : '') +
          ' — ' +
          rec.targetServings +
          ' מנות';

        for (const tLine of wrapHebrewLine(ctx, titleText, contentWidth)) {
          if (y > heightPx - 130) break;
          drawRtlLine(ctx, tLine, rightEdge, y, 'bold 23px Arial, sans-serif', '#111827');
          y += 30;
        }

        const ings = blk.ingredients || [];
        if (ings.length > 0 && y <= heightPx - 130) {
          drawRtlLine(ctx, 'מצרכים:', rightEdge, y, 'bold 19px Arial, sans-serif', '#b45309');
          y += 26;
          for (const ing of ings) {
            const scaled = parseAndScaleLine(
              ing,
              factor,
              rec.dietMode,
              rec.convertToGrams,
              measureSystem
            ).displayText;
            for (const iLine of wrapHebrewLine(ctx, '• ' + scaled, contentWidth - 16)) {
              if (y > heightPx - 130) break;
              drawRtlLine(ctx, iLine, rightEdge - 12, y, '18px Arial, sans-serif', '#1f2937');
              y += 25;
            }
          }
        }

        const steps = blk.steps || [];
        if (steps.length > 0 && y <= heightPx - 130) {
          y += 6;
          drawRtlLine(ctx, 'שלבי הכנה:', rightEdge, y, 'bold 19px Arial, sans-serif', '#b45309');
          y += 26;
          steps.forEach((st, idx) => {
            for (const sLine of wrapHebrewLine(
              ctx,
              idx + 1 + '. ' + st,
              contentWidth - 16
            )) {
              if (y > heightPx - 130) break;
              drawRtlLine(ctx, sLine, rightEdge - 12, y, '18px Arial, sans-serif', '#1f2937');
              y += 25;
            }
          });
        }

        y += 18;
      }
    }

    pageCanvases.push(canvas);
  }

  return pageCanvases.map((c) => {
    const dataUrl = c.toDataURL('image/jpeg', 0.92);
    const base64 = dataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { jpegBytes: bytes, widthPx: c.width, heightPx: c.height };
  });
}

export function downloadStructuredRecipeBookPdf(params: {
  bookTitle: string;
  dateLabel: string;
  scopeLabel: string;
  measureSystem: MeasureSystem;
  sheets: BookPageSheet[];
  toc: TocEntry[];
}): void {
  if (typeof document === 'undefined') return;

  const renderedPages = renderPagesToJpegDataUrls(params);
  if (renderedPages.length === 0) return;

  // בניית קובץ PDF תקני המכיל תמונת A4 לכל עמוד
  const chunks: Array<string | Uint8Array> = ['%PDF-1.4\n'];
  const offsets: number[] = [0];
  let currentLength = chunks[0].length as number;

  const pushStr = (s: string) => {
    chunks.push(s);
    currentLength += s.length;
  };

  const pushBytes = (b: Uint8Array) => {
    chunks.push(b);
    currentLength += b.length;
  };

  let nextObjId = 1;
  const catalogId = nextObjId++;
  const pagesId = nextObjId++;

  const pageEntries: Array<{ pageObjId: number }> = [];
  const objDefinitions: Array<{ id: number; header: string; stream?: Uint8Array; footer?: string }> =
    [];

  for (const p of renderedPages) {
    const imgId = nextObjId++;
    const contentId = nextObjId++;
    const pageObjId = nextObjId++;

    const drawCmd =
      'q\n595 0 0 842 0 0 cm\n/Im' + imgId + ' Do\nQ\n';

    objDefinitions.push({
      id: imgId,
      header:
        '<< /Type /XObject /Subtype /Image /Width ' +
        p.widthPx +
        ' /Height ' +
        p.heightPx +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
        p.jpegBytes.length +
        ' >>\nstream\n',
      stream: p.jpegBytes,
      footer: '\nendstream',
    });

    const cmdBytes = new TextEncoder().encode(drawCmd);
    objDefinitions.push({
      id: contentId,
      header: '<< /Length ' + cmdBytes.length + ' >>\nstream\n',
      stream: cmdBytes,
      footer: 'endstream',
    });

    objDefinitions.push({
      id: pageObjId,
      header:
        '<< /Type /Page /Parent ' +
        pagesId +
        ' 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im' +
        imgId +
        ' ' +
        imgId +
        ' 0 R >> >> /Contents ' +
        contentId +
        ' 0 R >>',
    });

    pageEntries.push({ pageObjId });
  }

  const allObjs: Array<{ id: number; header: string; stream?: Uint8Array; footer?: string }> = [
    { id: catalogId, header: '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>' },
    {
      id: pagesId,
      header:
        '<< /Type /Pages /Kids [' +
        pageEntries.map((e) => e.pageObjId + ' 0 R').join(' ') +
        '] /Count ' +
        pageEntries.length +
        ' >>',
    },
    ...objDefinitions,
  ].sort((a, b) => a.id - b.id);

  for (const obj of allObjs) {
    offsets[obj.id] = currentLength;
    pushStr(obj.id + ' 0 obj\n' + obj.header);
    if (obj.stream) {
      pushBytes(obj.stream);
    }
    if (obj.footer) {
      pushStr(obj.footer);
    }
    pushStr('\nendobj\n');
  }

  const xrefStart = currentLength;
  pushStr('xref\n0 ' + (allObjs.length + 1) + '\n');
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i <= allObjs.length; i++) {
    pushStr(String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \n');
  }

  pushStr(
    'trailer\n<< /Size ' +
      (allObjs.length + 1) +
      ' /Root ' +
      catalogId +
      ' 0 R >>\nstartxref\n' +
      xrefStart +
      '\n%%EOF'
  );

  const blob = new Blob(chunks as BlobPart[], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeFileName = (params.bookTitle.trim() || 'recipe-book').replace(/[^a-zA-Z0-9_-]+/g, '-');
  link.href = url;
  link.download = safeFileName + '.pdf';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
