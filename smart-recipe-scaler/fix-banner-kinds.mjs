import fs from 'node:fs';
import path from 'node:path';

const filesToFix = [
  path.join(process.cwd(), 'components', 'RecipeBookVault.tsx'),
  path.join(process.cwd(), 'lib', 'pdfBookExporter.ts'),
];

for (const filePath of filesToFix) {
  if (!fs.existsSync(filePath)) continue;
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/blk\.kind === 'category'/g, "blk.kind === 'category-banner'");
  content = content.replace(/blk\.kind === 'subcategory'/g, "blk.kind === 'subcategory-banner'");
  fs.writeFileSync(filePath, content, 'utf8');
}

console.log('תוקן בהצלחה: עודכנו ההשוואות ל-category-banner ו-subcategory-banner ב-RecipeBookVault.tsx וב-pdfBookExporter.ts.');