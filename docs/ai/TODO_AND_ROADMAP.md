# TODO and Roadmap

## LATER
- **Refactor Legacy Files:** `offscreen.html` and `offscreen.js` are currently orphaned in the repository. They should be evaluated for removal or repurposed if Chapar's JSON endpoints ever shut down and HTML scraping becomes required again.
- **Robust Selectors:** Update DOM selectors in `content.js` and `iran-post.js` to be more resilient to UI changes on Automoby and Iran Post.

## UNKNOWN PRIORITY
- **Auth Flow Polish:** Currently, if the Chapar portal session expires, the UI just shows an error or alert. An automated mechanism to open a tiny popup to refresh the Chapar session silently would be a huge UX improvement.
