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
  const marginX = 52;
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
      34,
      'bold 20px Arial, sans-serif',
      '#d97706',
      'right'
    );

    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marginX, 66);
    ctx.lineTo(rightEdge, 66);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(marginX, heightPx - 66);
    ctx.lineTo(rightEdge, heightPx - 66);
    ctx.stroke();

    drawAlignedLine(
      ctx,
      bookTitle,
      rightEdge,
      heightPx - 50,
      '18px Arial, sans-serif',
      '#6b7280',
      'right'
    );
    drawAlignedLine(
      ctx,
      'עמוד ' + pageNum,
      marginX + 60,
      heightPx - 50,
      'bold 18px Arial, sans-serif',
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
    let y = 90;

    drawAlignedLine(
      ctx,
      bookTitle,
      centerX,
      y,
      'bold 44px Arial, sans-serif',
      '#111827',
      'center'
    );
    y += 56;
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
      '20px Arial, sans-serif',
      '#4b5563',
      'center'
    );
    y += 44;
    drawAlignedLine(
      ctx,
      'תוכן עניינים',
      rightEdge,
      y,
      'bold 28px Arial, sans-serif',
      '#b45309',
      'right'
    );
    y += 38;

    for (const cat of toc) {
      if (y > heightPx - 96) break;
      for (const line of wrapHebrewLine(
        ctx,
        'קטגוריה: ' + cat.category + ' — עמוד ' + cat.categoryPage,
        contentWidth
      )) {
        if (y > heightPx - 96) break;
        drawAlignedLine(ctx, line, rightEdge, y, 'bold 22px Arial, sans-serif', '#b45309', 'right');
        y += 28;
      }

      for (const sub of cat.subCategories) {
        if (y > heightPx - 96) break;
        for (const line of wrapHebrewLine(
          ctx,
          '   תת-קטגוריה: ' + sub.subCategory + ' — עמוד ' + sub.subPage,
          contentWidth - 20
        )) {
          if (y > heightPx - 96) break;
          drawAlignedLine(ctx, line, rightEdge - 16, y, 'bold 19px Arial, sans-serif', '#1f2937', 'right');
          y += 25;
        }

        for (const r of sub.recipes) {
          if (y > heightPx - 96) break;
          for (const line of wrapHebrewLine(
            ctx,
            '      • ' + r.title + ' (עמוד ' + r.pageNumber + ')',
            contentWidth - 40
          )) {
            if (y > heightPx - 96) break;
            drawAlignedLine(ctx, line, rightEdge - 32, y, '18px Arial, sans-serif', '#374151', 'right');
            y += 23;
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
        550,
        'bold 32px Arial, sans-serif',
        '#d97706',
        'center'
      );

      const bigTitleLines = wrapHebrewLine(ctx, banner.title, contentWidth - 40);
      let by = 615;
      for (const bLine of bigTitleLines) {
        drawAlignedLine(
          ctx,
          bLine,
          centerX,
          by,
          isCat ? 'bold 84px Arial, sans-serif' : 'bold 66px Arial, sans-serif',
          isCat ? '#b45309' : '#111827',
          'center'
        );
        by += isCat ? 102 : 82;
      }

      drawAlignedLine(
        ctx,
        (banner.recipeCount || 0) + ' מתכונים • עמוד ' + banner.pageNumber,
        centerX,
        by + 20,
        '25px Arial, sans-serif',
        '#4b5563',
        'center'
      );

      pageCanvases.push(canvas);
      continue;
    }

    const colGap = 36;
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

        for (const tLine of wrapHebrewLine(ctx, titleText, colWidth - 12)) {
          allItems.push({
            text: tLine,
            font: 'bold 22px Arial, sans-serif',
            color: '#111827',
            lineHeight: 28,
          });
        }

        const ings = blk.ingredients || [];
        if (ings.length > 0) {
          allItems.push({
            text: 'מצרכים:',
            font: 'bold 19px Arial, sans-serif',
            color: '#b45309',
            lineHeight: 25,
          });
          for (const ing of ings) {
            const scaled = parseAndScaleLine(
              ing,
              factor,
              rec.dietMode,
              rec.convertToGrams,
              measureSystem
            ).displayText;
            for (const iLine of wrapHebrewLine(ctx, '• ' + scaled, colWidth - 24)) {
              allItems.push({
                text: iLine,
                font: '18px Arial, sans-serif',
                color: '#1f2937',
                lineHeight: 23,
                indentPx: 10,
              });
            }
          }
        }

        const steps = blk.steps || [];
        if (steps.length > 0) {
          allItems.push({
            text: 'שלבי הכנה:',
            font: 'bold 19px Arial, sans-serif',
            color: '#b45309',
            lineHeight: 25,
          });
          steps.forEach((st, idx) => {
            for (const sLine of wrapHebrewLine(ctx, idx + 1 + '. ' + st, colWidth - 24)) {
              allItems.push({
                text: sLine,
                font: '18px Arial, sans-serif',
                color: '#1f2937',
                lineHeight: 23,
                indentPx: 10,
              });
            }
          });
        }

        allItems.push({
          text: '',
          font: '18px Arial, sans-serif',
          color: '#1f2937',
          lineHeight: 12,
        });
      }
    }

    const startY = 86;
    const bottomLimit = heightPx - 82;

    // קו הפרדה אנכי בין הטור הימני לטור השמאלי
    const dividerX = rightEdge - colWidth - colGap / 2;
    ctx.save();
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(dividerX, startY);
    ctx.lineTo(dividerX, bottomLimit);
    ctx.stroke();
    ctx.restore();

    // חלוקה ל-2 טורים: חצי ראשון בטור הימני, חצי שני בטור השמאלי
    const splitAt = allItems.length > 14 ? Math.ceil(allItems.length / 2) : allItems.length;

    let ry = startY;
    for (let i = 0; i < splitAt; i++) {
      const item = allItems[i];
      if (ry + item.lineHeight > bottomLimit) break;
      if (item.text) {
        drawAlignedLine(
          ctx,
          item.text,
          rightColX - (item.indentPx || 0),
          ry,
          item.font,
          item.color,
          'right'
        );
      }
      ry += item.lineHeight;
    }

    let ly = startY;
    for (let i = splitAt; i < allItems.length; i++) {
      const item = allItems[i];
      if (ly + item.lineHeight > bottomLimit) break;
      if (item.text) {
        drawAlignedLine(
          ctx,
          item.text,
          leftColX - (item.indentPx || 0),
          ly,
          item.font,
          item.color,
          'right'
        );
      }
      ly += item.lineHeight;
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
