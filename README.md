# SCORM Observation Workbook Builder

Author digital **observation workbooks** (ride-alongs, shadowing sessions, install-team meetings, field observations) through a visual UI, then export each one as a **self-contained SCORM 2004 4th Edition** package you upload to Workday Learning.

Learners complete a workbook progressively over days or weeks, can exit at any time with **no data loss**, and on resume **always return to the section list to choose which section to continue**. Responses auto-save to the LMS after every page and every change.

Built by Darryl Quinn.

---

## Quick start

```bash
# Node.js >= 20 required
npm install          # sets up workspaces; installs jszip + nanoid
npm start            # authoring app at http://127.0.0.1:4173/
```

Then open **http://127.0.0.1:4173/** and:

1. **Workbook Settings** - title, version, course id, language, dashboard heading, navigation, completion behavior.
2. **Sections** - add sections (Required/Optional), then add observation questions.
3. **Preview** - run the real runtime against a mock LMS; test **Exit + resume**.
4. **Publish** - validate, then **Build SCORM ZIP** and download.

Other scripts:

```bash
npm run build:template   # writes samples/template.xlsx
npm run export:demo      # builds out/<course>_SCORM2004.zip from the demo workbook
npm test                 # Node test runner (51 tests)
npm run typecheck        # tsc --noEmit over the JSDoc-typed sources
npm run test:e2e         # Playwright learner spec (see "End-to-end tests")
```

> Offline/air-gapped note: only two runtime dependencies are used (`jszip`, `nanoid`). If you cannot reach the npm registry, vendor those two into `node_modules/` and create `node_modules/@sowb/*` symlinks to each `packages/*` folder; the app then runs from a fresh clone with only Node installed.

---

## Completion state model

A question is not simply answered or unanswered. It has **three states**, because a response can exist and still fail its requirement:

| State | Meaning |
|---|---|
| **Empty** | No response at all |
| **Partial** | A response exists but the requirement is unmet (numeric outside min/max, checklist missing an expected option, malformed link) |
| **Complete** | Response exists and satisfies the requirement. Only these count. |

Sections roll that up into **four states**:

| State | Meaning |
|---|---|
| **Not Started** | Nothing answered |
| **In Progress** | Some answers exist, but a required question is still blank |
| **Partially Complete** | Nothing is blank, but a required question does not meet its requirement |
| **Completed** | Every required question is complete |

The useful distinction: *In Progress* means you still have blanks; *Partially Complete* means you filled everything in but fell short of a requirement. They need different coaching.

**SCORM caveat:** SCORM 2004 has no "partial" `cmi.completion_status` (only completed / incomplete / unknown), so a partially complete section still reports the workbook as `incomplete` to Workday Learning. The nuance lives in the learner dashboard (orange status), the progress measure, and the authoring UI.

### Progress measure

`cmi.progress_measure` is **question-level**: it counts required questions that are complete, across required sections, so the bar moves as the learner works. Partial responses do not count. A required section with no required questions contributes a single unit, satisfied when the section completes.

---

## Completion rules by type

**Checklist / multiple select - expected options.** Tick **Expected** next to any option the learner must select. The question completes only when **every** expected option is checked. Extra, non-expected selections are allowed and never block completion. If no options are marked Expected, any selection completes the question.

Expected options are **never visually marked in the learner runtime**, so learners cannot see which boxes are required. On an unmet requirement they see a neutral hint: *"Some required items are not yet selected."*

**Numeric - min/max.** Optional inclusive **Minimum** and **Maximum**, plus an optional whole-numbers-only rule. A minimum of 4 means 4 passes. Example: "How many meetings did you have this week?" with min 4 stays *partial* until the learner enters 4 or more. `0` is treated as a real answer, not a blank.

**URL.** Must be a valid `http://` or `https://` link. Anything else is *partial* and blocks completion. Validation is structural only (no network calls, since the SCO runs offline). Valid links render as a clickable preview (`target="_blank"`, `rel="noopener noreferrer"`).

---

## What the exported package does

Each published workbook is a static **HTML/CSS/JavaScript** SCO (no server or Node runtime):

- Launches in an LMS iframe as a single learning object.
- Talks to the LMS via the SCORM 2004 4th Edition runtime API (`API_1484_11`), discovered by walking the parent/opener frames, with a standalone no-LMS fallback for local preview.
- Presents questions grouped into ordered sections with a live, color-coded status dashboard (green completed, orange partially complete, amber in progress, gray not started).
- Auto-saves after every page and every response change (`SetValue` + `Commit`), plus a `beforeunload` save.
- On exit sets `cmi.exit = "suspend"`; on relaunch (`cmi.entry = "resume"`) it rehydrates all responses and the section/page cursor from `cmi.suspend_data`, then shows the section list.
- Reports `cmi.completion_status`, `cmi.progress_measure`, `cmi.session_time`/`cmi.total_time`, and optionally `cmi.success_status`.
- Is keyboard operable with visible focus (WCAG 2.1 AA oriented) and works offline after deployment.
- Ships `imsmanifest.xml` and `index.html` at the ZIP root.

---

## Monorepo layout

```
scorm-observation-workbook-builder/
├─ package.json                 # npm workspaces root
├─ packages/
│  ├─ shared/                   # constants, ids, JSDoc types (framework-free)
│  ├─ workbook-engine/          # response/section states, validation, suspend serialization (pure, browser-safe)
│  ├─ scorm-runtime/            # assembleRuntime(): the runtime file set for preview AND export
│  ├─ export-service/           # export-target registry, manifest.js, packager.js (jszip)
│  ├─ mock-lms/                 # headless SCORM 2004 API_1484_11 for tests + preview
│  └─ excel-io/                 # xlsx read/write on jszip + workbook<->xlsx mapping
├─ apps/
│  ├─ server/                   # node:http authoring server (thin glue)
│  └─ web/                      # zero-build vanilla ES-module authoring UI
├─ runtime-template/            # SOURCE of the exported/preview runtime
│  ├─ index.html                # SCO entry (templated)
│  ├─ js/adapter.js             # API_1484_11 discovery + fallback
│  ├─ js/session.js             # DOM-free SCORM/state core (shared by player + tests)
│  ├─ js/player.js              # learner UI (dashboard, pages, question types)
│  ├─ js/engine/*.js            # Node-only shims; the assembler swaps in the real engine
│  └─ css/player.css
├─ scripts/                     # build-template-xlsx.js, export-demo.js
├─ samples/                     # demo workbook JSON + template.xlsx
└─ tests/                       # node:test suites + Playwright e2e
```

### One runtime, two consumers

`packages/scorm-runtime/assemble.js` produces the flat set of runtime files. The authoring **Preview** serves this set live, and **export** writes the identical set into the ZIP, so preview and the shipped package run byte-identical player code. The completion/suspend engine is pure and dependency-free, so it is copied verbatim into the package (no bundler).

---

## Data model

```json
{
  "id": "ascend-ae-install-ride-along",
  "title": "AE Install Ride-Along Observation Workbook",
  "version": "1.1",
  "settings": {
    "language": "en-US",
    "navigation": "free",
    "completionRule": "all-required-sections",
    "reportSuccess": false,
    "dashboardHeading": "Your observation workbook"
  },
  "sections": [
    { "id": "s1", "title": "Install Team Meeting", "required": true,
      "questions": [
        { "id": "q1", "type": "checklist", "prompt": "Which topics were covered?", "required": true,
          "options": [
            { "id": "o1", "label": "Scope review", "expected": true },
            { "id": "o2", "label": "Schedule" }
          ] },
        { "id": "q2", "type": "numeric", "prompt": "How many jobs did you review?",
          "required": true, "min": 4, "integerOnly": true },
        { "id": "q3", "type": "url", "prompt": "Link to your notes", "required": false }
      ] }
  ]
}
```

Learner state (persisted compactly to `cmi.suspend_data`, cursor mirrored to `cmi.location` as `sectionId:page`):

```json
{ "currentSection": "s2", "currentPage": 3,
  "responses": { "q1": ["o1"], "q2": "6", "q3": "https://..." },
  "sectionStatus": { "s1": "completed", "s2": "partially_complete", "s3": "not_started" } }
```

Suspend data stores **ids and response values only** - never prompt or section text - to respect the SCORM 2004 capacity (>= 64000 chars). The Publish screen estimates worst-case usage and warns before the limit.

### Question types

`short_text`, `long_text`, `yes_no`, `numeric`, `url`, `rating` (1-5 or Low/Medium/High), `checklist`, `single_select`, `multiple_select`, `datetime`, `acknowledgement`, and `evidence_ref` (records file **metadata only**; never stores a binary in SCORM).

---

## Excel import

Download **`template.xlsx`** from the Library screen (or `npm run build:template`). Sheets: Instructions, Settings, Sections, Questions.

- **Settings** supports a `Dashboard Heading` key for the learner-facing section-list heading.
- **Questions** columns: `Section ID`, `Type`, `Prompt`, `Required`, `Options`, `Rating Scale`, `Min`, `Max`, `Whole Numbers`, `Help Text`.
- Mark an **expected** option by prefixing it with `*`, for example `Scope review | *Safety plan | Schedule`. The asterisk is stripped from the visible label.

Columns are matched **by header name**, not position, so templates authored against an earlier column set still import cleanly (a regression test covers this).

---

## Uploading to Workday Learning

1. Publish -> **Build SCORM ZIP**.
2. In Workday Learning, create a lesson and upload the ZIP as **SCORM 2004** content.
3. Configure the lesson to track completion. The SCO reports completion + progress automatically.
4. **Recommended:** run the package through the **ADL SCORM 2004 4th Edition Test Suite** before wide release.

---

## Tests

```bash
npm test    # 51 tests
```

Coverage highlights:

- **`tests/engine.test.js`** - the three-state response model, expected-option gating (including that hints never leak expected labels), numeric inclusive bounds / whole numbers / zero handling, url validation, section rollup to Partially Complete, question-level progress, linear-nav gating, and validation rules.
- **`tests/mock-lms-suspend-resume.test.js`** - drives the real `SessionCore` against `MockLMS`: partial responses survive suspend/resume and still block completion; progress advances per question.
- **`tests/player-dom.test.js`** - renders the real `player.js` against a fake DOM: configurable heading (set, unset, blank), partial hints for checklist/numeric/url, url preview attributes, expected options not visually marked, resume lands on the dashboard, and every question type renders.
- **`tests/export.test.js`** - package structure, manifest, xlsx round-trip of `*` markers and numeric bounds, legacy-template compatibility, and an explicit assertion that the facilitator CSV feature is fully removed.

### End-to-end tests (Playwright)

`tests/e2e/learner.spec.js` drives the runtime in a real browser through the mock-LMS harness, covering the expected-checklist and numeric-bound gating, exit + resume, url validation, and the custom heading. Playwright is not bundled:

```bash
npm i -D @playwright/test
npx playwright install chromium
npm run test:e2e
```

---

## Tech stack

- **Authoring runtime:** Node.js >= 20, built-in `node:http` (no framework).
- **Authoring UI:** zero-build vanilla ES modules + CSS.
- **Workbook runtime:** vanilla JS ES modules; the same `player.js` for preview and export.
- **SCORM:** custom `API_1484_11` adapter; custom SCORM 2004 4th Edition `manifest.js`.
- **Packaging / xlsx:** `jszip`. **Ids:** `nanoid`. No other runtime dependencies; the exported package bundles no third-party code.
- **Types:** JSDoc + `// @ts-check`, `tsc --noEmit`.

**Production target (designed for, not built):** Express/Fastify backend, React + TypeScript UI, Prisma + SQLite/PostgreSQL. Business logic sits behind clear package seams so it can move without touching workbook-state, SCORM, validation, packaging, or import code.

## cmi5 forward compatibility

The authored workbook JSON keeps prompts/options out of suspend data and treats evidence as metadata only, so the same content can later publish to cmi5 without re-authoring. `export-service` uses an export-target abstraction; `packages/export-service/targets/cmi5.js` documents the planned target. It is intentionally not registered in the MVP.
