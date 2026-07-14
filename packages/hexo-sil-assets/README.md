# hexo-sil-assets

Versioned asset manifests for Hexo, with optional Cloudflare R2 maintenance
commands. Other `hexo-sil-*` packages can read the shared capability when this
package is installed and explicitly enabled; if it is absent they retain their
legacy local-file behavior.

## Install and enable

```sh
npm install hexo-sil-assets
```

```yaml
assets:
  manifest: source/_data/assets.json
```

The Hexo plugin exposes `hexo.sil.assets`. The default manifest path is shown
above. A manifest records stable object keys, byte sizes, SHA-256 digests, MIME
types, and optional audio duration/title metadata. Its state is either
`legacy` or `r2`.

## Maintenance configuration

Create `hexo-sil-assets.config.js` in the project root:

```js
'use strict';

module.exports = {
  manifest: 'source/_data/assets.json',
  managed: [
    { prefix: 'files', source: 'source/files', ignore: 'source/files/**' },
    { prefix: 'downloads/manual.zip', source: 'source/downloads/manual.zip', ignore: 'source/downloads/manual.zip' }
  ],
  workspace: '.assets-workspace.json',
  publish: {
    checks: [
      { command: 'npx', args: ['hexo', 'generate', '--bail'] }
    ],
    git: false
  }
};
```

Each `managed` entry maps an R2 object prefix to either a local directory or a
single local file. `ignore` is appended to `.gitignore` only when an R2
migration is finalized. Git staging, committing, and pushing are disabled by
default. To opt in, replace `git: false` with a mapping such as:

```js
git: { remote: 'origin', branch: 'main', stage: true, commit: true, push: true }
```

## Commands

```sh
npx hexo-sil-assets seed
npx hexo-sil-assets verify
npx hexo-sil-assets publish --dry-run
npx hexo-sil-assets pull --prefix files/library
npx hexo-sil-assets migrate --finalize
npx hexo-sil-assets delete --key files/library/old.zip
npx hexo-sil-assets mode
```

Use `--root /path/to/site` and `--config relative/or/absolute.js` when running
outside the site root. `pull` records restored prefixes in
`.assets-workspace.json`; subsequent `publish` operations only infer deletions
inside those restored prefixes.

R2 operations require these environment variables:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
```

`R2_ENDPOINT` is optional. Credentials are never read from the Hexo config or
written to the manifest.

`migrate --finalize` verifies every configured source against R2 before
switching the manifest to `state: r2`. It then offers to add configured ignore
rules and stop Git tracking the verified local files while leaving them on
disk. Run it only from a complete, hydrated checkout.

## Optional legacy rclone bridge

Projects that still mirror Git/LFS assets through rclone can configure the
separate compatibility command:

```js
legacySync: {
  source: 'source/files',
  remote: 'remote-name:bucket/path',
  implementationInputs: ['package.json', '.github/workflows/deploy.yml']
}
```

```sh
npx hexo-sil-assets-legacy-sync --detect
npx hexo-sil-assets-legacy-sync --sync --mode incremental
```

Without `legacySync`, this command exits safely without choosing a site-specific
source or remote.
