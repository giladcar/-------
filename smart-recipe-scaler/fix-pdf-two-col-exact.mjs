import fs from 'node:fs';
import path from 'node:path';

const pdfPath = path.join(process.cwd(), 'lib', 'pdfBookExporter.ts');

if (!fs.existsSync(pdfPath)) {
  console.error('לא נמצא הקובץ lib/pdfBookExporter.ts');
  process.exit(1);
}

let code = fs.readFileSync(pdfPath, 'utf8');

const startMarker = 'const colGap =';
const endMarker = 'pageCanvases.push(canvas);';

const startIdx = code.indexOf(startMarker);
const endIdx = startIdx !== -1 ? code.indexOf(endMarker, startIdx) : -1;

if (startIdx === -1 || endIdx === -1) {
  console.error('לא נמצאו נקודות ההחלפה ב-lib/pdfBookExporter.ts');
  process.exit(1);
}

const replacementCode = `const colGap = 36;
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

    `;

code = code.slice(0, startIdx) + replacementCode + code.slice(endIdx);
fs.writeFileSync(pdfPath, code, 'utf8');

console.log('עודכן בהצלחה דרך fix-pdf-two-col-exact.mjs: פריסה ישירה וברורה ב-2 טורים (ימין ואז שמאל).');