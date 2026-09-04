import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const failures = [];
const exists = (relative) => fs.existsSync(path.join(root, relative));
const fail = (message) => failures.push(message);

const required = [
  'AGENTS.md',
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'src/components/partTypes.ts',
  'src/components/parts.ts',
  'src/components/registerElements.ts',
  'src/agent/webmcp.ts',
  'src/agent/types.ts',
  'src/agent/buildCircuit.ts',
  'src/agent/geometry.ts',
  'src/agent/input.ts',
  'src/agent/router.ts',
  'src/agent/transaction.ts',
  'src/layout/quality.ts',
  'scripts/testing/test-circuits.mjs',
  'scripts/testing/loader.mjs',
  'scripts/harness/run.mjs',
  'scripts/harness/examples/smoke.json',
  'scripts/maintenance/check-repo.mjs',
];
for (const file of required) if (!exists(file)) fail(`Missing required project file: ${file}`);

const forbidden = [
  'docs',
  '.agents',
  'harness.md',
  'scripts/agent-bench',
  'docs/GUIDE.md',
  'src/agent/layout.ts',
  'src/wires/router.ts',
  'src/parts.ts',
  'src/store.ts',
  'src/types.ts',
  'src/App.tsx',
  'src/styles.css',
  'scripts/check-repo.mjs',
  'scripts/test-circuits.mjs',
  'scripts/loader.mjs',
  'scripts/fixtures.mjs',
  'scripts/generate-fixtures.mjs',
  'scripts/register-loader.mjs',
  'scripts/webmcp-harness.mjs',
  'tinkercad.md',
];
for (const file of forbidden) if (exists(file)) fail(`Stale/forbidden path still exists: ${file}`);

const rootEntries = fs.readdirSync(root, { withFileTypes: true });
for (const entry of rootEntries) {
  if (/^\.tmp-/i.test(entry.name) || /^ui-.*\.png$/i.test(entry.name)) fail(`Temporary artifact in repository root: ${entry.name}`);
  if (entry.isDirectory() && entry.name === '.tmp-chrome') fail('Temporary Chrome profile exists in repository root: .tmp-chrome/');
}

const harnessExampleDir = path.join(root, 'scripts/harness/examples');
const harnessExamples = fs.readdirSync(harnessExampleDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
if (harnessExamples.join(',') !== 'ir-motor-hard.json,shared-bus-hard.json,smoke.json') fail(`Unexpected harness examples: ${harnessExamples.join(', ') || '(none)'}`);
const scriptRootFiles = fs.readdirSync(path.join(root, 'scripts'), { withFileTypes: true }).filter((entry) => entry.isFile());
if (scriptRootFiles.length) fail(`scripts/ root should contain only organized subdirectories; found: ${scriptRootFiles.map((entry) => entry.name).join(', ')}`);

const srcRootFiles = fs.readdirSync(path.join(root, 'src'), { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
if (srcRootFiles.join(',') !== 'main.tsx') fail(`src/ root should contain only main.tsx; found: ${srcRootFiles.join(', ') || '(none)'}`);

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
    const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyPattern = new RegExp(`(?:^|\\n)\\s*(?:'${escaped}'|${type.replace(/-/g, '\\-')})\\s*:\\s*\\{`);
    if (!keyPattern.test(catalogSource)) fail(`PART_TYPES entry has no catalog definition: ${type}`);
  }
}

for (const match of catalogSource.matchAll(/\btag:\s*'([^']+)'/g)) {
  const tag = match[1];
  if (!tag.startsWith('wokwi-')) continue;
  const moduleName = `${tag.slice('wokwi-'.length)}-element.js`;
  if (!registrationsSource.includes(`/${moduleName}'`)) fail(`Wokwi catalog tag is not registered in registerElements.ts: ${tag}`);
}

for (const match of catalogSource.matchAll(/\basset:\s*'\/([^']+)'/g)) {
  if (!exists(path.join('public', match[1]))) fail(`Catalog asset does not exist: /${match[1]}`);
}

const mainSource = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
if (!mainSource.includes("./components/registerElements")) fail('src/main.tsx must load src/components/registerElements.ts');

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
const expectedScripts = {
  check: 'node scripts/maintenance/check-repo.mjs && tsc --noEmit && vite build',
  test: 'node scripts/testing/test-circuits.mjs',
  harness: 'node scripts/harness/run.mjs',
};
for (const [name, command] of Object.entries(expectedScripts)) {
  if (packageJson.scripts?.[name] !== command) fail(`package.json script ${name} should be: ${command}`);
}

if (failures.length) {
  console.error('Repository checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Repository structure checks passed.');
