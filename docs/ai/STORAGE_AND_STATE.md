# Storage and State

## Persistent State (`chrome.storage.local`)
- **Key:** `postTrackingTask`
- **Data Structure:** String (Tracking Number)
- **Lifecycle:**
  - Written by: `background.js` when the user clicks the "Post" button in Automoby.
  - Read by: `iran-post.js` when `tracking.post.ir` finishes loading.
  - Destroyed by: `iran-post.js` immediately after injecting it into the DOM to prevent infinite loops on page reloads.

## In-Memory State
- **Location:** `content.js`
- **Variables:** `activeCustomerName`
- **Lifecycle:** Updated every time a user clicks a row in the Automoby dashboard. Used to populate the title of the modals. Destroyed on page refresh.

## Possible Stale-State Issues
If `tracking.post.ir` fails to load entirely, or the DOM structure changes so that the injection fails, `postTrackingTask` may remain in `chrome.storage.local`. The next time the user manually visits `tracking.post.ir`, the stale tracking number might suddenly inject itself.
