# Development Workflow

## Environment
This is a standard Vanilla JS Chrome Extension (Manifest V3). 
- No Node.js build tools (Webpack, Vite, Rollup) are required or currently used.
- No package manager (`npm`, `yarn`) is currently active for building.

## Loading into Chrome
1. Open Chrome and navigate to `chrome://extensions`.
2. Enable "Developer mode" in the top right corner.
3. Click "Load unpacked" and select the root directory of this repository (`c:\Users\mrmki\Documents\antiGG repo\chrome exten`).

## Reloading Changes
- **Content Scripts (`content.js`, `ui-render.js`, `styles.css`):**
  - Save the file.
  - Go to `chrome://extensions` and click the "Reload" icon on the extension card.
  - **CRITICAL:** You must also refresh the target webpage (`panel.automoby.ir`) for the new content scripts to inject.
- **Service Worker (`background.js`):**
  - Save the file.
  - Go to `chrome://extensions` and click the "Reload" icon.
  - Service worker changes take effect immediately on the next message it receives.
- **Manifest (`manifest.json`):**
  - Any changes to permissions, DNR rules, or host permissions require a full extension reload from `chrome://extensions`.

## Important Development Commands
Because there is no build step, development consists entirely of saving files and reloading the extension.

## Configuration Files
- `manifest.json`: The singular source of truth for configuration.

## Debugging Workflow
1. For UI/DOM issues: Inspect elements directly on the Automoby page.
2. For API/Fetch issues: Inspect the "service worker" context via `chrome://extensions`.

*(Confirmed: No automated build pipelines, compilers, or transpilers exist in this repository)*
