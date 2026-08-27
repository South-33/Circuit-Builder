export type CompileResult = {
  stdout: string;
  stderr: string;
  hex: string;
};

const COMPILER_URL = 'https://hexi.wokwi.com/build';
const compileCache = new Map<string, CompileResult>();
const STORAGE_PREFIX = 'hardware-lab:hex:v2:';

// HEXI intentionally ships only the Arduino core. Keep the editor compatible
// with the small IRremote surface used by common beginner projects without
// introducing a compile backend: this shim decodes the real NEC waveform that
// the simulator drives onto the receiver's DAT pin.
const IRREMOTE_COMPAT = String.raw`
#ifndef HARDWARE_LAB_IRREMOTE_COMPAT
#define HARDWARE_LAB_IRREMOTE_COMPAT
#ifndef ENABLE_LED_FEEDBACK
#define ENABLE_LED_FEEDBACK true
#endif

struct HardwareLabIRData { unsigned char command = 0; };

class HardwareLabIRReceiver {
 public:
  HardwareLabIRData decodedIRData;

  void begin(unsigned char pin, bool = false) {
    pin_ = pin;
    pinMode(pin_, INPUT_PULLUP);
  }

  bool decode() {
    // NEC: 9ms mark + 4.5ms space, then 32 LSB-first bits. Do not chain
    // pulseIn() calls here: pulseIn() waits for an already-active pulse to
    // finish before measuring, which would skip every alternating NEC space.
    const unsigned long leaderMark = measureLevel(LOW, 30000UL);
    if (leaderMark < 8000UL || leaderMark > 10000UL) return false;
    const unsigned long leaderSpace = measureLevel(HIGH, 7000UL);
    if (leaderSpace < 3500UL || leaderSpace > 5500UL) return false;

    unsigned long frame = 0;
    for (unsigned char bit = 0; bit < 32; bit++) {
      const unsigned long mark = measureLevel(LOW, 1600UL);
      if (mark < 300UL || mark > 900UL) return false;
      const unsigned long space = measureLevel(HIGH, 3000UL);
      if (space < 300UL || space > 2300UL) return false;
      if (space > 1000UL) frame |= (1UL << bit);
    }

    const unsigned char address = frame & 0xff;
    const unsigned char addressInverse = (frame >> 8) & 0xff;
    const unsigned char command = (frame >> 16) & 0xff;
    const unsigned char commandInverse = (frame >> 24) & 0xff;
    if ((unsigned char)(address ^ addressInverse) != 0xff) return false;
    if ((unsigned char)(command ^ commandInverse) != 0xff) return false;
    decodedIRData.command = command;
    return true;
  }

  void resume() {}

 private:
  unsigned long measureLevel(unsigned char level, unsigned long timeout) {
    const unsigned long waitStart = micros();
    while (digitalRead(pin_) != level) {
      if ((unsigned long)(micros() - waitStart) >= timeout) return 0;
    }
    const unsigned long pulseStart = micros();
    while (digitalRead(pin_) == level) {
      if ((unsigned long)(micros() - pulseStart) >= timeout) return 0;
    }
    return (unsigned long)(micros() - pulseStart);
  }

  unsigned char pin_ = 0;
};

HardwareLabIRReceiver IrReceiver;
#endif
`;

function prepareSource(source: string) {
  const include = /^\s*#\s*include\s*[<"]IRremote\.hpp[>"]\s*$/m;
  const match = include.exec(source);
  if (!match) return source;
  const line = source.slice(0, match.index).split('\n').length;
  const before = source.slice(0, match.index);
  const after = source.slice(match.index + match[0].length);
  // Restore the user's sketch line numbers after the injected compatibility
  // code so compiler diagnostics still point at the editor correctly.
  return `${before}${IRREMOTE_COMPAT}\n#line ${line + 1} "sketch.ino"${after}`;
}

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
  // Cache the exact source sent to HEXI, not only the editor source. This
  // invalidates stored HEX automatically whenever an injected compatibility
  // layer changes while keeping repeat starts fast for unchanged builds.
  const preparedSource = prepareSource(source);
  const cached = compileCache.get(preparedSource);
  if (cached) return cached;
  const stored = readStoredCompile(preparedSource);
  if (stored) {
    compileCache.set(preparedSource, stored);
    return stored;
  }

  const response = await fetch(COMPILER_URL, {
    method: 'POST',
    mode: 'cors',
    cache: 'no-cache',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sketch: preparedSource }),
  });

  if (!response.ok) throw new Error(`Compiler returned HTTP ${response.status}.`);
  const result = await response.json() as CompileResult;
  if (!result.hex) throw new Error(result.stderr || result.stdout || 'Compilation failed.');
  compileCache.set(preparedSource, result);
  storeCompile(preparedSource, result);
  return result;
}

