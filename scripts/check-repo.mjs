import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const failures = [];

const exists = (relative) => fs.existsSync(path.join(root, relative));
const fail = (message) => failures.push(message);

for (const required of [
  'AGENTS.md',
  'docs/architecture/overview.md',
  'docs/guides/adding-components.md',
  'docs/guides/agent-workbench.md',
  'src/components/partTypes.ts',
  'src/components/parts.ts',
  'src/components/registerElements.ts',
  'src/agent/webmcp.ts',
  'src/agent/layout.ts',
]) {
  if (!exists(required)) fail(`Missing required project file: ${required}`);
}

for (const forbidden of [
  'src/wires/router.ts',
  'src/parts.ts',
  'src/store.ts',
  'src/types.ts',
  'src/App.tsx',
  'src/styles.css',
  'tinkercad.md',
  'THIRD_PARTY_NOTICES.md',
]) {
  if (exists(forbidden)) fail(`Stale/forbidden path still exists: ${forbidden}`);
}

const rootEntries = fs.readdirSync(root, { withFileTypes: true });
for (const entry of rootEntries) {
  if (/^\.tmp-/i.test(entry.name) || /^ui-.*\.png$/i.test(entry.name)) {
    fail(`Temporary artifact in repository root: ${entry.name}`);
  }
  if (entry.isDirectory() && entry.name === '.tmp-chrome') {
    fail('Temporary Chrome profile exists in repository root: .tmp-chrome/');
  }
}

const srcRootFiles = fs.readdirSync(path.join(root, 'src'), { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
if (srcRootFiles.join(',') !== 'main.tsx') {
  fail(`src/ root should contain only main.tsx; found: ${srcRootFiles.join(', ') || '(none)'}`);
}

const partTypesSource = fs.readFileSync(path.join(root, 'src/components/partTypes.ts'), 'utf8');
const catalogSource = fs.readFileSync(path.join(root, 'src/components/parts.ts'), 'utf8');
const registrationsSource = fs.readFileSync(path.join(root, 'src/components/registerElements.ts'), 'utf8');
const partList = partTypesSource.match(/PART_TYPES\s*=\s*\[([\s\S]*?)\]\s*as const/);
if (!partList) {
  fail('Could not parse PART_TYPES from src/components/partTypes.ts');
} else {
  const types = [...partList[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const duplicates = types.filter((type, index) => types.indexOf(type) !== index);
  if (duplicates.length) fail(`Duplicate component types: ${[...new Set(duplicates)].join(', ')}`);
  for (const type of types) {
    const keyPattern = new RegExp(`(?:^|\\n)\\s*(?:'${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'|${type.replace(/-/g, '\\-')})\\s*:\\s*\\{`);
    if (!keyPattern.test(catalogSource)) fail(`PART_TYPES entry has no catalog definition: ${type}`);
  }
}

for (const match of catalogSource.matchAll(/\btag:\s*'([^']+)'/g)) {
  const tag = match[1];
  if (!tag.startsWith('wokwi-')) continue;
  const moduleName = `${tag.slice('wokwi-'.length)}-element.js`;
  if (!registrationsSource.includes(`/${moduleName}'`)) {
    fail(`Wokwi catalog tag is not registered in registerElements.ts: ${tag}`);
  }
}

for (const match of catalogSource.matchAll(/\basset:\s*'\/([^']+)'/g)) {
  const assetPath = path.join('public', match[1]);
  if (!exists(assetPath)) fail(`Catalog asset does not exist: /${match[1]}`);
}

const mainSource = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
if (!mainSource.includes("./components/registerElements")) {
  fail('src/main.tsx must load src/components/registerElements.ts');
}

if (failures.length) {
  console.error('Repository checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Repository structure checks passed.');
