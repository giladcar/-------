import fs from 'node:fs';
import path from 'node:path';

const pdfExportHelperCode = `import { BookPagedCategory } from '@/lib/recipeBook';
import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';

function escapePdfText(text: string): string {
  return text
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/\\(/g, '\\\\(')
    .replace(/\\)/g, '\\\\)')
    .replace(/[^\\x20-\\x7E]/g, '?');
}

function wrapLines(text: string, maxChars = 78): string[] {
  const words = text.split(/\\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const w of words) {
    const candidate = current ? current + ' ' + w : w;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export function downloadStructuredRecipeBookPdf(params: {
  bookTitle: string;
  dateLabel: string;
  scopeLabel: string;
  measureSystem: MeasureSystem;
  pagedBook: BookPagedCategory[];
}): void {
  const { bookTitle, dateLabel, scopeLabel, measureSystem, pagedBook } = params;

  const pages: string[][] = [];
  const page1Lines: string[] = [
    'PAGE 1 - COVER & TABLE OF CONTENTS',
    'Title: ' + bookTitle,
    'Scope: ' + scopeLabel + ' | Date: ' + dateLabel + ' | Units: ' + measureSystem.toUpperCase(),
    '------------------------------------------------------------------------',
  ];

  for (const cat of pagedBook) {
    page1Lines.push('Category: ' + cat.category + ' [Page ' + cat.pageNumber + ']');
    for (const sub of cat.subGroups) {
      page1Lines.push('  Subcategory: ' + sub.subCategory + ' [Page ' + sub.pageNumber + ']');
      for (const pRec of sub.recipes) {
        page1Lines.push(
          '    - ' + pRec.recipe.title + ' (' + pRec.recipe.targetServings + ' servings) [Page ' + pRec.pageNumber + ']'
        );
      }
    }
  }
  pages.push(page1Lines);

  for (const cat of pagedBook) {
    for (const sub of cat.subGroups) {
      for (const pRec of sub.recipes) {
        const rec = pRec.recipe;
        const factor = rec.originalServings > 0 ? rec.targetServings / rec.originalServings : 1;
        const pLines: string[] = [
          'PAGE ' + pRec.pageNumber + ' | ' + cat.category + ' / ' + sub.subCategory,
          (rec.favorite ? '[FAVORITE] ' : '') + rec.title + ' (' + rec.targetServings + ' servings)',
          '------------------------------------------------------------------------',
          'Ingredients:',
        ];

        const rawIngs = rec.rawIngredients.split('\\n').filter((l) => l.trim());
        for (const ingLine of rawIngs) {
          const scaled = parseAndScaleLine(ingLine, factor, rec.dietMode, rec.convertToGrams, measureSystem).displayText;
          for (const wrapped of wrapLines('  * ' + scaled)) {
            pLines.push(wrapped);
          }
        }

        const rawSteps = rec.rawSteps.split('\\n').map((s) => s.trim()).filter(Boolean);
        if (rawSteps.length > 0) {
          pLines.push('');
          pLines.push('Preparation Steps:');
          rawSteps.forEach((st, idx) => {
            for (const wrapped of wrapLines('  ' + (idx + 1) + '. ' + st)) {
              pLines.push(wrapped);
            }
          });
        }

        pages.push(pLines);
      }
    }
  }

  // בניית קובץ PDF תקני עם עמוד נפרד לכל עמוד בספר
  const objects: string[] = [];
  const addObj = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObj('');
  const pagesId = addObj('');
  const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageObjIds: number[] = [];

  for (let i = 0; i < pages.length; i++) {
    const contentLines = pages[i];
    const streamParts: string[] = ['BT', '/F1 11 Tf', '50 750 Td', '15 TL'];

    contentLines.slice(0, 44).forEach((line, idx) => {
      const safe = escapePdfText(line);
      if (idx === 0) {
        streamParts.push('(' + safe + ') Tj');
      } else {
        streamParts.push('T* (' + safe + ') Tj');
      }
    });

    streamParts.push('ET');
    const streamData = streamParts.join('\\n');
    const contentId = addObj(
      '<< /Length ' + streamData.length + ' >>\\nstream\\n' + streamData + '\\nendstream'
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

  let pdf = '%PDF-1.4\\n';
  const offsets: number[] = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += i + 1 + ' 0 obj\\n' + objects[i] + '\\nendobj\\n';
  }

  const xrefStart = pdf.length;
  pdf += 'xref\\n0 ' + (objects.length + 1) + '\\n';
  pdf += '0000000000 65535 f \\n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \\n';
  }

  pdf +=
    'trailer\\n<< /Size ' +
    (objects.length + 1) +
    ' /Root ' +
    catalogId +
    ' 0 R >>\\nstartxref\\n' +
    xrefStart +
    '\\n%%EOF';

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
`;

const vaultPath = path.join(process.cwd(), 'components', 'RecipeBookVault.tsx');

fs.mkdirSync(path.join(process.cwd(), 'lib'), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), 'lib', 'pdfBookExporter.ts'), pdfExportHelperCode, 'utf8');

if (fs.existsSync(vaultPath)) {
  let content = fs.readFileSync(vaultPath, 'utf8');

  if (!content.includes('downloadStructuredRecipeBookPdf')) {
    content = content.replace(
      "import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';",
      "import { parseAndScaleLine, MeasureSystem } from '@/lib/recipeEngine';\nimport { downloadStructuredRecipeBookPdf } from '@/lib/pdfBookExporter';"
    );
  }

  // הוספת מעבר עמוד אמיתי (pageBreakAfter: 'always') אחרי עמוד 1 ואחרי כל עמוד מתכון
  content = content.replace(
    /className=\{\s*'p-6 rounded-2xl border space-y-4 '\s*\+\s*\(darkMode\s*\?\s*'bg-gradient-to-b from-amber-500\/15 to-slate-900 border-amber-500\/30'\s*:\s*'bg-gradient-to-b from-amber-50 to-white border-amber-200'\s*\)\s*\}/,
    `style={{ pageBreakAfter: 'always', breakAfter: 'page' }}
            className={
              'p-6 rounded-2xl border space-y-4 ' +
              (darkMode
                ? 'bg-gradient-to-b from-amber-500/15 to-slate-900 border-amber-500/30'
                : 'bg-gradient-to-b from-amber-50 to-white border-amber-200')
            }`
  );

  content = content.replace(
    /onClick=\{\(\) => window\.print\(\)\}/,
    `onClick={() =>
                  downloadStructuredRecipeBookPdf({
                    bookTitle: bookTitle.trim() || 'ספר המתכונים שלי',
                    dateLabel: generatedDateLabel,
                    scopeLabel:
                      exportScope === 'all'
                        ? 'הכל'
                        : exportScope === 'favorites'
                        ? 'רק מועדפים'
                        : 'רק נבחרים',
                    measureSystem,
                    pagedBook,
                  })
                }`
  );

  content = content.replace(/הדפס \/ שמור PDF/g, 'הורד קובץ PDF מסודר');

  fs.writeFileSync(vaultPath, content, 'utf8');
}

console.log('עודכן בהצלחה דרך update-real-pdf.mjs: נוצר lib/pdfBookExporter.ts לייצוא PDF אמיתי עם עמוד לכל מתכון.');