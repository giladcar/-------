import fs from 'node:fs';
import path from 'node:path';

const pdfPath = path.join(process.cwd(), 'lib', 'pdfBookExporter.ts');

if (!fs.existsSync(pdfPath)) {
  console.error('לא נמצא הקובץ lib/pdfBookExporter.ts');
  process.exit(1);
}

let code = fs.readFileSync(pdfPath, 'utf8');

// 1. הגדרה מדויקת של גופן לפני מדידה ב-wrapHebrewLine ועטיפה עם מרווח בטחון רחב
code = code.replace(
  /function wrapHebrewLine\(ctx: CanvasRenderingContext2D, text: string, maxWidth: number\): string\[\] \{[\s\S]*?\n\}/,
  `function wrapHebrewLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font?: string
): string[] {
  ctx.save();
  if (font) ctx.font = font;
  const safeMaxWidth = Math.max(120, maxWidth - 28);
  const words = text.split(/\\s+/).filter(Boolean);
  if (words.length === 0) {
    ctx.restore();
    return [''];
  }
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (ctx.measureText(candidate).width > safeMaxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  ctx.restore();
  return lines;
}`
);

// 2. החלפת בלוק הציור של 2 הטורים כך שאין חיתוך אופקי ואין חציית טור ריקה באמצע הדף
const startMarker = 'const colGap =';
const endMarker = 'pageCanvases.push(canvas);';
const startIdx = code.indexOf(startMarker);
const endIdx = startIdx !== -1 ? code.indexOf(endMarker, startIdx) : -1;

if (startIdx !== -1 && endIdx !== -1) {
  const newBlock = `const colGap = 44;
    const colWidth = (contentWidth - colGap) / 2;
    const rightColX = rightEdge - 8;
    const leftColX = rightEdge - colWidth - colGap - 8;

    const allItems: DrawLineItem[] = [];

    for (const blk of sheet.blocks) {
      if (blk.kind === 'recipe-part' && blk.recipe) {
        const rec = blk.recipe;
        const factor = rec.originalServings > 0 ? rec.targetServings / rec.originalServings : 1;

        const titleFont = 'bold 23px Arial, sans-serif';
        const secFont = 'bold 20px Arial, sans-serif';
        const bodyFont = '19px Arial, sans-serif';

        const titleText =
          (rec.favorite ? '★ ' : '') +
          rec.title +
          (blk.isContinuation ? ' (המשך)' : '') +
          ' — ' +
          rec.targetServings +
          ' מנות';

        for (const tLine of wrapHebrewLine(ctx, titleText, colWidth - 16, titleFont)) {
          allItems.push({
            text: tLine,
            font: titleFont,
            color: '#111827',
            lineHeight: 30,
          });
        }

        const ings = blk.ingredients || [];
        if (ings.length > 0) {
          allItems.push({
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
              allItems.push({
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
          allItems.push({
            text: 'שלבי הכנה:',
            font: secFont,
            color: '#b45309',
            lineHeight: 27,
          });
          steps.forEach((st, idx) => {
            for (const sLine of wrapHebrewLine(ctx, idx + 1 + '. ' + st, colWidth - 28, bodyFont)) {
              allItems.push({
                text: sLine,
                font: bodyFont,
                color: '#1f2937',
                lineHeight: 25,
                indentPx: 12,
              });
            }
          });
        }

        allItems.push({
          text: '',
          font: bodyFont,
          color: '#1f2937',
          lineHeight: 14,
        });
      }
    }

    const startY = 88;
    const bottomLimit = heightPx - 84;

    // קו הפרדה אנכי עדין בין שני הטורים
    const dividerX = rightEdge - colWidth - colGap / 2;
    ctx.save();
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(dividerX, startY);
    ctx.lineTo(dividerX, bottomLimit);
    ctx.stroke();
    ctx.restore();

    // מילוי הטור הימני עד התחתית ואז המשך לטור השמאלי עד התחתית
    let currentX = rightColX;
    let y = startY;
    let movedToLeftCol = false;

    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
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

    `;

  code = code.slice(0, startIdx) + newBlock + code.slice(endIdx);
}

fs.writeFileSync(pdfPath, code, 'utf8');
console.log('עודכן בהצלחה דרך fix-pdf-no-clip.mjs: בוטל חיתוך שורות בצדדים ושופר ניצול גובה העמוד.');