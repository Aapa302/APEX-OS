// ── DNA ENCODER V1 SERVICE ──────────────────────────────────
// Implements robust binary-to-DNA mapping with 00=A, 01=C, 10=G, 11=T,
// and a homopolymer scrambling layer restricting consecutive identical bases to max 3.
// Supports both UTF-8 text and raw binary buffers (images, files, etc.).
// ────────────────────────────────────────────────────────────

const rotation = { 'A': 'C', 'C': 'G', 'G': 'T', 'T': 'A' };

/**
 * Encodes a raw binary Buffer into DNA bases with a homopolymer scrambling layer.
 * @param {Buffer} buffer - The input binary buffer.
 * @returns {string} - The encoded DNA sequence.
 */
function encodeBuffer(buffer) {
  if (!buffer || buffer.length === 0) return "";

  // 1. Convert buffer bytes to binary string
  let binaryString = "";
  for (const byte of buffer) {
    binaryString += byte.toString(2).padStart(8, '0');
  }

  // 2. Map 2-bit binary pairs to DNA bases
  let bases = [];
  for (let i = 0; i < binaryString.length; i += 2) {
    const bits = binaryString.slice(i, i + 2);
    let base;
    if (bits === "00") base = "A";
    else if (bits === "01") base = "C";
    else if (bits === "10") base = "G";
    else if (bits === "11") base = "T";
    bases.push(base);
  }

  // 3. Add homopolymer scrambling layer (limit consecutive identical bases to max 3)
  let scrambledBases = [];
  let runLength = 0;
  let currentBase = "";

  for (const base of bases) {
    if (base === currentBase) {
      runLength++;
    } else {
      currentBase = base;
      runLength = 1;
    }

    scrambledBases.push(base);

    if (runLength === 3) {
      const sentinel = rotation[base];
      scrambledBases.push(sentinel);
      currentBase = sentinel;
      runLength = 1;
    }
  }

  return scrambledBases.join("");
}

/**
 * Decodes a DNA sequence back into its original raw binary Buffer.
 * @param {string} dna - The encoded DNA sequence.
 * @returns {Buffer} - The decoded raw binary Buffer.
 */
function decodeToBuffer(dna) {
  if (!dna) return Buffer.alloc(0);

  // 1. Unscramble the homopolymer layer (remove sentinel bases)
  let originalBases = [];
  let runLength = 0;
  let currentBase = "";

  for (let i = 0; i < dna.length; i++) {
    const base = dna[i];

    if (base === currentBase) {
      runLength++;
    } else {
      currentBase = base;
      runLength = 1;
    }

    originalBases.push(base);

    if (runLength === 3) {
      i++; // Skip the next character (the sentinel base)
      currentBase = "";
      runLength = 0;
    }
  }

  // 2. Convert DNA bases back to binary string
  let binaryString = "";
  for (const base of originalBases) {
    if (base === "A") binaryString += "00";
    else if (base === "C") binaryString += "01";
    else if (base === "G") binaryString += "10";
    else if (base === "T") binaryString += "11";
  }

  // 3. Convert binary string back to bytes
  let bytes = [];
  for (let i = 0; i < binaryString.length; i += 8) {
    const byteStr = binaryString.slice(i, i + 8);
    if (byteStr.length === 8) {
      bytes.push(parseInt(byteStr, 2));
    }
  }

  return Buffer.from(bytes);
}

/**
 * Encodes a text string into DNA bases.
 * @param {string} text - The input text string.
 * @returns {string} - The encoded DNA sequence.
 */
function encode(text) {
  if (!text) return "";
  return encodeBuffer(Buffer.from(text, 'utf8'));
}

/**
 * Decodes a DNA sequence back into original text.
 * @param {string} dna - The encoded DNA sequence.
 * @returns {string} - The decoded text string.
 */
function decode(dna) {
  if (!dna) return "";
  return decodeToBuffer(dna).toString('utf8');
}

module.exports = {
  encode,
  decode,
  encodeBuffer,
  decodeToBuffer
};
