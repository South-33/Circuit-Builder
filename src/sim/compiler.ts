export type CompileResult = {
  stdout: string;
  stderr: string;
  hex: string;
};

const COMPILER_URL = 'https://hexi.wokwi.com/build';
const compileCache = new Map<string, CompileResult>();
const STORAGE_PREFIX = 'hardware-lab:hex:v1:';

function sourceHash(source: string) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function readStoredCompile(source: string) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${sourceHash(source)}`);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { source: string; result: CompileResult };
    return stored.source === source && stored.result?.hex ? stored.result : null;
  } catch {
    return null;
  }
}

function storeCompile(source: string, result: CompileResult) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${sourceHash(source)}`,
      JSON.stringify({ source, result }),
    );
  } catch {
    // Compilation still works when storage is unavailable or full.
  }
}

export async function compileArduino(source: string, signal?: AbortSignal): Promise<CompileResult> {
  const cached = compileCache.get(source);
  if (cached) return cached;
  const stored = readStoredCompile(source);
  if (stored) {
    compileCache.set(source, stored);
    return stored;
  }

  const response = await fetch(COMPILER_URL, {
    method: 'POST',
    mode: 'cors',
    cache: 'no-cache',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sketch: source }),
  });

  if (!response.ok) throw new Error(`Compiler returned HTTP ${response.status}.`);
  const result = await response.json() as CompileResult;
  if (!result.hex) throw new Error(result.stderr || result.stdout || 'Compilation failed.');
  compileCache.set(source, result);
  storeCompile(source, result);
  return result;
}

