// scripts/make-legacy-css.js
import fs from 'fs';
import path from 'path';
import postcss from 'postcss';
import postcssOKLabFunction from '@csstools/postcss-oklab-function';

const assetsDir = path.resolve('dist/assets');
const files = fs.readdirSync(assetsDir).filter(f => f.endsWith('.css') && !f.includes('.legacy.'));

if (files.length === 0) {
  console.warn('⚠️  Не найдено CSS-файлов в dist/assets');
  process.exit(0);
}

for (const file of files) {
  const filePath = path.join(assetsDir, file);
  const css = fs.readFileSync(filePath, 'utf8');

  const result = await postcss([
    postcssOKLabFunction({ preserve: false, subFeatures: { displayP3: false } })
  ]).process(css, { from: filePath });

  const legacyName = file.replace('.css', '.legacy.css');
  fs.writeFileSync(path.join(assetsDir, legacyName), result.css);
  console.log(`✅ ${file} → ${legacyName}`);
}