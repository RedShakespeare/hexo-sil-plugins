# Hexo Sil Plugins

Five CommonJS plugins for Hexo 6 and 7:

- `hexo-sil-assets`: versioned asset manifests and optional R2 maintenance commands.
- `hexo-sil-audio`: article audio metadata, player markup, interaction, and skins.
- `hexo-sil-archive`: searchable file archives backed by a manifest or local files.
- `hexo-sil-podcast`: podcast article players, RSS generation, and feed verification.
- `hexo-sil-podcast-inside`: optional podcast listing integration for `hexo-theme-inside@2.7.0`.

All packages require Node.js 20 or newer and use the MIT license. Each package has its own README with installation and configuration details.

## Development

```sh
npm install
npm test
npm run pack:dry-run
```

`npm run test:integration` accepts `HEXO_SIL_SITE` pointing at a Hexo checkout and validates the packed tarballs in a temporary copy without changing that checkout.

## Independent releases

Every workspace owns its version and Git tag. A published GitHub Release triggers
`.github/workflows/publish.yml` and publishes exactly the package named by its
tag. Tags must use this format:

```text
hexo-sil-assets@0.1.0
hexo-sil-audio@0.1.1
hexo-sil-podcast@0.2.0-beta.1
```

Prepare a release version with npm's workspace version command through the
validated helper:

```sh
npm run release:prepare -- hexo-sil-audio patch
npm run check
git add packages/hexo-sil-audio/package.json package-lock.json
git commit -m "[release] hexo-sil-audio 0.1.1"
git push origin main
```

Create a GitHub Release from that commit with tag
`hexo-sil-audio@0.1.1`. Mark GitHub Releases for SemVer prerelease versions as
prereleases. Stable versions publish to npm's `latest` dist-tag; versions such
as `0.2.0-beta.1` publish to `next`. Tags and npm versions are immutable and
must never be reused or moved.

The release job verifies that the tag points into `main`, the package version
matches the tag, the npm version does not already exist, and all tests and pack
audits pass before publishing.

### npm authentication bootstrap

The five package names must exist on npm before Trusted Publishing can be
configured. Create a GitHub Environment named `npm-publish`, add a short-lived
granular npm publish token as its `NPM_TOKEN` secret, then publish the initial
releases in dependency order:

1. `hexo-sil-assets@0.1.0`
2. `hexo-sil-audio@0.1.0`
3. `hexo-sil-archive@0.1.0`
4. `hexo-sil-podcast@0.1.0`
5. `hexo-sil-podcast-inside@0.1.0`

After the first releases, configure each package's npm Trusted Publisher with:

- GitHub organization or user: `RedShakespeare`
- repository: `hexo-sil-plugins`
- workflow filename: `publish.yml`
- environment: `npm-publish`
- allowed action: `npm publish`

Remove `NPM_TOKEN` after all five bindings are in place. The same workflow then
uses GitHub OIDC through npm 12 and automatically records provenance. At that
point, configure each npm package to require two-factor authentication and
disallow traditional token publishing.
