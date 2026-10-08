# Dependencies

## External Libraries
**CONFIRMED:** There are NO external dependencies (NPM packages, CDNs, React, jQuery) loaded into this extension. It is written entirely in Vanilla JavaScript.

## Chrome APIs Used
- `chrome.runtime.sendMessage` / `.addListener`: Used heavily for Content Script <-> Service Worker communication.
- `chrome.runtime.onInstalled.addListener`: Used to trigger DNR rule registration.
- `chrome.storage.local`: Used exclusively to pass tracking numbers to `iran-post.js`.
- `chrome.tabs.create`: Used to open `tracking.post.ir`.
- `chrome.declarativeNetRequest.updateDynamicRules`: Used to spoof HTTP headers for `portal.chaparnet.com`.
