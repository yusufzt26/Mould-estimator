// Desktop stand-in for @netlify/blobs: the same calls the Netlify function makes, kept in files on this PC.
// One process owns the data, so an in-memory copy is authoritative and every write goes straight to disk.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.env.MOULD_DATA_DIR || path.join(process.cwd(), "data");
const stores = new Map();
const etagOf = (raw) => '"' + createHash("sha1").update(raw).digest("hex") + '"';
const fileOf = (dir, key) => path.join(dir, encodeURIComponent(key) + ".json");

function open(name) {
  if (stores.has(name)) return stores.get(name);
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  const mem = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    mem.set(decodeURIComponent(f.slice(0, -5)), { raw, etag: etagOf(raw) });
  }
  const write = (key, raw) => {
    const file = fileOf(dir, key), tmp = file + ".tmp";
    fs.writeFileSync(tmp, raw);
    fs.renameSync(tmp, file);
    const e = { raw, etag: etagOf(raw) };
    mem.set(key, e);
    return e;
  };
  const read = (e, opts) => (opts && opts.type === "json" ? JSON.parse(e.raw) : e.raw);
  const store = {
    async get(key, opts) { const e = mem.get(key); return e ? read(e, opts) : null; },
    async getWithMetadata(key, opts) { const e = mem.get(key); return e ? { data: read(e, opts), etag: e.etag, metadata: {} } : null; },
    async set(key, value, opts) {
      if (opts && opts.onlyIfNew && mem.has(key)) return { modified: false };
      return { modified: true, etag: write(key, String(value)).etag };
    },
    async setJSON(key, value, opts) {
      if (opts && opts.onlyIfNew && mem.has(key)) return { modified: false };
      return { modified: true, etag: write(key, JSON.stringify(value)).etag };
    },
    async delete(key) { mem.delete(key); try { fs.unlinkSync(fileOf(dir, key)); } catch {} },
    async list(opts) {
      const prefix = (opts && opts.prefix) || "";
      const blobs = [];
      for (const [key, e] of mem) if (key.startsWith(prefix)) blobs.push({ key, etag: e.etag });
      return { blobs, directories: [] };
    },
  };
  stores.set(name, store);
  return store;
}

export function getStore(opts) { return open(typeof opts === "string" ? opts : opts.name); }
