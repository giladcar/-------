import { BookPageSheet, TocEntry, FIXED_PAGE_CAPACITY_LINES } from '@/lib/recipeBook';
import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';

function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
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
    'PAGE 1 - FIXED CAPACITY (' + FIXED_PAGE_CAPACITY_LINES + ' lines/page)',
    'Book: ' + bookTitle,
    'Scope: ' + scopeLabel + ' | Date: ' + dateLabel + ' | Units: ' + measureSystem.toUpperCase(),
    '------------------------------------------------------------------------',
  ];

  for (const cat of toc) {
    tocLines.push('Category: ' + cat.category + ' [Page ' + cat.categoryPage + ']');
    for (const sub of cat.subCategories) {
      tocLines.push('  Subcategory: ' + sub.subCategory + ' [Page ' + sub.subPage + ']');
      for (const r of sub.recipes) {
        tocLines.push('    - ' + r.title + ' [Page ' + r.pageNumber + ']');
      }
    }
  }
  pdfPages.push(tocLines);

  for (const sheet of sheets) {
    const lines: string[] = [
      'PAGE ' +
        sheet.pageNumber +
        ' | Fixed Size: ' +
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
        lines.push('[Category] ' + blk.title + ' (Page ' + blk.pageNumber + ')');
      } else if (blk.kind === 'subcategory-banner') {
        lines.push('  [Subcategory] ' + blk.category + ' / ' + blk.title + ' (Page ' + blk.pageNumber + ')');
      } else if (blk.kind === 'recipe-part' && blk.recipe) {
        const rec = blk.recipe;
        const factor = rec.originalServings > 0 ? rec.targetServings / rec.originalServings : 1;
        lines.push(
          '  Recipe: ' +
            rec.title +
            (blk.isContinuation ? ' (cont.)' : '') +
            ' [' +
            rec.targetServings +
            ' servings]'
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
  const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageObjIds: number[] = [];

  for (let i = 0; i < pdfPages.length; i++) {
    const contentLines = pdfPages[i];
    const streamParts: string[] = ['BT', '/F1 10.5 Tf', '48 760 Td', '14 TL'];

    contentLines.slice(0, FIXED_PAGE_CAPACITY_LINES + 6).forEach((line, idx) => {
      const safe = escapePdfText(line);
      if (idx === 0) {
        streamParts.push('(' + safe + ') Tj');
      } else {
        streamParts.push('T* (' + safe + ') Tj');
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
