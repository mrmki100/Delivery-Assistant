/**
 * offscreen.js
 * 
 * Runs entirely in the background within the hidden offscreen document.
 * Its sole purpose is to receive raw HTML strings from the Service Worker,
 * use the DOMParser (which the Service Worker lacks), extract the tracking data,
 * and send a clean JSON object back.
 */

chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message, sender, sendResponse) {
    if (message.target !== 'offscreen') return false;

    if (message.type === 'PARSE_CHAPAR_HTML') {
        const parsedData = parseChaparHTML(message.html);
        sendResponse(parsedData);
    }
    
    // Returning true is required if sendResponse is called asynchronously,
    // but since our parse function is sync, false works.
    // However, returning false closes the port, so let's just not return anything to be safe, 
    // or return false since we sent it immediately.
    return false;
}

/**
 * Parses the raw HTML string returned by the Chapar server.
 * This function extracts the Flexigrid rows and maps them into JSON.
 */
function parseChaparHTML(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    
    const logs = [];
    
    // This selector targets standard Flexigrid table rows.
    // You may need to tweak 'tr' or the cell indices depending on Chapar's exact HTML DOM.
    const rows = doc.querySelectorAll('tr'); 
    
    rows.forEach((row) => {
        // Skip header rows
        if (row.querySelector('th')) return;
        
        const cells = Array.from(row.querySelectorAll('td'));
        
        // Ensure this row has enough columns to be a valid tracking log
        if (cells.length >= 3) {
            // Assuming standard Chapar layout: Date, Time, Action, Location, Operator
            logs.push({
                date: cells[0]?.innerText?.trim() || '',
                time: cells[1]?.innerText?.trim() || '',
                action: cells[2]?.innerText?.trim() || 'ثبت در سیستم',
                location: cells[3]?.innerText?.trim() || 'مرکز مبادله',
                operator: cells[4]?.innerText?.trim() || ''
            });
        }
    });

    // Fallback Mock Logic: If the parse fails (e.g., they use a non-standard grid), 
    // we return empty array so the UI degrades gracefully.
    return { logs: logs };
}
