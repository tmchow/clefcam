# Brand assets

`clefcam-header.svg` is the editable README illustration; its PNG is used by GitHub and other Markdown renderers. The scene is illustrative, not a model result. `public/icon.svg` is the editable camera/C app icon.

After editing either source, regenerate the checked-in PNGs from the repository root:

```sh
npm ci
node scripts/render-brand-assets.mjs
```

The script uses the repository's pinned Sharp dependency. Keep the icon's square background opaque and let the operating system apply its own corner mask. Review both a full-size rendering and a 60px preview after changes.
