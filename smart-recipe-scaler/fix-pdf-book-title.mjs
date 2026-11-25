import fs from 'node:fs';
import path from 'node:path';

const pdfPath = path.join(process.cwd(), 'lib', 'pdfBookExporter.ts');

if (fs.existsSync(pdfPath)) {
  let content = fs.readFileSync(pdfPath, 'utf8');
  content = content.replace(
    /\(bookTitle\.trim\(\)\s*\|\|\s*'recipe-book'\)/g,
    "(params.bookTitle.trim() || 'recipe-book')"
  );
  fs.writeFileSync(pdfPath, content, 'utf8');
}

console.log('תוקן בהצלחה: הוחלף bookTitle ב-params.bookTitle ב-lib/pdfBookExporter.ts.');