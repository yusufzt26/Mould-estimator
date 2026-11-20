// Prepares desktop/app for packaging: bundles the local server (Netlify function + file storage) into
// app/server.cjs, copies ../public to app/web, and saves the CDN libraries and fonts into app/web/vendor
// so the installed program works without internet.
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "app", "web");

await esbuild.build({
  entryPoints: [path.join(here, "server-entry.mjs")],
  outfile: path.join(here, "app", "server.cjs"),
  bundle: true, platform: "node", format: "cjs", target: "node22", logLevel: "warning",
  plugins: [{ name: "desktop-shims", setup(b) {
    b.onResolve({ filter: /^@netlify\/blobs$/ }, () => ({ path: path.join(here, "shims", "blobs.mjs") }));
    b.onResolve({ filter: /lib\/owner\.mts$/ }, () => ({ path: path.join(here, "shims", "owner.mjs") }));
  } }],
});

fs.rmSync(web, { recursive: true, force: true });
fs.cpSync(path.join(here, "..", "public"), web, { recursive: true });

const nm = (p) => path.join(here, "node_modules", p);
const save = (rel, src) => { const f = path.join(web, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.copyFileSync(src, f); };

// Same versions as the website loads from the CDN, taken from npm packages (devDependencies)
const LIBS = {
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js": "three/build/three.min.js",
  "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js": "three/examples/js/controls/OrbitControls.js",
  "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js": "exceljs/dist/exceljs.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js": "jspdf/dist/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js": "jspdf-autotable/dist/jspdf.plugin.autotable.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/": "pdfjs-dist/build/",
};
let html = fs.readFileSync(path.join(web, "index.html"), "utf8");
for (const [url, pkg] of Object.entries(LIBS)) {
  if (!html.includes(url)) throw new Error("index.html no longer loads " + url + ": update LIBS in desktop/build.mjs");
  const local = "vendor/" + pkg;
  if (url.endsWith("/")) for (const f of ["pdf.min.js", "pdf.worker.min.js"]) save(local + f, nm(pkg + f));
  else save(local, nm(pkg));
  html = html.split(url).join(local);
}
const left = html.match(/https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\/[^"'\s]+/g);
if (left) throw new Error("index.html loads libraries the desktop build does not save yet: " + left.join(", "));

// Fonts (Barlow, Barlow Semi Condensed, IBM Plex Mono) from @fontsource
const FONTS = { "barlow": ["400", "500", "600"], "barlow-semi-condensed": ["600", "700"], "ibm-plex-mono": ["400", "500"] };
let css = "";
for (const [fam, weights] of Object.entries(FONTS)) {
  const dir = nm("@fontsource/" + fam);
  fs.cpSync(path.join(dir, "files"), path.join(web, "vendor/fonts", fam, "files"), { recursive: true });
  for (const w of weights) { save("vendor/fonts/" + fam + "/" + w + ".css", path.join(dir, w + ".css")); css += `@import url("${fam}/${w}.css");\n`; }
}
fs.writeFileSync(path.join(web, "vendor/fonts/fonts.css"), css);
html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n?/, "")
  .replace(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/, "vendor/fonts/fonts.css");
fs.writeFileSync(path.join(web, "index.html"), html);
console.log("desktop app prepared in", path.relative(process.cwd(), path.join(here, "app")));
