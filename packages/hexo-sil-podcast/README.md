# hexo-sil-podcast

Podcast episode players, Apple-compatible RSS generation, and a published-feed
verifier for Hexo. Player markup is shared with `hexo-sil-audio`.

## Install

```sh
npm install hexo-sil-audio hexo-sil-podcast
```

Install `hexo-sil-assets` as well if episode metadata should come from a
versioned asset manifest. The integration is only used when installed and
enabled; otherwise local files below the Hexo source directory are read safely.

## Configure

```yaml
url: https://www.example.com

audio:
  media:
    prefix: files

podcast:
  dry_run: true
  path: podcast.xml
  title: Example Podcast
  description: Show description
  author: Example Author
  email: podcast@example.com
  language: en-US
  link: /
  image: podcast-cover.jpg
  category:
    text: Leisure
    subcategory: Games
  explicit: false
  limit: 0
  assets:
    enabled: true
  media:
    # prefix: files
    # source_dir: legacy-files
    # url: https://media.example.com/files/
```

`dry_run` defaults to `true`: episode players are rendered, but the RSS route
is omitted. Set it to `false` only after the public channel fields and artwork
are ready.

`podcast.media.prefix` defaults to `audio.media.prefix`. It is both the asset
manifest key prefix and the default public path. Leave `source_dir` unset unless
the legacy directory relative to `source/` differs from that prefix. Leave
`url` unset for normal site-relative media; when supplied, its absolute HTTPS
base replaces both player and RSS enclosure locations.

The assets capability is requested only when `podcast.assets.enabled` is true.
If `hexo-sil-assets` is not installed, the plugin warns once and reads the
legacy local file instead.

## Episodes

Recommended local/manifest mode:

```yaml
---
title: Episode one
date: 2026-07-13 20:00:00
tags:
  - Podcast
podcast:
  file: podcast/episode-001.mp3
  episode: 1
  season: 1
  episode_type: full
  explicit: false
  summary: Episode summary
---
```

`file` is relative to the effective media prefix. Supported formats are MP3,
M4A/M4B/MP4, AAC, OGG, Opus, WAV, FLAC, AIFF, and WebM. Manifest mode requires
the matching byte size, MIME type, and duration. Legacy mode derives them from
the local file.

Existing externally hosted episodes may use explicit metadata instead:

```yaml
podcast:
  audio: https://media.example.com/episode-001.mp3
  type: audio/mpeg
  length: 12345678
  duration: "42:10"
```

The URL must be absolute ASCII HTTPS. `length` is bytes, and `duration` is
`MM:SS` or `HH:MM:SS`. Do not combine these fields with `file`.

Optional fields include `guid`, `image`, `episode`, `season`, `episode_type`,
`explicit`, and `summary`. Audio URLs and GUIDs must be unique in a feed.

When publishing, channel and episode artwork must resolve to PNG or JPEG,
without alpha, square, and between 1400 and 3000 pixels. The feed must contain
at least one published episode and use an Apple Podcasts category accepted by
the plugin.

## Verify a deployed feed

```sh
npx hexo-sil-podcast-verify --url https://www.example.com/podcast.xml
```

Without `--url`, the verifier loads the Hexo site config in the current
directory. It checks RSS structure, HTTPS resources, artwork metadata,
enclosure `HEAD` metadata, and byte-range support.

For an optional dedicated list with `hexo-theme-inside@2.7.0`, install
`hexo-sil-podcast-inside`.
