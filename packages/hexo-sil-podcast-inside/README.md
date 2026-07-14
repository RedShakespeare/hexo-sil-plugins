# hexo-sil-podcast-inside

Optional integration between `hexo-sil-podcast` and `hexo-theme-inside@2.7.0`.
It adds a paginated `/podcasts/` list when the compatible Inside browser and SSR
bundles are available.

## Install

```sh
npm install hexo-sil-podcast hexo-sil-podcast-inside hexo-theme-inside@2.7.0
```

The package postinstall script applies a narrowly versioned route patch to the
installed theme. It checks every expected anchor before writing. A missing or
incompatible theme is left unchanged, and the runtime integration safely points
the Podcasts menu to `/tags/Podcast/` instead.

Run the patch manually after reinstalling the theme if necessary:

```sh
npx hexo-sil-podcast-inside-patch
```

## Configure

The integration is enabled by default when this package is installed:

```yaml
podcast:
  inside:
    enabled: true
```

Set `enabled: false` to remove the Podcasts menu entry and skip the list
generator. This does not disable podcast players or RSS generation.

The dedicated list includes posts whose `podcast` front matter is present and
not `false`. Keep a `Podcast` tag on episodes so the safe fallback archive is
also useful when a future Inside release is not patch-compatible.
