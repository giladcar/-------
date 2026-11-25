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

function drawAlignedLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = 'right'
): void {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.direction = 'rtl';
  ctx.fillText(text, x, y);
  ctx.restore();
}

interface DrawLineItem {
  text: string;
  font: string;
  color: string;
  lineHeight: number;
  indentPx?: number;
  gapAfter?: number;
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

  const widthPx = 1190;
  const heightPx = 1684;
  const marginX = 56;
  const contentWidth = widthPx - marginX * 2;
  const rightEdge = widthPx - marginX;
  const centerX = widthPx / 2;

  const pageCanvases: HTMLCanvasElement[] = [];

  const createPageCanvas = (pageNum: number, subtitle: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthPx, heightPx);

    drawAlignedLine(
      ctx,
      'עמוד ' + pageNum + ' • ' + subtitle,
      rightEdge,
      36,
      'bold 19px Arial, sans-serif',
      '#d97706',
      'right'
    );

    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marginX, 68);
    ctx.lineTo(rightEdge, 68);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(marginX, heightPx - 68);
    ctx.lineTo(rightEdge, heightPx - 68);
    ctx.stroke();

    drawAlignedLine(
      ctx,
      bookTitle,
      rightEdge,
      heightPx - 52,
      '17px Arial, sans-serif',
      '#6b7280',
      'right'
    );
    drawAlignedLine(
      ctx,
      'עמוד ' + pageNum,
      marginX + 60,
      heightPx - 52,
      'bold 17px Arial, sans-serif',
      '#374151',
      'left'
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
    let y = 92;

    drawAlignedLine(
      ctx,
      bookTitle,
      centerX,
      y,
      'bold 42px Arial, sans-serif',
      '#111827',
      'center'
    );
    y += 54;
    drawAlignedLine(
      ctx,
      'תאריך: ' +
        dateLabel +
        ' | היקף: ' +
        scopeLabel +
        ' | מידות: ' +
        (measureSystem === 'us' ? 'אמריקאיות' : 'מטריות'),
      centerX,
      y,
      '19px Arial, sans-serif',
      '#4b5563',
      'center'
    );
    y += 42;
    drawAlignedLine(
      ctx,
      'תוכן עניינים',
      rightEdge,
      y,
      'bold 26px Arial, sans-serif',
      '#b45309',
      'right'
    );
    y += 36;

    for (const cat of toc) {
      if (y > heightPx - 100) break;
      for (const line of wrapHebrewLine(
        ctx,
        'קטגוריה: ' + cat.category + ' — עמוד ' + cat.categoryPage,
        contentWidth
      )) {
        if (y > heightPx - 100) break;
        drawAlignedLine(ctx, line, rightEdge, y, 'bold 21px Arial, sans-serif', '#b45309', 'right');
        y += 27;
      }

      for (const sub of cat.subCategories) {
        if (y > heightPx - 100) break;
        for (const line of wrapHebrewLine(
          ctx,
          '   תת-קטגוריה: ' + sub.subCategory + ' — עמוד ' + sub.subPage,
          contentWidth - 20
        )) {
          if (y > heightPx - 100) break;
          drawAlignedLine(ctx, line, rightEdge - 16, y, 'bold 18px Arial, sans-serif', '#1f2937', 'right');
          y += 24;
        }

        for (const r of sub.recipes) {
          if (y > heightPx - 100) break;
          for (const line of wrapHebrewLine(
            ctx,
            '      • ' + r.title + ' (עמוד ' + r.pageNumber + ')',
            contentWidth - 40
          )) {
            if (y > heightPx - 100) break;
            drawAlignedLine(ctx, line, rightEdge - 32, y, '17px Arial, sans-serif', '#374151', 'right');
            y += 22;
          }
        }
      }
      y += 6;
    }

    pageCanvases.push(canvas);
  }

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

      drawAlignedLine(
        ctx,
        isCat ? 'קטגוריה ראשית' : banner.category,
        centerX,
        560,
        'bold 30px Arial, sans-serif',
        '#d97706',
        'center'
      );

      const bigTitleLines = wrapHebrewLine(ctx, banner.title, contentWidth - 40);
      let by = 620;
      for (const bLine of bigTitleLines) {
        drawAlignedLine(
          ctx,
          bLine,
          centerX,
          by,
          isCat ? 'bold 80px Arial, sans-serif' : 'bold 64px Arial, sans-serif',
          isCat ? '#b45309' : '#111827',
          'center'
        );
        by += isCat ? 98 : 80;
      }

      drawAlignedLine(
        ctx,
        (banner.recipeCount || 0) + ' מתכונים • עמוד ' + banner.pageNumber,
        centerX,
        by + 20,
        '24px Arial, sans-serif',
        '#4b5563',
        'center'
      );

      pageCanvases.push(canvas);
      continue;
    }

    // בניית רשימת שורות מלאה עבור העמוד וזרימה ב-2 עמודות (ימין ואז שמאל) למילוי מיטבי
    const colGap = 32;
    const colWidth = (contentWidth - colGap) / 2;
    const rightColX = rightEdge;
    const leftColX = rightEdge - colWidth - colGap;

    const allItems: DrawLineItem[] = [];

    for (const blk of sheet.blocks) {
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

        for (const tLine of wrapHebrewLine(ctx, titleText, colWidth)) {
          allItems.push({
            text: tLine,
            font: 'bold 19px Arial, sans-serif',
            color: '#111827',
            lineHeight: 24,
          });
        }

        const ings = blk.ingredients || [];
        if (ings.length > 0) {
          allItems.push({
            text: 'מצרכים:',
            font: 'bold 17px Arial, sans-serif',
            color: '#b45309',
            lineHeight: 22,
          });
          for (const ing of ings) {
            const scaled = parseAndScaleLine(
              ing,
              factor,
              rec.dietMode,
              rec.convertToGrams,
              measureSystem
            ).displayText;
            for (const iLine of wrapHebrewLine(ctx, '• ' + scaled, colWidth - 12)) {
              allItems.push({
                text: iLine,
                font: '16px Arial, sans-serif',
                color: '#1f2937',
                lineHeight: 20,
                indentPx: 10,
              });
            }
          }
        }

        const steps = blk.steps || [];
        if (steps.length > 0) {
          allItems.push({
            text: 'שלבי הכנה:',
            font: 'bold 17px Arial, sans-serif',
            color: '#b45309',
            lineHeight: 22,
          });
          steps.forEach((st, idx) => {
            for (const sLine of wrapHebrewLine(ctx, idx + 1 + '. ' + st, colWidth - 12)) {
              allItems.push({
                text: sLine,
                font: '16px Arial, sans-serif',
                color: '#1f2937',
                lineHeight: 20,
                indentPx: 10,
              });
            }
          });
        }

        allItems.push({
          text: '',
          font: '16px Arial, sans-serif',
          color: '#1f2937',
          lineHeight: 12,
        });
      }
    }

    const startY = 88;
    const bottomLimit = heightPx - 84;
    let currentX = rightColX;
    let y = startY;
    let movedToLeftCol = false;

    for (const item of allItems) {
      if (y + item.lineHeight > bottomLimit) {
        if (!movedToLeftCol) {
          currentX = leftColX;
          y = startY;
          movedToLeftCol = true;
        } else {
          break;
        }
      }

      if (item.text) {
        drawAlignedLine(
          ctx,
          item.text,
          currentX - (item.indentPx || 0),
          y,
          item.font,
          item.color,
          'right'
        );
      }
      y += item.lineHeight;
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

    const drawCmd = 'q\n595 0 0 842 0 0 cm\n/Im' + imgId + ' Do\nQ\n';

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
