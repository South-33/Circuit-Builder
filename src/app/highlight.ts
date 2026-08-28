function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'return', 'default', 'class', 'struct', 'public', 'private', 'protected',
  'static', 'volatile', 'extern', 'inline', 'virtual', 'const', 'new', 'delete',
  'sizeof', 'typedef', 'enum', 'union', 'goto',
]);

const TYPES = new Set([
  'void', 'int', 'bool', 'boolean', 'char', 'byte', 'float', 'double', 'long',
  'short', 'unsigned', 'signed', 'auto', 'size_t', 'uint8_t', 'uint16_t',
  'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'String',
  'word', 'PROGMEM',
]);

const CONSTANTS = new Set([
  'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN', 'true',
  'false', 'NULL', 'nullptr', 'ENABLE_LED_FEEDBACK', 'DEC', 'BIN', 'HEX', 'OCT',
  'CHANGE', 'FALLING', 'RISING', 'MSBFIRST', 'LSBFIRST',
]);

const BUILTINS = new Set([
  'setup', 'loop', 'pinMode', 'digitalWrite', 'digitalRead', 'analogRead',
  'analogWrite', 'analogReference', 'delay', 'delayMicroseconds', 'millis',
  'micros', 'pulseIn', 'pulseInLong', 'tone', 'noTone', 'shiftOut', 'shiftIn',
  'attachInterrupt', 'detachInterrupt', 'interrupts', 'noInterrupts', 'min',
  'max', 'abs', 'constrain', 'map', 'pow', 'sqrt', 'sin', 'cos', 'tan',
  'random', 'randomSeed', 'bitRead', 'bitSet', 'bitClear', 'bitWrite', 'bit',
  'Serial', 'Wire', 'SPI', 'IrReceiver', 'IrSender', 'LiquidCrystal',
  'LiquidCrystal_I2C', 'Adafruit_SSD1306', 'Adafruit_NeoPixel', 'Servo',
  'Stepper', 'RTC_DS1307', 'begin', 'print', 'println', 'write', 'available',
  'read', 'peek', 'flush', 'end', 'resume', 'decode', 'attach', 'writeMicroseconds',
  'step', 'setSpeed', 'setCursor', 'clear', 'show', 'setPixelColor',
]);

/**
 * Tokenizes and highlights Arduino C++ code with rich semantic classes.
 */
export function highlightArduinoCode(code: string): string {
  let result = '';
  let i = 0;
  const len = code.length;

  while (i < len) {
    // Line comment
    if (code[i] === '/' && code[i + 1] === '/') {
      let j = i;
      while (j < len && code[j] !== '\n') j++;
      result += `<span class="tok-comment">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // Block comment
    if (code[i] === '/' && code[i + 1] === '*') {
      let j = i + 2;
      while (j < len && !(code[j] === '*' && code[j + 1] === '/')) j++;
      if (j < len) j += 2;
      result += `<span class="tok-comment">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // Preprocessor directive
    if (code[i] === '#' && (i === 0 || code[i - 1] === '\n' || /^\s*$/.test(code.slice(Math.max(0, i - 20), i)))) {
      let j = i;
      while (j < len && code[j] !== '\n') j++;
      const line = code.slice(i, j);
      const incMatch = line.match(/^(#include\s*)([<"][^>\n]+[>"])/);
      if (incMatch) {
        result += `<span class="tok-directive">${escapeHtml(incMatch[1])}</span><span class="tok-string">${escapeHtml(incMatch[2])}</span>`;
      } else {
        result += `<span class="tok-directive">${escapeHtml(line)}</span>`;
      }
      i = j;
      continue;
    }

    // String literal
    if (code[i] === '"') {
      let j = i + 1;
      while (j < len && code[j] !== '"') {
        if (code[j] === '\\' && j + 1 < len) j += 2;
        else j++;
      }
      if (j < len) j++;
      result += `<span class="tok-string">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // Character literal
    if (code[i] === "'") {
      let j = i + 1;
      while (j < len && code[j] !== "'") {
        if (code[j] === '\\' && j + 1 < len) j += 2;
        else j++;
      }
      if (j < len) j++;
      result += `<span class="tok-string">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // Numbers (hex, binary, float, integer)
    if (/\d/.test(code[i]) || (code[i] === '.' && /\d/.test(code[i + 1] ?? ''))) {
      let j = i;
      if (code[j] === '0' && (code[j + 1] === 'x' || code[j + 1] === 'X')) {
        j += 2;
        while (j < len && /[0-9a-fA-F]/.test(code[j])) j++;
      } else if (code[j] === '0' && (code[j + 1] === 'b' || code[j + 1] === 'B')) {
        j += 2;
        while (j < len && /[01]/.test(code[j])) j++;
      } else {
        while (j < len && /[0-9.eE+-]/.test(code[j])) j++;
      }
      result += `<span class="tok-number">${escapeHtml(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // Identifiers and words
    if (/[a-zA-Z_]/.test(code[i])) {
      let j = i;
      while (j < len && /[a-zA-Z0-9_]/.test(code[j])) j++;
      const word = code.slice(i, j);

      if (KEYWORDS.has(word)) {
        result += `<span class="tok-keyword">${escapeHtml(word)}</span>`;
      } else if (TYPES.has(word)) {
        result += `<span class="tok-type">${escapeHtml(word)}</span>`;
      } else if (CONSTANTS.has(word)) {
        result += `<span class="tok-constant">${escapeHtml(word)}</span>`;
      } else if (BUILTINS.has(word)) {
        result += `<span class="tok-function">${escapeHtml(word)}</span>`;
      } else if (code[j] === '(' || (code[j] === ' ' && code[j + 1] === '(')) {
        result += `<span class="tok-function">${escapeHtml(word)}</span>`;
      } else {
        result += escapeHtml(word);
      }
      i = j;
      continue;
    }

    // Operators and punctuation
    result += escapeHtml(code[i]);
    i++;
  }

  return result;
}
