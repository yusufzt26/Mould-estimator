// Offline license keys: a key is a small record (customer, optional PC code, optional expiry) signed with the
// owner's private key. The app only holds the public key below, so it can check keys but never make them.
const crypto = require("node:crypto");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const PUBLIC_KEY = require("./public-key.json").key; // Ed25519, base64 (SPKI DER)
const pub = crypto.createPublicKey({ key: Buffer.from(PUBLIC_KEY, "base64"), format: "der", type: "spki" });

/* A short code for this PC, so a key can be locked to one computer. Windows: the install's MachineGuid. */
function machineCode() {
  let id = "";
  if (process.platform === "win32") {
    try {
      const out = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { windowsHide: true, encoding: "utf8" });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
      if (m) id = m[1];
    } catch {}
  }
  if (!id) id = os.hostname() + "|" + Object.values(os.networkInterfaces()).flat().filter(n => n && !n.internal && n.mac !== "00:00:00:00:00:00").map(n => n.mac).sort()[0];
  const h = crypto.createHash("sha256").update("mould-estimator|" + id.toLowerCase()).digest();
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let s = "";
  for (let i = 0; i < 10; i++) s += A[h[i] % 32];
  return s.slice(0, 5) + "-" + s.slice(5);
}

/* Key text: MEST-<record>.<signature>, both base64url. Spaces and line breaks from email are ignored. */
function check(text, code) {
  const t = String(text || "").replace(/\s+/g, "");
  const m = t.match(/^MEST-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return { ok: false, why: "This does not look like a Mould Estimator license key. Copy the whole key, starting with MEST-." };
  let rec;
  try {
    if (!crypto.verify(null, Buffer.from(m[1]), pub, Buffer.from(m[2], "base64url"))) throw 0;
    rec = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
  } catch { return { ok: false, why: "This license key is not valid. Check that it was copied completely." }; }
  if (rec.m && rec.m !== code) return { ok: false, why: "This key was made for another computer. Send this PC's code (" + code + ") to your supplier for a new key." };
  if (rec.x && new Date(rec.x + "T23:59:59") < new Date()) return { ok: false, why: "This license ended on " + rec.x + ". Ask your supplier to renew it.", rec };
  return { ok: true, rec };
}

module.exports = { machineCode, check };
