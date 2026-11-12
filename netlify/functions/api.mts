// Mould Estimator backend on Netlify: logins, shared documents (Netlify Blobs) and AI reading (Netlify AI Gateway).
import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";
import { createHmac, randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";
import { OWNER_EMAILS } from "../../lib/owner.mts";

const docs = () => getStore({ name: "mould-docs", consistency: "strong" });
const users = () => getStore({ name: "mould-users", consistency: "strong" });
const sys = () => getStore({ name: "mould-sys", consistency: "strong" });

const json = (body: unknown, status = 200) => Response.json(body, { status });
const lower = (s: unknown) => String(s || "").trim().toLowerCase();
const isOwnerEmail = (e: string) => OWNER_EMAILS.map(lower).includes(lower(e));
const COLS = new Set(["jobs", "masters", "people"]);
const okId = (s: unknown) => typeof s === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(s);

/* ---------- tokens: HMAC-signed, 30 days ---------- */
async function secret(): Promise<string> {
  const s = sys();
  let v = await s.get("secret");
  if (!v) { await s.set("secret", randomBytes(48).toString("hex"), { onlyIfNew: true }); v = await s.get("secret"); }
  return v as string;
}
const b64 = (s: string) => Buffer.from(s).toString("base64url");
async function sign(u: { id: string; email: string; name: string; ver: number }) {
  const body = b64(JSON.stringify({ id: u.id, email: u.email, name: u.name, ver: u.ver || 0, exp: Date.now() + 30 * 864e5 }));
  return body + "." + createHmac("sha256", await secret()).update(body).digest("base64url");
}
type Me = { id: string; email: string; name: string };
async function who(req: Request): Promise<Me | null> {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [body, mac] = t.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", await secret()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString());
  if (!p.exp || p.exp < Date.now()) return null;
  const u = await users().get("u/" + lower(p.email), { type: "json" }) as any;
  if (!u || u.id !== p.id || (u.ver || 0) !== (p.ver || 0) || u.disabled) return null; // password change or removal signs out old sessions
  return { id: u.id, email: u.email, name: u.name };
}
const hash = (pw: string, salt: string) => scryptSync(pw, salt, 64).toString("hex");
function pwOk(pw: string, u: any) {
  const a = Buffer.from(hash(pw, u.salt), "hex"), b = Buffer.from(u.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
const pwRule = (pw: unknown) => typeof pw === "string" && pw.length >= 8 && pw.length <= 200;

/* ---------- rights, same table as the app ---------- */
const ROLE: Record<string, string[]> = { admin: ["edit", "quote", "price", "del", "learn", "master", "users"], sales: ["edit", "quote", "price", "del", "learn"], cost: ["edit", "learn"], view: [] };
async function can(me: Me, k: string) {
  if (isOwnerEmail(me.email)) return true;
  const a = await docs().get("masters/access", { type: "json" }) as any;
  if (!a) return ROLE.sales.includes(k);
  const u = (a.users || {})[me.id];
  const role = (u && u.role) || a.def || "sales";
  if (role === "custom") return !!(u.r && Number(u.r[k]) > 0);
  return (ROLE[role] || []).includes(k);
}
async function mayWrite(me: Me, col: string, id: string, del = false) {
  if (col === "jobs") return del ? can(me, "del") : (await can(me, "edit")) || (await can(me, "quote"));
  if (col === "masters" && id === "rates") return !del && ((await can(me, "master")) || (await can(me, "learn")));
  if (col === "masters" && id === "access") return !del && can(me, "users");
  if (col === "people") return !del && id === me.id;
  return false;
}

/* ---------- routes ---------- */
export default async (req: Request, context: Context) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, "");
  const body: any = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (route === "login") {
    const u = await users().get("u/" + lower(body.email), { type: "json" }) as any;
    if (!u || u.disabled || !pwRule(body.password) || !pwOk(body.password, u)) return json({ error: "Wrong email or password." }, 401);
    return json({ token: await sign(u), user: { id: u.id, email: u.email, name: u.name } });
  }
  if (route === "setup") {
    // first login for the owner only; everyone else is added by an admin
    const email = lower(body.email);
    if (!isOwnerEmail(email)) return json({ error: "Ask your admin to add you. Only the owner can create the first login." }, 403);
    if (!pwRule(body.password)) return json({ error: "Use at least 8 characters." }, 400);
    const salt = randomBytes(16).toString("hex");
    const u = { id: randomUUID(), email, name: String(body.name || email.split("@")[0]).slice(0, 80), salt, hash: hash(body.password, salt), ver: 0, at: Date.now() };
    const r = await users().setJSON("u/" + email, u, { onlyIfNew: true });
    if (!r.modified) return json({ error: "This login already exists. Sign in instead." }, 409);
    return json({ token: await sign(u), user: { id: u.id, email, name: u.name } });
  }

  if (route === "erp-feed") {
    // read-only list for ZT-ERP LITE (Fetch estimate). Only these fields leave the estimator. Its server sends ERP_LINK_KEY.
    const want = process.env.ERP_LINK_KEY || "";
    if (want.length < 16) return json({ error: "ERP link is not set up on this site (ERP_LINK_KEY)." }, 501);
    const h = (x: string) => createHmac("sha256", "erp-feed").update(x).digest();
    if (!timingSafeEqual(h(req.headers.get("x-link-key") || ""), h(want))) return json({ error: "Wrong link key." }, 401);
    const { blobs } = await docs().list({ prefix: "jobs/" });
    const all = await Promise.all(blobs.map(async b => ({ id: b.key.slice(5), j: await docs().get(b.key, { type: "json" }) as any })));
    const estimates = all.filter(x => x.j && !x.j.example).map(({ id, j }) => {
      const e = j.erp && j.erp.v === 1 ? j.erp : null;
      return { id, no: j.no || "", customer: j.customer || "", part: j.part || "", mouldNo: j.mouldNo || "", status: j.status || "draft", date: j.date || "",
        updatedAt: j.updatedAt || 0, price: e ? e.price : null, gstPct: e ? e.gstPct : null };
    });
    return json({ estimates, at: Date.now() });
  }

  const me = await who(req);
  if (!me) return json({ error: "Please sign in again." }, 401);

  if (route === "me") return json({ user: me, owner: isOwnerEmail(me.email) });

  if (route === "password") {
    const u = await users().get("u/" + lower(me.email), { type: "json" }) as any;
    if (!pwOk(String(body.old || ""), u)) return json({ error: "Current password is wrong." }, 400);
    if (!pwRule(body.password)) return json({ error: "Use at least 8 characters." }, 400);
    u.salt = randomBytes(16).toString("hex"); u.hash = hash(body.password, u.salt); u.ver = (u.ver || 0) + 1;
    await users().setJSON("u/" + lower(me.email), u);
    return json({ token: await sign(u) });
  }

  if (route === "users") {
    // list logins (for Users & rights); admins can add a login or reset a password
    if (req.method === "GET") {
      const { blobs } = await users().list({ prefix: "u/" });
      const all = await Promise.all(blobs.map(b => users().get(b.key, { type: "json" }) as Promise<any>));
      return json({ users: all.filter(u => u && !u.disabled).map(u => ({ id: u.id, email: u.email, name: u.name })) });
    }
    if (!(await can(me, "users"))) return json({ error: "Only admins can add logins." }, 403);
    const email = lower(body.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Type a valid email." }, 400);
    const key = "u/" + email, cur = await users().get(key, { type: "json" }) as any;
    if (body.remove) { if (cur && !isOwnerEmail(email)) { cur.disabled = true; cur.ver = (cur.ver || 0) + 1; await users().setJSON(key, cur) } return json({ ok: true }); }
    if (!pwRule(body.password)) return json({ error: "Give a temporary password of at least 8 characters." }, 400);
    const salt = randomBytes(16).toString("hex");
    const u = { ...(cur || { id: randomUUID(), at: Date.now() }), email, name: String(body.name || (cur && cur.name) || email.split("@")[0]).slice(0, 80), salt, hash: hash(body.password, salt), ver: ((cur && cur.ver) || 0) + 1, disabled: false };
    await users().setJSON(key, u);
    return json({ user: { id: u.id, email, name: u.name } });
  }

  if (route === "sync") {
    // returns documents of a collection that changed since the caller's copy (by etag)
    const col = String(body.col || "");
    if (!COLS.has(col)) return json({ error: "bad collection" }, 400);
    const known: Record<string, string> = body.known || {};
    const { blobs } = await docs().list({ prefix: col + "/" });
    const now: Record<string, string> = {};
    for (const b of blobs) now[b.key.slice(col.length + 1)] = b.etag;
    const changedIds = Object.keys(now).filter(id => known[id] !== now[id]);
    const changed = await Promise.all(changedIds.map(async id => {
      const r = await docs().getWithMetadata(col + "/" + id, { type: "json" });
      return r ? { id, etag: r.etag, data: r.data } : null;
    }));
    return json({ changed: changed.filter(Boolean), removed: Object.keys(known).filter(id => !(id in now)) });
  }

  if (route === "doc") {
    const col = String(body.col || ""), id = String(body.id || "");
    if (!COLS.has(col) || !okId(id)) return json({ error: "bad path" }, 400);
    if (!(await mayWrite(me, col, id, !!body.delete))) return json({ error: "You do not have the right to change this." }, 403);
    if (body.delete) { await docs().delete(col + "/" + id); return json({ ok: true }); }
    const r = await docs().setJSON(col + "/" + id, body.data ?? {});
    return json({ etag: r.etag });
  }

  if (route === "import") {
    // owner only: load a backup exported from the claude.ai version
    if (!isOwnerEmail(me.email)) return json({ error: "Only the owner can import a backup." }, 403);
    let n = 0;
    for (const d of body.docs || []) {
      if (!COLS.has(d.col) || !okId(d.id) || d.col === "people") continue;
      if (d.col === "masters" && d.id === "access") continue; // user ids differ; rights are set again here
      await docs().setJSON(d.col + "/" + d.id, d.data); n++;
    }
    return json({ imported: n });
  }

  if (route === "ai") {
    if (!process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_API_KEY) return json({ error: "AI reading is not active on this site yet." }, 501);
    if (body.ping) return json({ images: true });
    const images = (body.images || []).slice(0, 8);
    const text = typeof body.input === "string" ? body.input : (body.input || []).map((m: any) => m.content).join("\n\n");
    const content: any[] = [
      ...images.map((im: any) => im.type === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: im.data } }
        : { type: "image", source: { type: "base64", media_type: im.type, data: im.data } }),
      { type: "text", text },
    ];
    try {
      const client = new Anthropic();
      const stream = client.messages.stream({ model: "claude-opus-5-5", max_tokens: 16000, output_config: { effort: "low" }, messages: [{ role: "user", content }] } as any);
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") return json({ error: "The AI declined to read this file.", code: "refused" }, 422);
      const out = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      return json({ text: out, truncated: msg.stop_reason === "max_tokens" });
    } catch (e: any) {
      if (e instanceof Anthropic.RateLimitError) return json({ error: "AI is busy, try again in a minute." }, 429);
      if (e instanceof Anthropic.BadRequestError) return json({ error: "This file could not be read.", code: "image_rejected" }, 400);
      if (e instanceof Anthropic.APIError) return json({ error: "AI service error " + (e.status || "") }, 502);
      return json({ error: "AI reading failed." }, 500);
    }
  }

  return json({ error: "not found" }, 404);
};

export const config: Config = { path: "/api/*" };
