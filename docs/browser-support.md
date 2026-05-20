# Browser Support

Tansu2 targets the latest stable releases of Chromium, Firefox, and WebKit/Safari.
This is a single-user local app, so browser support intentionally follows current
evergreen engines instead of a long compatibility window. The TypeScript and
esbuild output target is `ESNext`.

The app must feature-detect browser APIs that are not uniformly available before
using them:

- `OffscreenCanvas`
- `createImageBitmap`
- `EventSource`
- `Selection`
- `execCommand`

E2E coverage runs against Chromium, Firefox, and WebKit using generated fixture
vaults. Browser tests must not read the user's real vault configuration.
