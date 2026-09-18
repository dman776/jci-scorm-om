# SOWB-It

**S**CORM **O**bservation **W**orkbook **B**uilder **I**nternal **T**ool.

Author digital **observation workbooks** (ride-alongs, shadowing sessions, install-team meetings, field observations) through a visual UI, then export each one as a **self-contained** package you upload to any **SCORM 2004 4th Edition compliant LMS**.

Learners complete a workbook progressively over days or weeks, can exit at any time with **no data loss**, resume to the section list, and download a PDF of their own responses.

Built by Darryl Quinn.

---

## Quick start

```bash
# Node.js >= 20 required
npm install          # sets up workspaces; installs jszip, nanoid, @playwright/test
npm start            # authoring app at http://127.0.0.1:4173/
```

1. **Workbook Settings** — title, version, course id, dashboard heading, PDF download, navigation.
2. **Sections** — add sections (Required/Optional, optionally *locking*), then add observation questions.
3. **Rating Scales** — manage the reusable scale library.
4. **Preview** — run the real runtime against a mock LMS; test Exit + resume.
5. **Publish** — validate, then **Build SCORM ZIP**.

```bash
npm test                 # 180 tests
npm run build:template   # writes samples/template.xlsx
npm run export:demo      # builds out/<course>_SCORM2004.zip
npm run typecheck        # tsc --noEmit
npm run test:e2e         # Playwright learner specs (see below)
```

> **Offline note:** the exported package bundles no third-party code, and only `jszip` + `nanoid` are needed to build one (`@playwright/test` is for the e2e suite only). If you cannot reach the npm registry, vendor those two into `node_modules/` and symlink `node_modules/@sowb/*` to each `packages/*` folder.

---

## Completion state model

A question has **three states**, because a response can exist and still fail its requirement:

| State | Meaning |
|---|---|
| **Empty** | No response at all |
| **Partial** | A response exists but the requirement is unmet |
| **Complete** | Response exists and satisfies the requirement. Only these count. |

Sections roll that up into **four states**:

| State | Meaning |
|---|---|
| **Not Started** | Nothing answered |
| **In Progress** | Some answers exist, but a required question is still blank |
| **Partially Complete** | Nothing is blank, but a required question does not meet its requirement |
| **Completed** | Every required question is complete |

*In Progress* means you still have blanks; *Partially Complete* means you filled everything in but fell short. They need different coaching.

A section can also opt in to freezing its answers once it reaches *Completed* — see [Section locking](#section-locking).

**SCORM caveat:** SCORM 2004 has no "partial" `cmi.completion_status` (only completed / incomplete / unknown), so a partially complete section still reports the workbook as `incomplete`. The nuance lives in the learner dashboard (orange), the progress measure, and the authoring UI.

`cmi.progress_measure` is **question-level**: it counts required questions that are complete across required sections, so the bar moves as the learner works. Partial responses do not count.

---

## Completion rules by type

**Checklist / multiple select — expected options.** Tick **Expected** next to any option the learner must select. The question completes only when **every** expected option is checked; extra selections are allowed. Expected options are never marked in the learner runtime, and the unmet hint is neutral: *"Some required items are not yet selected."*

**Numeric — min/max.** Optional inclusive Minimum and Maximum plus an optional whole-numbers rule. A minimum of 4 means 4 passes. `0` is a real answer, not a blank.

**URL.** Must be a valid `http://` or `https://` link; anything else is *partial*. Validation is structural only (no network calls).

**Rating.** The value must be one of the points in its scale. A value orphaned by a later scale edit becomes *partial*, not complete.

---

## Rating scales

The **Rating Scales** screen manages a global library. Four ship built in:

| id | Points (value = label) |
|---|---|
| `numeric-5` | 1, 2, 3, 4, 5 |
| `agreement-5` | 5 = Strongly Agree, 4 = Agree, 3 = Neutral, 2 = Disagree, 1 = Strongly Disagree |
| `frequency-5` | 5 = Always, 4 = Almost Always, 3 = Sometimes, 2 = Rarely, 1 = Never |
| `confidence-3` | Low, Medium, High |

On `agreement-5` and `frequency-5` the scale runs **high = most positive**, so a higher stored number always means a better answer and the two can be averaged together.

Built-ins cannot be deleted but can be duplicated. A question references one by `scaleId`, or carries a one-off inline scale.

### Value vs label

Each point has a **value** (stored in `cmi.suspend_data`, shown to facilitators) and a **label** (what the learner reads). Responses persist the **value only**, so rewording "Neutral" later does not invalidate data already in the LMS. Changing a *value* is the unsafe edit, and the editor says so inline.

### Three things worth knowing

1. **Scales are inlined at publish, not looked up at runtime.** The SCO is offline and cannot call back to the server, so `inlineScales()` bakes concrete points into the package. **Editing a scale does not change an already-published package** — republish to pick up new wording.
2. **A dangling `scaleId` blocks export** rather than silently publishing an empty scale. The Rating Scales screen checks usage before deleting and lists affected questions.
3. **Rendering adapts to the labels.** Short labels (numbers) render as a row of chips; longer labels render one row per point with a value badge, which reads correctly on a phone and in a screen reader. Screen readers hear "2, Agree", collapsing to just "1" on unlabeled scales. Short numeric scales support optional end captions ("Not at all" … "Expert").

### Backward compatibility

Legacy inline arrays keep working, and this is subtler than it looks:

```js
scale: [1, 2, 3, 4, 5]          -> values 1..5        (responses were "1".."5")
scale: ['Low','Medium','High']  -> values 'Low'...    (responses were "Low"...)
```

The old runtime stored `String(point)`, so for a string array the **label was the stored value**. Renumbering Low/Medium/High to 1..3 would silently orphan every response already in an LMS. Both forms are preserved exactly, with tests pinning it.

---

## Learner PDF download

When enabled, the runtime header shows a **PDF** button on the section list. Wherever the learner is, the PDF contains the **entire workbook**: every section with its status, every question and answer, overall progress, and their name from `cmi.learner_name`.

- **Unanswered** questions appear as "Not answered" rather than being omitted.
- **Partial** answers carry the same neutral requirement hint the runtime shows.
- **Ratings** read as `Agree (4)`, collapsing to `3` when the scale is unlabeled.
- **Privacy:** the PDF never reveals which checklist options were flagged Expected. Only the learner's own selections are listed, and the word "expected" never appears.

Turn it off per workbook on **Workbook Settings** or with `Allow PDF Download` in the Excel Settings sheet. Defaults to **on**.

### How it is built

Generated **entirely inside the SCO** with no server call, so it works offline. Rather than bundling jsPDF (~350 KB and a break in the "no third-party code" rule), `runtime-template/js/pdf.js` is a purpose-built ~12 KB PDF writer: base-14 Helvetica (no font embedding), real Adobe glyph-width tables for wrapping, automatic pagination, a byte-accurate `xref` table, and WinAnsi substitution for the characters learners paste from Word (smart quotes, em dashes, ellipses, bullets).

### LMS sandbox caveat

Some LMS players host the SCO in an iframe whose `sandbox` lacks `allow-downloads`. The browser then blocks the download **silently**, with no error to catch. The runtime therefore always renders a visible fallback link:

> Download did not start? **Open the PDF in a new tab.**

**Verify this in your own LMS sandbox before wide release**, since behavior varies by LMS and browser.

---

## Navigation behavior

- **Resume always returns to the section list**, so the learner chooses what to continue.
- A section left mid-way reopens at the **exact question** they left off on ("Continue").
- A **Completed** section reopens at **question 1** for review, matching its "Review" button.
- Section cards and PDF headings show the **author's title verbatim** — no "Section N:" prefix, so "Month 1" reads naturally.

---

## Section locking

Tick **Lock answers when complete** on a section (or set `lockWhenComplete` in the JSON / the Excel Sections sheet) to freeze its answers once the learner is done with it. It is **off by default** and set per section.

**The lock commits when the learner leaves a completed section**, not the moment it turns Complete. That distinction is the whole design:

> A long-text answer counts as complete on its **first character**. Locking on status alone would freeze the section mid-sentence, on the very answer the learner is still typing.

So while the learner is still inside the section, every answer stays editable no matter how complete it is. The lock lands when they step out — back to the section list, finishing the last question, jumping to another section, or exiting the SCO.

Once locked:

- The section still opens and reads normally; the button stays **Review**. Only the answers are frozen.
- Every control renders disabled, **and** `SessionCore` rejects the write outright. The disabled attribute is the visible half; the rejection is the guarantee.
- Locked section ids persist in `cmi.suspend_data`, so relaunching does not unlock. **Nothing in the SCO can unlock a section** — only an LMS-side reset of the attempt.

Two guardrails worth knowing:

1. **Locking a section with no required questions warns at validation** (`lock-no-required-questions`). Such a section completes on the learner's first answer and would lock with every other item still blank.
2. **A lock lifts if a republished workbook makes the section incomplete again** — say you add a required question. Otherwise the learner would be stranded holding a frozen section that can never finish, and a workbook that can never report complete. Learners cannot reach this state themselves, since locked answers cannot change.

> **Note on navigation:** this is unrelated to the `linear` navigation gate, which decides whether a section can be **opened** at all. A locked section is always openable; a linear-gated one is not.

---

## Monorepo layout

```
scorm-om/
├─ packages/
│  ├─ shared/                   # constants, ids, JSDoc types, rating scale library
│  ├─ workbook-engine/          # response/section states, validation, suspend serialization
│  ├─ scorm-runtime/            # assembleRuntime(): the file set for preview AND export
│  ├─ export-service/           # export-target registry, manifest.js, packager.js (jszip)
│  ├─ mock-lms/                 # headless SCORM 2004 API_1484_11 for tests + preview
│  └─ excel-io/                 # xlsx read/write on jszip + workbook<->xlsx mapping
├─ apps/
│  ├─ server/                   # node:http authoring server + workbook/scale stores
│  └─ web/                      # zero-build vanilla ES-module authoring UI
├─ runtime-template/            # SOURCE of the exported/preview runtime
│  ├─ js/adapter.js             # API_1484_11 discovery + fallback
│  ├─ js/session.js             # DOM-free SCORM/state core
│  ├─ js/player.js              # learner UI
│  ├─ js/rating.js              # rating scale rendering
│  ├─ js/pdf.js                 # dependency-free PDF writer
│  ├─ js/report.js              # workbook -> PDF report builder
│  └─ js/engine/*.js            # Node-only shims; the assembler swaps in the real modules
├─ scripts/ samples/ data/ tests/
```

### One runtime, two consumers

`packages/scorm-runtime/assemble.js` produces the flat runtime file set. **Preview** serves it live and **export** writes the identical set into the ZIP, so both run byte-identical code. The engine and scale modules are dependency-free and copied verbatim into the package, so the browser resolves them with no bundler.

---

## Excel import

Download `template.xlsx` from the Library screen. Sheets: Instructions, Settings, Sections, Questions.

- **Settings** supports `Dashboard Heading` and `Allow PDF Download`.
- **Sections** columns: `Section ID`, `Title`, `Required (yes/no)`, `Order`, `Lock When Complete (yes/no)`.
- **Questions** columns: `Section ID`, `Type`, `Prompt`, `Required`, `Options`, `Rating Scale`, `Min`, `Max`, `Whole Numbers`, `Help Text`.
- Mark an expected option with `*`: `Scope review | *Safety plan | Schedule`.
- `Rating Scale` accepts a scale id (`agreement-5`), a scale name (`Agreement (5-point)`), explicit points (`1=Strongly Agree | 2=Agree`), bare labels (`Low|Medium|High`), or `1-5`.

Columns are matched **by header name**, not position, so older templates still import cleanly.

---

## Tests

```bash
npm test    # 180 tests
```

| Suite | Covers |
|---|---|
| `engine.test.js` (25) | three-state model, expected gating, numeric bounds, url, rating-vs-scale, section rollup, question-level progress, linear nav |
| `pdf.test.js` (25) | byte-accurate xref, `/Length`, escaping, Word-character substitution, Helvetica metrics, wrapping, pagination, report content, **privacy guarantee** |
| `scales.test.js` (22) | built-in definitions, library merge/override, legacy normalization (both traps), resolution, inlining, PDF formatting, validation, the Excel column |
| `player-dom.test.js` (20) | real `player.js` against a fake DOM: titles without prefix, configurable heading, partial hints, rating layouts, resume-to-dashboard, review rewind, learner name, PDF button |
| `section-lock.test.js` (20) | the lock rule, editable-until-you-leave, every commit path, write rejection, suspend/resume persistence, v2 payloads, read-only rendering, the authoring warning |
| `export.test.js` (17) | package structure, **every relative import resolving inside the ZIP**, no workspace imports, manifest completeness, scale inlining, Excel round-trip |
| `changes.test.js` (13) | whole-workbook PDF download from the header, including the blocked-download fallback |
| `mock-lms-suspend-resume.test.js` (13) | real `SessionCore` against `MockLMS`: suspend/resume, partial persistence, read-only `cmi.learner_name` |
| `wiring.test.js` (10) | the shipped package renders labeled scales, stores values not labels, and keeps legacy inline scales working |
| `scale-excel.test.js` (6) | the Questions sheet `Rating Scale` column: ids, names, explicit points, bare labels, round-trip |
| `section-name.test.js` (6) | author titles verbatim in headings and PDF, with question numbering retained |
| `scale-parity.test.js` (3) | **browser-copy parity** between `@sowb/shared/scales.js` and the authoring UI's own copy |

Verified separately during the build: the authoring server serves every asset and endpoint; the Preview route serves all 12 runtime files; and **the shipped package generates a valid multi-page PDF using only the files inside the ZIP, with no `node_modules` present.**

### End-to-end (Playwright)

`@playwright/test` installs with `npm install`; the browser binary does not.

```bash
npx playwright install chromium
npm run test:e2e         # 10 tests
```

| Spec | Covers |
|---|---|
| `learner.spec.js` (6) | section titles, expected/numeric gating, resume-in-place, review rewind, labeled rating rendering, exit + resume, a real browser `download` event |
| `section-lock.spec.js` (4) | a completed section staying editable until you leave, the lock holding on reopen, unflagged sections never locking, the lock surviving exit + resume |

---

## Uploading to your LMS

The package targets any **SCORM 2004 4th Edition compliant LMS**.

1. Publish → **Build SCORM ZIP**.
2. In your LMS, create a lesson and upload the ZIP as **SCORM 2004** content.
3. Configure the lesson to track completion.
4. **Recommended:** run the package through the ADL SCORM 2004 4th Edition Test Suite, and confirm the PDF download (and its fallback link) behaves in your sandbox.

## Tech stack

Node.js >= 20 with built-in `node:http`; zero-build vanilla ES modules for both the authoring UI and the runtime; custom `API_1484_11` adapter and SCORM 2004 manifest generator; `jszip` for packaging and xlsx, `nanoid` for ids. **The exported package bundles no third-party code.** Types via JSDoc + `// @ts-check`.

**Production target (designed for, not built):** Express/Fastify, React + TypeScript, Prisma + SQLite/PostgreSQL. Business logic sits behind package seams so it can move without touching workbook-state, SCORM, validation, packaging, or import code.

## cmi5 forward compatibility

The authored JSON keeps prompts out of suspend data and treats evidence as metadata only, so the same content can later publish to cmi5 without re-authoring. `packages/export-service/targets/cmi5.js` documents the planned target; it is intentionally not registered in the MVP.
