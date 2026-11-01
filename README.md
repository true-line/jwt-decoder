# JWT Decoder

A Chromium extension that decodes a pasted JWT and shows its header, payload,
and signature with syntax highlighting. Vanilla JavaScript; Manifest V3.

## Load unpacked

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository root.

The popup is `popup.html`. Decoder logic lives in `src/`.

## Development

There is no build step. Edit the source files and reload the extension.

The decoder and the highlighter are pure modules with a Node test suite, so no
browser is needed to check them:

```bash
npm test        # node --test
```

`src/ui-controller.js` is the only module that touches the DOM; changes there
are checked by loading the extension unpacked.

## Releasing

Two checks make a release reproducible before anything is published:

```bash
npm run check:version      # manifest.json and package.json must declare one version
npm run package:release    # dist/jwt-decoder-<version>.zip + .sha256
```

The archive is built from tracked files against an explicit allowlist of runtime
paths, so the repository's own tooling — `.github/`, the governed agent harness,
`test/`, `AGENTS.md`, `README.md`, `package.json`, `icons/generate-icons.html` —
never ships. Timestamps are normalised, so two builds of the same tree are
byte-identical, and the finished archive is inspected against the selection it
claims to be.

Publishing to the Chrome Web Store is still manual: upload
`dist/jwt-decoder-<version>.zip` from the [developer
dashboard](https://chrome.google.com/webstore/devconsole) after verifying the
checksum. Automated publishing needs a store item id and credentials, plus the
release lifecycle this repository has not enrolled in yet.

## License

MIT. See `LICENSE`.
