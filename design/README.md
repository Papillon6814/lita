# design/

- `app-icon.html` — the app icon source: paper tile, ink "L", mint dot, in the
  wordmark's font (Zen Kaku Gothic New, from `node_modules/@fontsource`). Render
  it at 1024×1024 with a transparent background and feed the PNG to
  `npx tauri icon`, which rewrites `src-tauri/icons/`. The `android/` and
  `ios/` folders it also produces are not used and are not committed.

```
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CH" --headless=new --allow-file-access-from-files --default-background-color=00000000 \
  --window-size=1024,1024 --force-device-scale-factor=1 --screenshot=icon.png \
  "file://$PWD/design/app-icon.html"
npx tauri icon icon.png
```
