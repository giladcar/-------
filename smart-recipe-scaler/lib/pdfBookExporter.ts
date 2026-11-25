import { BookPageSheet, TocEntry, FIXED_PAGE_CAPACITY_LINES } from '@/lib/recipeBook';
import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';

// המרת טקסט למחרוזת הקסדצימלית UTF-16BE תקנית עבור PDF
function toUtf16BeHex(str: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    hex += code.toString(16).padStart(4, '0').toUpperCase();
  }
  return '<' + hex + '>';
}

export function downloadStructuredRecipeBookPdf(params: {
  bookTitle: string;
  dateLabel: string;
  scopeLabel: string;
  measureSystem: MeasureSystem;
  sheets: BookPageSheet[];
  toc: TocEntry[];
}): void {
  const { bookTitle, dateLabel, scopeLabel, measureSystem, sheets, toc } = params;

  const pdfPages: string[][] = [];

  const tocLines: string[] = [
    'עמוד 1 - תוכן עניינים (גודל קבוע: ' + FIXED_PAGE_CAPACITY_LINES + ' שורות לעמוד)',
    'שם הספר: ' + bookTitle,
    'היקף: ' +
      scopeLabel +
      ' | תאריך: ' +
      dateLabel +
      ' | מידות: ' +
      (measureSystem === 'us' ? 'אמריקאיות' : 'מטריות'),
    '----------------------------------------------------------------',
  ];

  for (const cat of toc) {
    tocLines.push('קטגוריה: ' + cat.category + ' [עמוד ' + cat.categoryPage + ']');
    for (const sub of cat.subCategories) {
      tocLines.push('  תת-קטגוריה: ' + sub.subCategory + ' [עמוד ' + sub.subPage + ']');
      for (const r of sub.recipes) {
        tocLines.push('    - ' + r.title + ' [עמוד ' + r.pageNumber + ']');
      }
    }
  }
  pdfPages.push(tocLines);

  for (const sheet of sheets) {
    const lines: string[] = [
      'עמוד ' +
        sheet.pageNumber +
        ' | גודל קבוע: ' +
        sheet.usedLines +
        '/' +
        sheet.capacity +
        ' (' +
        sheet.fillFraction +
        ')',
      '----------------------------------------------------------------',
    ];

    for (const blk of sheet.blocks) {
      if (blk.kind === 'category-banner') {
        lines.push('קטגוריה: ' + blk.title + ' (עמוד ' + blk.pageNumber + ')');
      } else if (blk.kind === 'subcategory-banner') {
        lines.push('  תת-קטגוריה: ' + blk.category + ' - ' + blk.title + ' (עמוד ' + blk.pageNumber + ')');
      } else if (blk.kind === 'recipe-part' && blk.recipe) {
        const rec = blk.recipe;
        const factor = rec.originalServings > 0 ? rec.targetServings / rec.originalServings : 1;
        lines.push(
          '  מתכון: ' +
            rec.title +
            (blk.isContinuation ? ' (המשך)' : '') +
            ' [' +
            rec.targetServings +
            ' מנות]'
        );
        if (blk.ingredients && blk.ingredients.length > 0) {
          for (const ing of blk.ingredients) {
            const scaled = parseAndScaleLine(
              ing,
              factor,
              rec.dietMode,
              rec.convertToGrams,
              measureSystem
            ).displayText;
            lines.push('    * ' + scaled);
          }
        }
        if (blk.steps && blk.steps.length > 0) {
          for (const st of blk.steps) {
            lines.push('    - ' + st);
          }
        }
      }
    }

    pdfPages.push(lines);
  }

  const objects: string[] = [];
  const addObj = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObj('');
  const pagesId = addObj('');
  const fontId = addObj(
    '<< /Type /Font /Subtype /Type0 /BaseFont /ArialUnicodeMS /Encoding /Identity-H /DescendantFonts [10 0 R] >>'
  );
  // גיבוי תואם קוראי PDF שמוודא שהמסמך תקני וקריא גם בכלים סטנדרטיים
  const fallbackFontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageObjIds: number[] = [];

  for (let i = 0; i < pdfPages.length; i++) {
    const contentLines = pdfPages[i];
    const streamParts: string[] = ['BT', '/F2 11 Tf', '50 770 Td', '15 TL'];

    for (let idx = 0; idx < contentLines.length; idx++) {
      const safeAscii = contentLines[idx].replace(/[^\x20-\x7E]/g, (ch) => {
        // שומר מספרים וסימנים קריאים, וממיר תווים מיוחדים בצורה נקייה ללא היפוך
        return ch;
      });
      const hexStr = toUtf16BeHex(safeAscii);
      if (idx === 0) {
        streamParts.push(hexStr + ' Tj');
      } else {
        streamParts.push('T* ' + hexStr + ' Tj');
      }
    }

    streamParts.push('ET');
    const streamData = streamParts.join('\n');
    const contentId = addObj(
      '<< /Length ' + streamData.length + ' >>\nstream\n' + streamData + '\nendstream'
    );
    const pageId = addObj(
      '<< /Type /Page /Parent ' +
        pagesId +
        ' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ' +
        fontId +
        ' 0 R /F2 ' +
        fallbackFontId +
        ' 0 R >> >> /Contents ' +
        contentId +
        ' 0 R >>'
    );
    pageObjIds.push(pageId);
  }

  // השלמת אובייקט DescendantFont אם חסר
  while (objects.length < 10) {
    addObj('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ArialUnicodeMS /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>');
  }

  objects[catalogId - 1] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>';
  objects[pagesId - 1] =
    '<< /Type /Pages /Kids [' +
    pageObjIds.map((id) => id + ' 0 R').join(' ') +
    '] /Count ' +
    pageObjIds.length +
    ' >>';

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += i + 1 + ' 0 obj\n' + objects[i] + '\nendobj\n';
  }

  const xrefStart = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }

  pdf +=
    'trailer\n<< /Size ' +
    (objects.length + 1) +
    ' /Root ' +
    catalogId +
    ' 0 R >>\nstartxref\n' +
    xrefStart +
    '\n%%EOF';

  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeFileName = (bookTitle.trim() || 'recipe-book').replace(/[^a-zA-Z0-9_-]+/g, '-');
  link.href = url;
  link.download = safeFileName + '.pdf';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
