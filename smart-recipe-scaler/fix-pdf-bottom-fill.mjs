import fs from 'node:fs';
import path from 'node:path';

const pdfPath = path.join(process.cwd(), 'lib', 'pdfBookExporter.ts');

if (fs.existsSync(pdfPath)) {
  let code = fs.readFileSync(pdfPath, 'utf8');

  const fillLogicRegex =
    /\/\/ קו הפרדה אנכי עדין[\s\S]*?y \+= item\.lineHeight;\s*\}/;

  const newFillLogic = `// קו הפרדה אנכי עדין בין הטור הימני לטור השמאלי
    const dividerX = rightEdge - colWidth - colGap / 2;
    ctx.save();
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(dividerX, startY);
    ctx.lineTo(dividerX, bottomLimit);
    ctx.stroke();
    ctx.restore();

    // מילוי הטור הימני עד התחתית וגלישה מסודרת לראש הטור השמאלי עד התחתית
    let currentX = rightColX;
    let y = startY;
    let movedToLeftCol = false;

    for (let idx = 0; idx < allItems.length; idx++) {
      const item = allItems[idx];
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
    }`;

  if (fillLogicRegex.test(code)) {
    code = code.replace(fillLogicRegex, newFillLogic);
  }

  // מרווח בטחון לעטיפת שורות כדי למנוע חיתוך בשוליים
  code = code.replace(/colWidth - 14/g, 'colWidth - 24');
  code = code.replace(/colWidth - 12/g, 'colWidth - 24');

  fs.writeFileSync(pdfPath, code, 'utf8');
}

console.log('עודכן בהצלחה דרך fix-pdf-bottom-fill.mjs: מילוי מלא עד תחתית הדף והמשך מסודר לטור השני.');