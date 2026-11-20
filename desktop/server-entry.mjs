// The desktop app's local web server: serves the same app files as the website and answers /api/* with the
// unchanged Netlify function, whose storage is swapped for files on this PC (see shims/). Bundled by build.mjs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import handler from "../netlify/functions/api.mts";
import { OWNER_EMAILS, claimOwner, keepOwner, dropOwner } from "./shims/owner.mjs";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".map": "application/json" };

async function api(req, res, url) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const route = url.pathname.replace(/^\/api\/?/, "");
  let claimed = false;
  if (route === "setup" && req.method === "POST") {
    // first login on this PC: that email becomes the owner of this install
    let email = "";
    try { email = String(JSON.parse(raw.toString() || "{}").email || "").trim().toLowerCase(); } catch {}
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) claimed = claimOwner(email);
  }
  const request = new Request(url.href, { method: req.method, headers: req.headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : raw });
  let response;
  try { response = await handler(request, {}); }
  catch (e) { response = Response.json({ error: "Something went wrong: " + (e && e.message) }, { status: 500 }); }
  if (claimed) { if (response.ok) keepOwner(); else dropOwner(); }
  res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json", "cache-control": "no-store" });
  res.end(Buffer.from(await response.arrayBuffer()));
}

function file(res, webDir, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const full = path.join(webDir, path.normalize(rel).replace(/^([/\\])+/, ""));
  if (!full.startsWith(webDir)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(full).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(buf);
  });
}

export function startServer(webDir, preferredPort) {
  webDir = path.resolve(webDir);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) return api(req, res, url).catch(e => { res.writeHead(500); res.end(String(e)); });
    file(res, webDir, url.pathname);
  });
  return new Promise((resolve, reject) => {
    const listen = (port) => server.listen(port, "127.0.0.1", () => resolve(server.address().port));
    server.once("error", (e) => {
      if (e.code === "EADDRINUSE" && preferredPort) { server.removeAllListeners("error"); server.once("error", reject); listen(0); }
      else reject(e);
    });
    listen(preferredPort || 0);
  });
}
export const hasOwner = () => OWNER_EMAILS.length > 0;
