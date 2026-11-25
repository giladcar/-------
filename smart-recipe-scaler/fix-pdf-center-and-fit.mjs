import fs from 'node:fs';
import path from 'node:path';

const bookLibPath = path.join(process.cwd(), 'lib', 'recipeBook.ts');
const pdfLibPath = path.join(process.cwd(), 'lib', 'pdfBookExporter.ts');

if (fs.existsSync(bookLibPath)) {
  let bookContent = fs.readFileSync(bookLibPath, 'utf8');
  bookContent = bookContent.replace(
    /export const FIXED_PAGE_CAPACITY_LINES = \d+;/,
    'export const FIXED_PAGE_CAPACITY_LINES = 42;'
  );
  fs.writeFileSync(bookLibPath, bookContent, 'utf8');
}

const updatedPdfCode = `import { BookPageSheet, TocEntry, FIXED_PAGE_CAPACITY_LINES } from '@/lib/recipeBook';
import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';

function wrapHebrewLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\\s+/).filter(Boolean);
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
  const marginX = 68;
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
      42,
      'bold 20px Arial, sans-serif',
      '#d97706',
      'right'
    );

    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marginX, 78);
    ctx.lineTo(rightEdge, 78);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(marginX, heightPx - 78);
    ctx.lineTo(rightEdge, heightPx - 78);
    ctx.stroke();

    drawAlignedLine(
      ctx,
      bookTitle,
      rightEdge,
      heightPx - 60,
      '18px Arial, sans-serif',
      '#6b7280',
      'right'
    );
    drawAlignedLine(
      ctx,
      'עמוד ' + pageNum,
      marginX + 70,
      heightPx - 60,
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
    let y = 104;

    drawAlignedLine(
      ctx,
      bookTitle,
      centerX,
      y,
      'bold 42px Arial, sans-serif',
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
    y += 46;
    drawAlignedLine(
      ctx,
      'תוכן עניינים',
      rightEdge,
      y,
      'bold 28px Arial, sans-serif',
      '#b45309',
      'right'
    );
    y += 40;

    for (const cat of toc) {
      if (y > heightPx - 120) break;
      for (const line of wrapHebrewLine(
        ctx,
        'קטגוריה: ' + cat.category + ' — עמוד ' + cat.categoryPage,
        contentWidth
      )) {
        if (y > heightPx - 120) break;
        drawAlignedLine(ctx, line, rightEdge, y, 'bold 22px Arial, sans-serif', '#b45309', 'right');
        y += 29;
      }

      for (const sub of cat.subCategories) {
        if (y > heightPx - 120) break;
        for (const line of wrapHebrewLine(
          ctx,
          '   תת-קטגוריה: ' + sub.subCategory + ' — עמוד ' + sub.subPage,
          contentWidth - 20
        )) {
          if (y > heightPx - 120) break;
          drawAlignedLine(ctx, line, rightEdge - 16, y, 'bold 19px Arial, sans-serif', '#1f2937', 'right');
          y += 25;
        }

        for (const r of sub.recipes) {
          if (y > heightPx - 120) break;
          for (const line of wrapHebrewLine(
            ctx,
            '      • ' + r.title + ' (עמוד ' + r.pageNumber + ')',
            contentWidth - 40
          )) {
            if (y > heightPx - 120) break;
            drawAlignedLine(ctx, line, rightEdge - 32, y, '17px Arial, sans-serif', '#374151', 'right');
            y += 23;
          }
        }
      }
      y += 8;
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
          isCat ? 'bold 78px Arial, sans-serif' : 'bold 62px Arial, sans-serif',
          isCat ? '#b45309' : '#111827',
          'center'
        );
        by += isCat ? 96 : 78;
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

    const recipeBlocks = sheet.blocks.filter((b) => b.kind === 'recipe-part' && b.recipe);
    const useTwoColumns = recipeBlocks.length > 1;
    const colGap = 36;
    const colWidth = useTwoColumns ? (contentWidth - colGap) / 2 : contentWidth;

    const drawRecipeInColumn = (
      blk: NonNullable<BookPageSheet['blocks'][number]>,
      colRightX: number,
      startY: number
    ) => {
      if (!blk.recipe) return startY;
      const rec = blk.recipe;
      const factor = rec.originalServings > 0 ? rec.targetServings / rec.originalServings : 1;
      let y = startY;
      const bottomLimit = heightPx - 110;

      const titleText =
        (rec.favorite ? '★ ' : '') +
        rec.title +
        (blk.isContinuation ? ' (המשך)' : '') +
        ' — ' +
        rec.targetServings +
        ' מנות';

      for (const tLine of wrapHebrewLine(ctx, titleText, colWidth)) {
        if (y > bottomLimit) break;
        drawAlignedLine(ctx, tLine, colRightX, y, 'bold 21px Arial, sans-serif', '#111827', 'right');
        y += 28;
      }

      const ings = blk.ingredients || [];
      if (ings.length > 0 && y <= bottomLimit) {
        drawAlignedLine(ctx, 'מצרכים:', colRightX, y, 'bold 18px Arial, sans-serif', '#b45309', 'right');
        y += 24;
        for (const ing of ings) {
          const scaled = parseAndScaleLine(
            ing,
            factor,
            rec.dietMode,
            rec.convertToGrams,
            measureSystem
          ).displayText;
          for (const iLine of wrapHebrewLine(ctx, '• ' + scaled, colWidth - 14)) {
            if (y > bottomLimit) break;
            drawAlignedLine(ctx, iLine, colRightX - 10, y, '17px Arial, sans-serif', '#1f2937', 'right');
            y += 23;
          }
        }
      }

      const steps = blk.steps || [];
      if (steps.length > 0 && y <= bottomLimit) {
        y += 4;
        drawAlignedLine(ctx, 'שלבי הכנה:', colRightX, y, 'bold 18px Arial, sans-serif', '#b45309', 'right');
        y += 24;
        steps.forEach((st, idx) => {
          for (const sLine of wrapHebrewLine(ctx, idx + 1 + '. ' + st, colWidth - 14)) {
            if (y > bottomLimit) break;
            drawAlignedLine(ctx, sLine, colRightX - 10, y, '17px Arial, sans-serif', '#1f2937', 'right');
            y += 23;
          }
        });
      }

      return y + 16;
    };

    if (useTwoColumns) {
      let rightColY = 104;
      let leftColY = 104;
      recipeBlocks.forEach((blk, idx) => {
        if (idx % 2 === 0) {
          rightColY = drawRecipeInColumn(blk, rightEdge, rightColY);
        } else {
          leftColY = drawRecipeInColumn(blk, rightEdge - colWidth - colGap, leftColY);
        }
      });
    } else {
      let y = 104;
      for (const blk of recipeBlocks) {
        y = drawRecipeInColumn(blk, rightEdge, y);
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

  const chunks: Array<string | Uint8Array> = ['%PDF-1.4\\n'];
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

    const drawCmd = 'q\\n595 0 0 842 0 0 cm\\n/Im' + imgId + ' Do\\nQ\\n';

    objDefinitions.push({
      id: imgId,
      header:
        '<< /Type /XObject /Subtype /Image /Width ' +
        p.widthPx +
        ' /Height ' +
        p.heightPx +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
        p.jpegBytes.length +
        ' >>\\nstream\\n',
      stream: p.jpegBytes,
      footer: '\\nendstream',
    });

    const cmdBytes = new TextEncoder().encode(drawCmd);
    objDefinitions.push({
      id: contentId,
      header: '<< /Length ' + cmdBytes.length + ' >>\\nstream\\n',
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
    pushStr(obj.id + ' 0 obj\\n' + obj.header);
    if (obj.stream) {
      pushBytes(obj.stream);
    }
    if (obj.footer) {
      pushStr(obj.footer);
    }
    pushStr('\\nendobj\\n');
  }

  const xrefStart = currentLength;
  pushStr('xref\\n0 ' + (allObjs.length + 1) + '\\n');
  pushStr('0000000000 65535 f \\n');
  for (let i = 1; i <= allObjs.length; i++) {
    pushStr(String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \\n');
  }

  pushStr(
    'trailer\\n<< /Size ' +
      (allObjs.length + 1) +
      ' /Root ' +
      catalogId +
      ' 0 R >>\\nstartxref\\n' +
      xrefStart +
      '\\n%%EOF'
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
`;

fs.mkdirSync(path.join(process.cwd(), 'lib'), { recursive: true });
fs.writeFileSync(pdfLibPath, updatedPdfCode, 'utf8');

console.log('עודכן בהצלחה דרך fix-pdf-center-and-fit.mjs: כותרות קטגוריות ממורכזות וגדולות, והתאמת גודל עמוד.');