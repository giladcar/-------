import fs from 'node:fs';
import path from 'node:path';

const pdfPath = path.join(process.cwd(), 'lib', 'pdfBookExporter.ts');

if (fs.existsSync(pdfPath)) {
  let code = fs.readFileSync(pdfPath, 'utf8');

  const oldSplitBlock = `    // חלוקה מאוזנת בין הטור הימני לטור השמאלי למילוי שני צידי הדף
    let totalHeight = 0;
    for (const item of allItems) totalHeight += item.lineHeight;

    const splitThreshold =
      totalHeight > maxColHeight ? Math.ceil(totalHeight / 2) : maxColHeight;

    let currentX = rightColX;
    let y = startY;
    let colUsed = 0;
    let movedToLeftCol = false;

    for (const item of allItems) {
      if (!movedToLeftCol && (colUsed + item.lineHeight > splitThreshold || y + item.lineHeight > bottomLimit)) {
        currentX = leftColX;
        y = startY;
        colUsed = 0;
        movedToLeftCol = true;
      }

      if (y + item.lineHeight > bottomLimit) {
        break;
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
      colUsed += item.lineHeight;
    }`;

  const newSplitBlock = `    // קו הפרדה אנכי עדין בין הטור הימני לטור השמאלי
    const dividerX = rightEdge - colWidth - colGap / 2;
    ctx.save();
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(dividerX, startY);
    ctx.lineTo(dividerX, bottomLimit);
    ctx.stroke();
    ctx.restore();

    // חלוקה לשני טורים כך שגם רשימות בינוניות/ארוכות ימלאו את שני צידי הדף
    const splitIndex = allItems.length > 20 ? Math.ceil(allItems.length / 2) : allItems.length;

    let currentX = rightColX;
    let y = startY;
    let movedToLeftCol = false;

    for (let idx = 0; idx < allItems.length; idx++) {
      const item = allItems[idx];
      if (!movedToLeftCol && (idx >= splitIndex || y + item.lineHeight > bottomLimit)) {
        currentX = leftColX;
        y = startY;
        movedToLeftCol = true;
      }

      if (y + item.lineHeight > bottomLimit) {
        break;
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

  if (code.includes(oldSplitBlock)) {
    code = code.replace(oldSplitBlock, newSplitBlock);
  } else {
    code = code.replace(
      /\/\/ חלוקה מאוזנת בין הטור הימני לטור השמאלי[\s\S]*?colUsed \+= item\.lineHeight;\s*\}/,
      newSplitBlock
    );
  }

  fs.writeFileSync(pdfPath, code, 'utf8');
}

console.log('עודכן בהצלחה דרך fix-pdf-fill-both-cols.mjs: מילוי מאוזן של שני הטורים וקו הפרדה עדין.');