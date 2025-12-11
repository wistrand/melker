#!/usr/bin/env -S deno run --allow-all
// Raw keyboard input tester - shows all key sequences from terminal
// Press Ctrl+C or Escape to exit

// Put terminal in raw mode
Deno.stdin.setRaw(true);

console.log('Raw keyboard input tester');
console.log('Press keys to see their byte sequences');
console.log('Press Ctrl+C or Escape to exit');
console.log('-----------------------------------');

const buf = new Uint8Array(32);

function formatBytes(bytes: Uint8Array, len: number): string {
  const parts: string[] = [];
  for (let i = 0; i < len; i++) {
    const b = bytes[i];
    parts.push(b.toString().padStart(3, ' '));
  }
  return parts.join(' ');
}

function formatHex(bytes: Uint8Array, len: number): string {
  const parts: string[] = [];
  for (let i = 0; i < len; i++) {
    parts.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return parts.join(' ');
}

function formatChars(bytes: Uint8Array, len: number): string {
  const parts: string[] = [];
  for (let i = 0; i < len; i++) {
    const b = bytes[i];
    if (b >= 32 && b < 127) {
      parts.push(String.fromCharCode(b));
    } else if (b === 27) {
      parts.push('ESC');
    } else if (b === 13) {
      parts.push('CR');
    } else if (b === 10) {
      parts.push('LF');
    } else if (b === 9) {
      parts.push('TAB');
    } else if (b === 8) {
      parts.push('BS');
    } else if (b === 127) {
      parts.push('DEL');
    } else if (b === 0) {
      parts.push('NUL');
    } else if (b < 32) {
      parts.push(`^${String.fromCharCode(b + 64)}`);
    } else {
      parts.push(`\\x${b.toString(16).padStart(2, '0')}`);
    }
  }
  return parts.join(' ');
}

function identifyKey(bytes: Uint8Array, len: number): string {
  // Single byte
  if (len === 1) {
    const b = bytes[0];
    if (b === 27) return 'Escape';
    if (b === 13) return 'Enter';
    if (b === 9) return 'Tab';
    if (b === 127) return 'Backspace (DEL)';
    if (b === 8) return 'Backspace (BS)';
    if (b === 0) return 'Ctrl+Space or Ctrl+@';
    if (b >= 1 && b <= 26) return `Ctrl+${String.fromCharCode(b + 64)}`;
    if (b === 28) return 'Ctrl+\\';
    if (b === 29) return 'Ctrl+]';
    if (b === 30) return 'Ctrl+^';
    if (b === 31) return 'Ctrl+_';
    if (b >= 32 && b < 127) return `'${String.fromCharCode(b)}'`;
  }

  // Escape sequences
  if (len >= 2 && bytes[0] === 27) {
    // ESC [ sequences (CSI)
    if (bytes[1] === 91) { // [
      const seq = String.fromCharCode(...bytes.slice(2, len));

      // Arrow keys
      if (seq === 'A') return 'Up';
      if (seq === 'B') return 'Down';
      if (seq === 'C') return 'Right';
      if (seq === 'D') return 'Left';
      if (seq === 'H') return 'Home';
      if (seq === 'F') return 'End';

      // Function keys
      if (seq === '1~' || seq === '7~') return 'Home';
      if (seq === '2~') return 'Insert';
      if (seq === '3~') return 'Delete';
      if (seq === '4~' || seq === '8~') return 'End';
      if (seq === '5~') return 'PageUp';
      if (seq === '6~') return 'PageDown';

      // F1-F12
      if (seq === '11~' || seq === '[A') return 'F1';
      if (seq === '12~' || seq === '[B') return 'F2';
      if (seq === '13~' || seq === '[C') return 'F3';
      if (seq === '14~' || seq === '[D') return 'F4';
      if (seq === '15~' || seq === '[E') return 'F5';
      if (seq === '17~') return 'F6';
      if (seq === '18~') return 'F7';
      if (seq === '19~') return 'F8';
      if (seq === '20~') return 'F9';
      if (seq === '21~') return 'F10';
      if (seq === '23~') return 'F11';
      if (seq === '24~') return 'F12';

      // Modified arrows (1;2 = Shift, 1;3 = Alt, 1;5 = Ctrl, 1;6 = Ctrl+Shift, etc.)
      const modMatch = seq.match(/^1;(\d)([A-H])$/);
      if (modMatch) {
        const mod = parseInt(modMatch[1]);
        const key = { A: 'Up', B: 'Down', C: 'Right', D: 'Left', H: 'Home', F: 'End' }[modMatch[2]] || modMatch[2];
        const mods: string[] = [];
        if (mod & 1) mods.push('Shift');
        if ((mod - 1) & 2) mods.push('Alt');
        if ((mod - 1) & 4) mods.push('Ctrl');
        return mods.join('+') + '+' + key;
      }

      // Shift+Tab
      if (seq === 'Z') return 'Shift+Tab';

      return `CSI ${seq}`;
    }

    // ESC O sequences (SS3)
    if (bytes[1] === 79) { // O
      const key = String.fromCharCode(bytes[2]);
      if (key === 'A') return 'Up (SS3)';
      if (key === 'B') return 'Down (SS3)';
      if (key === 'C') return 'Right (SS3)';
      if (key === 'D') return 'Left (SS3)';
      if (key === 'H') return 'Home (SS3)';
      if (key === 'F') return 'End (SS3)';
      if (key === 'P') return 'F1 (SS3)';
      if (key === 'Q') return 'F2 (SS3)';
      if (key === 'R') return 'F3 (SS3)';
      if (key === 'S') return 'F4 (SS3)';
      return `SS3 ${key}`;
    }

    // Alt+key (ESC followed by character)
    if (len === 2 && bytes[1] >= 32 && bytes[1] < 127) {
      return `Alt+${String.fromCharCode(bytes[1])}`;
    }
    if (len === 2 && bytes[1] >= 1 && bytes[1] <= 26) {
      return `Alt+Ctrl+${String.fromCharCode(bytes[1] + 64)}`;
    }
  }

  return '?';
}

async function main() {
  try {
    while (true) {
      const n = await Deno.stdin.read(buf);
      if (n === null) break;

      const bytes = buf.slice(0, n);

      // Check for Ctrl+C (3) or Escape alone
      if (n === 1 && (bytes[0] === 3 || bytes[0] === 27)) {
        // Wait a tiny bit to see if more bytes are coming (escape sequence)
        if (bytes[0] === 27) {
          // Give time for rest of escape sequence
          await new Promise(r => setTimeout(r, 10));
          const n2 = await Deno.stdin.read(buf.subarray(n));
          if (n2 !== null && n2 > 0) {
            // More bytes came, process as escape sequence
            const totalLen = n + n2;
            const identified = identifyKey(buf, totalLen);
            console.log(
              `Bytes: ${formatBytes(buf, totalLen).padEnd(20)} | ` +
              `Hex: ${formatHex(buf, totalLen).padEnd(20)} | ` +
              `Chars: ${formatChars(buf, totalLen).padEnd(20)} | ` +
              `Key: ${identified}`
            );
            continue;
          }
        }

        console.log('\nExiting...');
        break;
      }

      const identified = identifyKey(bytes, n);
      console.log(
        `Bytes: ${formatBytes(bytes, n).padEnd(20)} | ` +
        `Hex: ${formatHex(bytes, n).padEnd(20)} | ` +
        `Chars: ${formatChars(bytes, n).padEnd(20)} | ` +
        `Key: ${identified}`
      );
    }
  } finally {
    Deno.stdin.setRaw(false);
  }
}

main();
