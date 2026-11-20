# Mould Estimator (Zoom Technologies)

Hosted on Netlify. `public/` is the app; `netlify/functions/api.mts` handles logins, shared data (Netlify Blobs) and AI reading of BOMs (Netlify AI Gateway).

- Owner login emails: `lib/owner.mts`.
- First use: open the site, choose "First time? Owner setup", create the owner login. Add other logins in Masters → Users & rights.

## Windows app (installer with license key)

`desktop/` packs the same app as a Windows program: a normal window (no console), data kept on the PC in
`%APPDATA%\Mould Estimator\data`, and a license key asked for the first time it opens. Libraries and fonts are
included, so it works without internet. AI reading of BOMs is off in the desktop app.

- **Get the installer:** GitHub builds `Mould-Estimator-Setup-x.y.z.exe` for every merge to `main` (and a test
  build for each pull request). Download it from the repository's **Releases** page.
- **Make a license key:** open `license-generator.html` (the owner copy with your private key, kept outside this
  repository) in Chrome or Edge, type the customer name, optionally an end date and the customer's PC code, and
  press Make key. `tools/license-generator.html` is the same page without the private key.
- **New signing keys:** the app trusts only the public key in `desktop/app/public-key.json`. If the private key
  is ever lost or leaked, make a new pair, put the new public key there and release again; old keys then stop working.
- **First start on a customer PC:** after the key, whoever creates the first login becomes the owner of that
  install and adds other logins in Masters → Users & rights.
- Build on your own Windows PC: `npm ci`, then in `desktop/`: `npm ci` and `npm run dist` (output in `desktop/release`).
  `npm start` in `desktop/` runs it without installing.
