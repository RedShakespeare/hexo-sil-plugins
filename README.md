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
