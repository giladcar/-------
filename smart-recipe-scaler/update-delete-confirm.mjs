import fs from 'node:fs';
import path from 'node:path';

const vaultPath = path.join(process.cwd(), 'components', 'RecipeBookVault.tsx');
const pagePath = path.join(process.cwd(), 'app', 'page.tsx');

if (fs.existsSync(vaultPath)) {
  let vaultContent = fs.readFileSync(vaultPath, 'utf8');
  vaultContent = vaultContent.replace(
    /onClick=\{\(\) => onDeleteRecipe\(rec\.id\)\}/g,
    `onClick={() => {
                            if (
                              typeof window === 'undefined' ||
                              window.confirm('האם אתה בטוח שאתה רוצה למחוק את "' + rec.title + '"?')
                            ) {
                              onDeleteRecipe(rec.id);
                            }
                          }}`
  );
  fs.writeFileSync(vaultPath, vaultContent, 'utf8');
}

if (fs.existsSync(pagePath)) {
  let pageContent = fs.readFileSync(pagePath, 'utf8');

  pageContent = pageContent.replace(
    /onClick=\{\(\) => setTimers\(\{\}\)\}/g,
    `onClick={() => {
                  if (
                    typeof window === 'undefined' ||
                    window.confirm('האם אתה בטוח שאתה רוצה למחוק את כל הטיימרים הפעילים?')
                  ) {
                    setTimers({});
                  }
                }}`
  );

  pageContent = pageContent.replace(
    /onClick=\{\(\) => removeTimer\(t\.id\)\}/g,
    `onClick={() => {
                      if (
                        typeof window === 'undefined' ||
                        window.confirm('האם אתה בטוח שאתה רוצה למחוק את "' + t.sourceLabel + '"?')
                      ) {
                        removeTimer(t.id);
                      }
                    }}`
  );

  fs.writeFileSync(pagePath, pageContent, 'utf8');
}

console.log('עודכן בהצלחה דרך update-delete-confirm.mjs: נוספה שאלת אישור מחיקה עם שם הפריט.');