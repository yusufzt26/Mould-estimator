// Desktop stand-in for lib/owner.mts: on a PC install, whoever creates the first login becomes its owner.
// The list is filled from owner.json in the data folder; app/main.cjs adds the email at first setup.
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.env.MOULD_DATA_DIR || path.join(process.cwd(), "data"), "owner.json");
export const OWNER_EMAILS = [];
try { OWNER_EMAILS.push(...JSON.parse(fs.readFileSync(FILE, "utf8")).emails); } catch {}

export function claimOwner(email) {
  if (OWNER_EMAILS.length) return false;
  OWNER_EMAILS.push(email);
  return true;
}
export function keepOwner() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ emails: OWNER_EMAILS }));
}
export function dropOwner() { OWNER_EMAILS.length = 0; }
