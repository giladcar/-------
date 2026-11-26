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

const secondHalfCode = `const colGap = 44;
    const colWidth = (contentWidth - colGap) / 2;
    const rightColX = rightEdge - 8;
    const leftColX = rightEdge - colWidth - colGap - 8;

    const startY = 88;
    const bottomLimit = heightPx - 84;

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

      const baseTitle =
        (rec.favorite ? '★ ' : '') +
        rec.title +
        (blk.isContinuation ? ' (המשך)' : '') +
        ' — ' +
        rec.targetServings +
        ' מנות';

      const contTitle =
        (rec.favorite ? '★ ' : '') +
        rec.title +
        ' (המשך) — ' +
        rec.targetServings +
        ' מנות';

      const bodyItems: DrawLineItem[] = [];

      const ings = blk.ingredients || [];
      if (ings.length > 0) {
        bodyItems.push({
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
            bodyItems.push({
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
        bodyItems.push({
          text: 'שלבי הכנה:',
          font: secFont,
          color: '#b45309',
          lineHeight: 27,
        });
        steps.forEach((st, idx) => {
          for (const sLine of wrapHebrewLine(ctx, idx + 1 + '. ' + st, colWidth - 28, bodyFont)) {
            bodyItems.push({
              text: sLine,
              font: bodyFont,
              color: '#1f2937',
              lineHeight: 25,
              indentPx: 12,
            });
          }
        });
      }

      const drawTitleIntoHalf = (half: HalfColumnState, heading: string) => {
        for (const tLine of wrapHebrewLine(ctx, heading, colWidth - 16, titleFont)) {
          if (half.y + 30 > bottomLimit) return false;
          drawAlignedLine(ctx, tLine, half.x, half.y, titleFont, '#111827', 'right');
          half.y += 30;
        }
        return true;
      };

      let itemIdx = 0;
      let startedInCurrentHalf = false;

      while (activeHalfIndex < halves.length && itemIdx < bodyItems.length) {
        const half = halves[activeHalfIndex];

        if (!startedInCurrentHalf) {
          const heading = activeHalfIndex === 0 ? baseTitle : contTitle;
          const ok = drawTitleIntoHalf(half, heading);
          startedInCurrentHalf = true;
          if (!ok) {
            activeHalfIndex += 1;
            startedInCurrentHalf = false;
            continue;
          }
        }

        const item = bodyItems[itemIdx];
        if (half.y + item.lineHeight > bottomLimit) {
          activeHalfIndex += 1;
          startedInCurrentHalf = false;
          continue;
        }

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
        itemIdx += 1;
      }

      // מתכון אחר לא מתחיל באותו חצי — מתקדמים לחצי הבא עבור המתכון הבא
      activeHalfIndex += 1;
    }

    `;

code = code.slice(0, startIdx) + secondHalfCode + code.slice(endIdx);
fs.writeFileSync(pdfPath, code, 'utf8');

console.log('עודכן בהצלחה דרך fix-pdf-continue-second-half.mjs: מתכון ארוך ממשיך לחצי השני באותו עמוד.');