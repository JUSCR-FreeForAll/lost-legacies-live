/** Minimal deterministic POSIX ustar writer/reader (regular files only). */

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

export function writeTar(files: ReadonlyArray<{ path: string; data: Buffer }>): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    if (Buffer.byteLength(file.path) > 99 || file.path.includes("..") || file.path.startsWith("/")) {
      throw new Error("TAR_INVALID_PATH");
    }
    const header = Buffer.alloc(512, 0);
    header.write(file.path, 0, 100, "utf8");
    header.write(octal(0o644, 8), 100, "ascii");
    header.write(octal(0, 8), 108, "ascii");
    header.write(octal(0, 8), 116, "ascii");
    header.write(octal(file.data.length, 12), 124, "ascii");
    header.write(octal(0, 12), 136, "ascii");
    header.write("        ", 148, "ascii");
    header.write("0", 156, "ascii");
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    let sum = 0;
    for (const b of header) sum += b;
    header.write(octal(sum, 7) + " ", 148, "ascii");
    blocks.push(header, file.data);
    const pad = (512 - (file.data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

export function readTar(archive: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) return out;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/s, "").trim() || "0", 8);
    const stored = parseInt(header.subarray(148, 156).toString("ascii").replace(/\0.*$/s, "").trim(), 8);
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 32 : header[i]!;
    if (!Number.isFinite(size) || size < 0 || sum !== stored) throw new Error("TAR_CORRUPT_HEADER");
    if (name.includes("..") || name.startsWith("/")) throw new Error("TAR_INVALID_PATH");
    const start = offset + 512;
    if (start + size > archive.length) throw new Error("TAR_TRUNCATED");
    if (out.has(name)) throw new Error("TAR_DUPLICATE_ENTRY");
    out.set(name, Buffer.from(archive.subarray(start, start + size)));
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error("TAR_TRUNCATED");
}
