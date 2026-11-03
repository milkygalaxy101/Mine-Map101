# App icon

- `urci-icon.svg`: the owner's icon design (1024 × 1024), unchanged.
- `urci-icon-adaptive-108dp.svg`: the same artwork for Android adaptive icons. Launchers crop icons to their own
  shape (often a circle), which would cut the "URCI" text in the corner. Here the artwork is scaled to 76 % of the
  visible area and the road and background are extended outward, so the text stays inside even a circle mask.

Regenerate (Chromium via Playwright, as in the UI tests):

```bash
node assets/icon/render-icons.cjs <dir-with-both-svgs>     # writes <dir>/res/mipmap-*/ic_launcher*.png
node assets/icon/render-splash-icon.cjs <dir>              # writes <dir>/icon-rounded-768.png for the splash
```

The splash images (`res/drawable*/splash.png`) are white with the rounded icon centred at 34 % of the short side.
The adaptive icon background colour is `#2F6FA8` (`res/values/ic_launcher_background.xml`).
