import { BookPageSheet, TocEntry, FIXED_PAGE_CAPACITY_LINES } from '@/lib/recipeBook';
import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';

// מיפוי תווי עברית לקידוד Windows-1255 (עובד ב-PDF עם WinAnsiEncoding)
const HEBREW_TO_CP1255: Record<number, number> = {
  0x05d0: 0xe0, // א
  0x05d1: 0xe1, // ב
  0x05d2: 0xe2, // ג
  0x05d3: 0xe3, // ד
  0x05d4: 0xe4, // ה
  0x05d5: 0xe5, // ו
  0x05d6: 0xe6, // ז
  0x05d7: 0xe7, // ח
  0x05d8: 0xe8, // ט
  0x05d9: 0xe9, // י
  0x05da: 0xea, // ך
  0x05db: 0xeb, // כ
  0x05dc: 0xec, // ל
  0x05dd: 0xed, // ם
  0x05de: 0xee, // מ
  0x05df: 0xef, // ן
  0x05e0: 0xf0, // נ
  0x05e1: 0xf1, // ס
  0x05e2: 0xf2, // ע
  0x05e3: 0xf3, // ף
  0x05e4: 0xf4, // פ
  0x05e5: 0xf5, // ץ
  0x05e6: 0xf6, // צ
  0x05e7: 0xf7, // ק
  0x05e8: 0xf8, // ר
  0x05e9: 0xf9, // ש
  0x05ea: 0xfa, // ת
};

function reverseHebrewForVisualPdf(text: string): string {
  // מחרוזות שמכילות עברית נהפכות לסדר ויזואלי עבור מנועי PDF בסיסיים
  if (!/[\u0590-\u05FF]/.test(text)) return text;
  const words = text.split(' ');
  return words
    .reverse()
    .map((word) => {
      if (/[\u0590-\u05FF]/.test(word)) {
        return Array.from(word).reverse().join('');
      }
      return word;
    })
    .join(' ');
}

function encodePdfWinAnsiString(rawText: string): string {
  const visual = reverseHebrewForVisualPdf(rawText);
  let out = '(';
  for (let i = 0; i < visual.length; i++) {
    const code = visual.charCodeAt(i);
    if (code === 40 || code === 41 || code === 92) {
      out += '\\' + String.fromCharCode(code);
    } else if (code >= 0x20 && code <= 0x7e) {
      out += String.fromCharCode(code);
    } else if (HEBREW_TO_CP1255[code] !== undefined) {
      out += '\\' + HEBREW_TO_CP1255[code].toString(8).padStart(3, '0');
    } else if (code === 0x2013 || code === 0x2014) {
      out += '-';
    } else if (code === 0x2022 || code === 0x25aa || code === 0x2605 || code === 0x2606) {
      out += '*';
    } else if (code === 0x2190) {
      out += '<-';
    } else {
      out += ' ';
    }
  }
  out += ')';
  return out;
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
    '------------------------------------------------------------------------',
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
      '------------------------------------------------------------------------',
    ];

    for (const blk of sheet.blocks) {
      if (blk.kind === 'category-banner') {
        lines.push('*** קטגוריה: ' + blk.title + ' (עמוד ' + blk.pageNumber + ') ***');
      } else if (blk.kind === 'subcategory-banner') {
        lines.push('  ** תת-קטגוריה: ' + blk.category + ' <- ' + blk.title + ' (עמוד ' + blk.pageNumber + ') **');
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
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );

  const pageObjIds: number[] = [];

  for (let i = 0; i < pdfPages.length; i++) {
    const contentLines = pdfPages[i];
    const streamParts: string[] = ['BT', '/F1 11 Tf', '545 760 Td', '15 TL'];

    contentLines.slice(0, FIXED_PAGE_CAPACITY_LINES + 8).forEach((line, idx) => {
      const encoded = encodePdfWinAnsiString(line);
      if (idx === 0) {
        streamParts.push(encoded + ' Tj');
      } else {
        streamParts.push('T* ' + encoded + ' Tj');
      }
    });

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
        ' 0 R >> >> /Contents ' +
        contentId +
        ' 0 R >>'
    );
    pageObjIds.push(pageId);
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
