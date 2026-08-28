import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if ((err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ERR_UNSUPPORTED_DIR_IMPORT') && context.parentURL && (specifier.startsWith('./') || specifier.startsWith('../'))) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const targetPath = path.resolve(parentDir, specifier);
      const candidates = [
        targetPath + '.ts',
        targetPath + '.tsx',
        targetPath + '.js',
        targetPath + '.mjs',
        path.join(targetPath, 'index.ts'),
        path.join(targetPath, 'index.tsx'),
        path.join(targetPath, 'index.js'),
        path.join(targetPath, 'index.mjs'),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return {
            url: pathToFileURL(candidate).href,
            format: candidate.endsWith('.ts') || candidate.endsWith('.tsx') ? 'typescript' : 'module',
            shortCircuit: true,
          };
        }
      }
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx') || context.format === 'typescript') {
    const filePath = fileURLToPath(url);
    const source = fs.readFileSync(filePath, 'utf8');
    const result = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filePath,
    });
    return {
      format: 'module',
      source: result.outputText,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
