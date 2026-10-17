# GoJira: Live Jira UI Inspection Report

**Date of Inspection:** 2026-10-17  
**Inspected Environment:** Authenticated Live Jira Instance at `https://jira.automoby.ir`  
**Tool Used:** Chrome DevTools MCP (Target Page ID: 3)  
**Document Status:** Verified Production Findings  

---

## 1. Executive Summary & Verification Methodology

Prior to writing code or committing to architectural design for the **GoJira** feature, an exhaustive live browser DOM and interaction audit of `https://jira.automoby.ir` was conducted via the Chrome DevTools MCP.

All findings recorded in this document are derived from actual runtime DOM queries, Atlassian AUI components, event listener inspections, and live control evaluations in the active authenticated session. No identifiers, keys, or custom field IDs have been guessed or inferred from legacy code.

---

## 2. Authenticated Session & Account Verification

- **Current Authenticated Jira User:**
  - `meta[name="ajs-remote-user"]`: `mohammad-karimi`
  - `meta[name="ajs-remote-user-fullname"]`: `محمد کریمی`
  - Associated Email in Suggestions: `mrmki1100@gmail.com`
- **Session State:** Active, fully authenticated on `https://jira.automoby.ir/secure/Dashboard.jspa`.
- **Target Assignee Account for Production داننده Template:**
  - Full Name: `منیره داننده` (Monireh Danandeh)
  - Username: `monire-danande`
  - Corporate Email: `monire-danande@automoby.ir`
  - Verified Suggestion DOM ID: `#منیره-داننده-1-link` in `#assignee-suggestions`
  - Suggestion Role: `role="option"`, class `aui-list-item-link aui-iconised-link`
- **Session Guard:** The active Chrome profile is authenticated and has permission to view projects, open the Create Issue dialog, and assign issues.

---

## 3. Create Issue Trigger & Dialog Architecture

- **Trigger Control:**
  - Selector: `#create_link` (anchor button in top navigation bar)
  - Tag & Classes: `<a id="create_link" class="aui-button aui-button-primary aui-style create-issue" href="/secure/CreateIssue!default.jspa" accesskey="c" role="button">`
  - Access Key: `c`
  - Visual Label: `Create`
- **Dialog Container:**
  - Selector: `#create-issue-dialog`
  - Tag & Classes: `<div id="create-issue-dialog" class="aui-dialog2 aui-layer jira-dialog2 jira-dialog-core aui-dialog2-large jira-dialog-open jira-dialog-content-ready" role="dialog" style="z-index: 3000;">`
  - Lifecycle: Dynamically injected or displayed upon clicking `#create_link`. Form content settles asynchronously.
- **Dialog Actions:**
  - Submit Button: `input#create-issue-submit[type="submit"][value="Create"]`
  - Cancel Button: `button.cancel[type="button"]` (inside footer: `aui-button aui-button-link cancel`)

---

## 4. Global Invariants: Project and Issue Type

### 4.1 Project Selector (`Platform`)
- **Global Rule:** Must always be `Platform`.
- **Component Type:** Atlassian AUI SingleSelect (`aui-ss-field`).
- **Visible Input:** `input#project-field[type="text"][role="combobox"]`
  - `aria-controls="project-suggestions"`
  - Display value: `Platform (پلتفرم) (PLATFORM)`
- **Underlying Value Input:** `input#project[name="pid"][type="text"]`
  - Verified Value: `10512`
- **Project Key:** `PLATFORM`
- **Suggestions Container:** `#project-suggestions`
  - Suggestion ID for Platform: `#platform-(پلتفرم)-(platform)-20-link`
  - Verification: When `Platform` is typed or selected, `#project.value` settles to `10512`.

### 4.2 Issue Type Selector (`Task`)
- **Global Rule:** Must always be `Task`.
- **Component Type:** Atlassian AUI SingleSelect (`aui-ss-field`).
- **Visible Input:** `input#issuetype-field[type="text"][role="combobox"]`
  - `aria-controls="issuetype-suggestions"`
  - Display value: `Task`
- **Underlying Value Input:** `input#issuetype[name="issuetype"][type="text"]`
  - Verified Value: `10002`
- **Available Issue Types in Platform:** `Task` (10002), `Improvement`, `New Feature`, `Bug`, `Epic`.
- **Verification:** When `Task` is active, `#issuetype.value` settles to `10002`.

---

## 5. Field Specifications & Mapping Contract

### 5.1 Summary (خلاصه)
- **Selector:** `input#summary[name="summary"][type="text"]`
- **Required:** Yes (`aui-icon-required` present, label `Summary Required`).
- **Contract:** For production `داننده` template, contains ONLY the exact authoritative tracking number (no store name, no customer name, no prefixes/suffixes). For authorized QA issue, strictly `Delivery Assistant`.

### 5.2 Description (توضیحات)
- **Selector:** `textarea#description[name="description"]`
- **Required:** No.
- **Contract:** Exactly the store name extracted from the expanded Automoby record details followed immediately by a single newline `\n`. Remainder left blank for the operator. Preserves existing manual text if edited.

### 5.3 Priority (اولویت)
- **Selector:** `select#priority[name="priority"]` with visible input `input#priority-field`.
- **Initial Default:** `Medium` (value `3`).
- **Contract:** Must NOT be modified by the extension. Left exactly as Jira initializes it.

### 5.4 Labels (برچسب‌ها)
- **Container Selector:** `#labels-multi-select` (Atlassian JIRA MultiSelect component)
- **Visible Input:** `textarea#labels-textarea[role="combobox"]`
- **Underlying Select:** `select#labels[name="labels"][multiple="multiple"]`
- **Items Container:** `#labels-multi-select .representation ul.items`
- **Required Value:** `CX` (uppercase ASCII).
- **Commit Behavior Verified:** Setting `textarea.value = 'CX'` and dispatching a `keydown` event with `{ keyCode: 13, which: 13, key: 'Enter' }` automatically commits the chip into `.items` and creates `<option value="CX" selected>CX</option>` in `#labels`.
- **Deduplication:** Before committing, the extension checks if `CX` is already committed in `.items` or `#labels` to prevent duplicate tags.

### 5.5 Assignee (مسئول)
- **Visible Input:** `input#assignee-field[type="text"]`
- **Underlying Select:** `select#assignee[name="assignee"]`
- **Container / Suggestions:** `#assignee-suggestions`
- **Production Account (`داننده`):**
  - Typing `داننده` displays `#منیره-داننده-1-link` with text `منیره داننده - monire-danande@automoby.ir (monire-danande)`.
  - Clicking this suggestion sets `#assignee.value = 'monire-danande'` and `#assignee-field.value = 'منیره داننده'`.
- **QA Test Issue Assignee (Current Authenticated User):**
  - Current user: `محمد کریمی` (`mohammad-karimi`).
  - Has built-in trigger button: `button#assign-to-me-trigger.aui-button-link` ("Assign to me").
  - Alternatively, selecting `#محمد-کریمی-2-link` in `#assignee-suggestions` sets `#assignee.value = 'mohammad-karimi'`.

### 5.6 Tracking Number Custom Field (شماره مرسوله)
- **Selector:** `input#customfield_10402[name="customfield_10402"][type="text"]`
- **Field Label:** `شماره مرسوله (Tracking Number)`
- **Required:** Optional in schema, mandatory for GoJira contract.
- **Contract:** Must match the Summary value exactly.

### 5.7 Request Subject Custom Field (موضوع درخواست)
- **Selector:** `select#customfield_10401[name="customfield_10401"]`
- **Field Label:** `موضوع درخواست (Request Subject) Required`
- **Contract:** Production GoJira MUST leave this unselected (`value=""`, display `None`). The operator must review and select the business subject manually before submission.
- **Available Options Verified:**
  - `""` (None) [Default]
  - `10119` (استعلام-ازفروشگاه)
  - `10120` (اسنپ-باکس)
  - `10121` (اصلاح-اطلاعات)
  - `10122` (بررسی-مرجوعی)
  - `10123` (تاخیر-ارسال)
  - `10124` (تاخیر-تحویل)
  - `10125` (تایید-لغو)
  - `10126` (تایید-مرجوعی)
  - `10127` (تکمیل-اطلاعات)
  - `10128` (تیکت-ترب)
  - `10129` (خسارتی)
  - `10130` (سوال-فنی)
  - `10131` (فنی)
  - `10132` (همکاری)
  - `10133` (پیشنهادات)
  - `10134` (پیگیری-بارنامه)
  - `10135` (پیگیری-سفارش)
  - `10136` (پیگیری-عودت-وجه)
  - `10137` (پیگیری-مرجوعی)
  - `10138` (چاپار)
  - `10139` (کدتخفیف)
  - `10140` (تعریف-کالا)
  - `10141` (مچینگ)
  - `10142` (قیمت-گذاری)
  - `10200` (درخواست‌های-داخلی)

### 5.8 Requester Team Custom Field (تیم متقاضی)
- **Selector:** `select#customfield_10400[name="customfield_10400"]`
- **Field Label:** `Requester Team (تیم متقاضی)`
- **Default:** `-1` (None).
- **Contract:** Left unchanged unless specified.

---

## 6. Stability & Selector Strategy Matrix

| Field | Primary Stable Selector | Fallback Selector | Interaction Protocol |
| :--- | :--- | :--- | :--- |
| **Create Button** | `#create_link` | `a.create-issue` | Click event |
| **Dialog** | `#create-issue-dialog` | `.jira-dialog2[role="dialog"]` | Wait for `.jira-dialog-content-ready` |
| **Project** | `#project` (value `10512`) | `#project-field` | Ensure value `10512`, select `Platform` |
| **Issue Type** | `#issuetype` (value `10002`) | `#issuetype-field` | Ensure value `10002`, select `Task` |
| **Summary** | `#summary` | `input[name="summary"]` | Value set + dispatch `input`, `change` |
| **Description** | `#description` | `textarea[name="description"]` | Value set + dispatch `input`, `change` |
| **Priority** | `#priority` | `select[name="priority"]` | READ-ONLY verification (preserve initial) |
| **Labels** | `#labels-textarea` | `#labels` | Val set to `CX` + Enter key event |
| **Assignee (Prod)** | `#assignee-field` | `#assignee` | Search `داننده` -> click `#منیره-داننده-1-link` |
| **Assignee (QA)** | `#assign-to-me-trigger` | `#assignee-field` | Click "Assign to me" trigger |
| **Tracking Number** | `#customfield_10402` | `input[name="customfield_10402"]`| Value set + dispatch `input`, `change` |
| **Request Subject**| `#customfield_10401` | `select[name="customfield_10401"]`| Verified left empty / None |

---

## 7. Submission Policy & Safety Bounds

1. **Production Tickets:** NEVER automatically submitted. The modal remains open, fully populated, for operator review, subject selection, and manual submission.
2. **Authorized QA Test Issue:** Authorized to create at most ONE live ticket strictly with Summary `Delivery Assistant`, Project `Platform`, Issue Type `Task`, Assignee `محمد کریمی` (current user), and zero customer or real order data.
