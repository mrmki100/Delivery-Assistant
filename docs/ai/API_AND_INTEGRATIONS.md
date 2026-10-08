# API and Integrations

## 1. Chapar Public Tracking REST API
- **Endpoint:** `GET https://app.krch.ir/v1/tracking?input=[ENCODED_JSON]`
- **Purpose:** Fetch basic metadata (Sender, Receiver, Origin, Destination) for a given Waybill.
- **Request Flow:** Service Worker sends standard GET request.
- **Authentication:** None required.
- **Data Format:** Strict JSON.
- **Failure Scenario:** If it fails, the extension simply ignores the metadata and relies entirely on the internal portal logs.

## 2. Chapar Internal Consignment Search (Portal)
- **Endpoint:** `POST https://portal.chaparnet.com/OBJ/List/Consignment.php?Filter=&__Method=Internal&`
- **Purpose:** Used to search by Phone Number (to return a list of waybills) OR search by Waybill (to extract the internal database `id`).
- **Headers Required:** `X-Requested-With: XMLHttpRequest`, `Origin: https://portal.chaparnet.com`, `Referer: https://portal.chaparnet.com/...` (Spoofed via DNR).
- **Authentication:** Relies on active browser session cookies. `credentials: 'include'` MUST be set.
- **Data Format:** Form URL Encoded Body. Returns "Sloppy" JSON.
- **Failure Scenario:** Returns an HTML login page if session is expired. Extension catches this and triggers `AUTH_REQUIRED`.

## 3. Chapar Internal Consignment History (Portal)
- **Endpoint:** `POST https://portal.chaparnet.com/OBJ/List/ConsignmentHistory.php?cons_no=[INTERNAL_ID]&__Method=Internal&`
- **Purpose:** Fetch the highly detailed, internal-only logistical logs for a specific internal `cons_no`.
- **Headers Required:** Same as above.
- **Authentication:** Same as above.
- **Data Format:** Form URL Encoded Body. Returns "Sloppy" JSON.
- **Failure Scenario:** Fails if `INTERNAL_ID` was not successfully extracted in the previous step.

## External Assumptions
The extension heavily assumes the DOM structure of `panel.automoby.ir` (MuiDataGrid classes and `data-field` attributes) and the HTML output of `tracking.post.ir`. If these external sites update their frontends, the DOM scraping logic will break.
