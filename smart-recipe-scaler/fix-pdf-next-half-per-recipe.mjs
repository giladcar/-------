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

const nextHalfCode = `const colGap = 44;
    const colWidth = (contentWidth - colGap) / 2;
    const rightColX = rightEdge - 8;
    const leftColX = rightEdge - colWidth - colGap - 8;

    const startY = 88;
    const bottomLimit = heightPx - 84;

    // קו הפרדה אנכי בין החצי הימני לחצי השמאלי
    const dividerX = rightEdge - colWidth - colGap / 2;
    ctx.save();
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(dividerX, startY);
    ctx.lineTo(dividerX, bottomLimit);
    ctx.stroke();
    ctx.restore();

    interface HalfColumnState {
      x: number;
      y: number;
    }

    const halves: HalfColumnState[] = [
      { x: rightColX, y: startY },
      { x: leftColX, y: startY },
    ];
    let activeHalfIndex = 0;

    for (const blk of sheet.blocks) {
      if (blk.kind !== 'recipe-part' || !blk.recipe) continue;
      if (activeHalfIndex >= halves.length) break;

      const rec = blk.recipe;
      const factor = rec.originalServings > 0 ? rec.targetServings / rec.originalServings : 1;

      const titleFont = 'bold 23px Arial, sans-serif';
      const secFont = 'bold 20px Arial, sans-serif';
      const bodyFont = '19px Arial, sans-serif';

      const recipeItems: DrawLineItem[] = [];

      const titleText =
        (rec.favorite ? '★ ' : '') +
        rec.title +
        (blk.isContinuation ? ' (המשך)' : '') +
        ' — ' +
        rec.targetServings +
        ' מנות';

      for (const tLine of wrapHebrewLine(ctx, titleText, colWidth - 16, titleFont)) {
        recipeItems.push({
          text: tLine,
          font: titleFont,
          color: '#111827',
          lineHeight: 30,
        });
      }

      const ings = blk.ingredients || [];
      if (ings.length > 0) {
        recipeItems.push({
          text: 'מצרכים:',
          font: secFont,
          color: '#b45309',
          lineHeight: 27,
        });
        for (const ing of ings) {
          const scaled = parseAndScaleLine(
            ing,
            factor,
            rec.dietMode,
            rec.convertToGrams,
            measureSystem
          ).displayText;
          for (const iLine of wrapHebrewLine(ctx, '• ' + scaled, colWidth - 28, bodyFont)) {
            recipeItems.push({
              text: iLine,
              font: bodyFont,
              color: '#1f2937',
              lineHeight: 25,
              indentPx: 12,
            });
          }
        }
      }

      const steps = blk.steps || [];
      if (steps.length > 0) {
        recipeItems.push({
          text: 'שלבי הכנה:',
          font: secFont,
          color: '#b45309',
          lineHeight: 27,
        });
        steps.forEach((st, idx) => {
          for (const sLine of wrapHebrewLine(ctx, idx + 1 + '. ' + st, colWidth - 28, bodyFont)) {
            recipeItems.push({
              text: sLine,
              font: bodyFont,
              color: '#1f2937',
              lineHeight: 25,
              indentPx: 12,
            });
          }
        });
      }

      // מציירים את המתכון בחצי הנוכחי
      const half = halves[activeHalfIndex];
      for (const item of recipeItems) {
        if (half.y + item.lineHeight > bottomLimit) break;
        if (item.text) {
          drawAlignedLine(
            ctx,
            item.text,
            half.x - (item.indentPx || 0),
            half.y,
            item.font,
            item.color,
            'right'
          );
        }
        half.y += item.lineHeight;
      }

      // הכלל: מתכון אחר לא ממשיך באותו חצי — עוברים לחצי הבא עבור המתכון הבא
      activeHalfIndex += 1;
    }

    `;

code = code.slice(0, startIdx) + nextHalfCode + code.slice(endIdx);
fs.writeFileSync(pdfPath, code, 'utf8');

console.log('עודכן בהצלחה דרך fix-pdf-next-half-per-recipe.mjs: כל מתכון בחצי נפרד ללא ערבוב באותו חצי.');