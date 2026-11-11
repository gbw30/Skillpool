# Front-end revamp spec

Status: approved 2026-11-10. Landing section revised 2026-11-11 at the owner's request.
All four steps are done. The polish pass found three places that differ from the `better-ui`
checklist (a slight spring bounce, the landing text's entrance timing, thinner icon strokes); the
owner chose to keep all three.

## Third revision, 2026-11-11 (loading screen, credit, sample)

| Topic | Now |
|---|---|
| Loading screen | The landing page opens on a full-screen loading screen (`web/components/landing/brain-loader.tsx`): a flat drawing of the brain, about 70 points and their links, that appears band by band outwards from its middle over one second. Behind it the graph, the 3D scene's code and the fonts load, and the scene is built and drawn once unseen |
| Hand-off | When everything is ready the screen fades out. The 3D brain starts exactly where the drawing stands, at the same size, then travels and grows to its place while the text comes in piece by piece |
| How long | At least the one second the drawing takes. After 7 seconds without the graph the page shows anyway and the brain arrives when it can |
| Once per visit | Coming back to the landing page from another page skips the loading screen. The text and the brain still wait for each other, so they arrive together |
| Photosensitivity | Only slow fades and growth. Waiting longer than a second makes the drawing breathe at about a third of a cycle per second. Reduced motion: the drawing and the page fade, nothing moves |
| Nothing indexed | The hero and the graph section play on the sample graph, labelled as a sample, with people who cannot be opened |
| Credit | The original team is named in a footer at the bottom of the landing page |
| Licence | MIT for the code (`LICENSE`) |

## Second revision, 2026-11-11 (owner's review of the first landing page)

These replace the matching parts below where they differ.

| Topic | Now |
|---|---|
| Hero graph | A brain-shaped neural mesh of about 900 small glowing points (520 on a phone), built in code (`web/lib/brain.ts`). The real nodes are some of its points; on scroll they travel to their places in the real graph and the rest dissolves |
| Signals | A few slow signals run along the links. A point warms and cools over about a second. Nothing flashes: brightness is low and no change is abrupt (the owner raised photosensitivity) |
| Hero text | The headline is the question itself, "Who here has used X?", cycling through real skills from the index. The scene traces skill, project and person, and the answer is spelled out in chips. A question box hands off to `/search?q=` |
| Motion | Motion (motion.dev) springs for the page; exact closed-form springs (`web/lib/spring.ts`) inside the 3D scene; the same spring sampled as a CSS easing for small state changes |
| Background | Site-wide: a faint wall of resumes and reports, with a soft light that follows the pointer and shows the matching line on each page it passes |
| Light theme | Softer: a grey-green page (`#dfe4de`) instead of near-white, every pair still at WCAG AA |
| Scrollbar | Slim, in the page's colours |
| Graph view | Zoom with the buttons or Ctrl + scroll (towards the pointer), drag to move, Shift + drag to turn, Reset. Zooming spreads nodes faster than it enlarges them |
| Window sizes | Two landing layouts, switching at 1024px: text beside the brain, or text over the dimmed brain. Type scales with its column. No sideways scroll from 360px to 1920px on any screen |
| Add documents | Rebuilt: drop zone (folders too), the batch drawn as tiles grouped by folder with type and state, a bar of shares by type and by status, and a three-step indicator |
| Person | Rebuilt in the new look (step 2 is done) |
| Sample data | Mock mode's graph covers projects from across a business (sales, finance, design, people, operations, support, engineering) |
| Libraries | Added `motion`. Not added: anime.js (does the same job as Motion), and the Kokonut UI and bklit UI component kits (not reviewed in detail; the components here are hand-built on the page's own tokens) |

## Goal

Replace SkillPool's plain look with a dark, technical one that shows the graph underneath the
answers. Same four screens (landing, search, person, upload) and the same behaviour; new visual
language, new layouts, a drawn relationship graph on each result, and an animated example on the
landing page.

## Decisions from the interview

| Topic | Decision |
|---|---|
| Direction | Technical / graph: near-black surfaces, monospace accents, the graph made visible |
| Scope | Full redesign of all four screens, including new elements (icons, drawn paths, richer landing) |
| Styling | Tailwind CSS 4 (replaces the hand-written `globals.css` rules) |
| Themes | Dark by default, with a toggle: dark, light, or follow the system |
| Accent | Signal green |
| Relationship path | A mini node-and-link graph on each person card, hand-drawn SVG, branches per project |
| Landing | A 3D graph of the indexed data beside the headline, which flies in and settles into an explorable graph view as the page scrolls (replaces the animated example first chosen) |
| 3D | Written in code with three.js, not a modelled scene |

## Defaults I chose (change any of these)

| Topic | Default | Why |
|---|---|---|
| Fonts | Geist for text, Geist Mono for labels, citations, file paths, status lines | Made for this kind of interface; loaded through `next/font`, so self-hosted with no layout shift |
| Components | Hand-built with Tailwind, in `web/components/` | The app needs buttons, inputs, cards, tags and one table; a component library would be mostly unused |
| Icons | About eight inline SVGs in one file, drawn with `currentColor` | Too few to justify an icon dependency |
| Motion | CSS only outside the landing's 3D scene, no animation library | Every other motion is a transition or a run-once sequence |
| Motion level | Moderate: result cards enter in sequence, the answer shows a caret while streaming, buttons press | Follows the jmo-workflow `better-ui` and `animate` rules |
| Citations | Hovering or focusing `[n]` in the answer highlights passage n; clicking still jumps to it | Makes the link between claim and evidence visible |
| Graph data | The service returns the path as structured data, next to the existing sentence | Drawing from a parsed display sentence would break on names that contain commas or arrows |

## Visual language

- **Colour tokens**, defined once as CSS variables and exposed to Tailwind through `@theme`:
  background, surface, raised surface, line, text, muted text, accent, accent text, danger, plus one
  colour per kind of node. Dark values are the default; light values apply under
  `data-theme="light"`, and under `data-theme="system"` when the system is light. Components use
  the tokens only, so they need no per-theme classes.
- **Dark palette (starting values):** background `#0a0d0c`, surface `#111614`, raised `#171d1a`,
  line `#232b27`, text `#e6ebe8`, muted `#8d9892`, accent `#4ade80`, danger `#f87171`.
- **Light palette (starting values):** background `#f6f8f7`, surface `#ffffff`, line `#d9e0dc`,
  text `#0f1513`, muted `#55605a`, accent `#0a7d3e`, danger `#b42318`.
- **Node kinds:** person is a green circle, project a cyan diamond, skill an amber square. Shape
  and label carry the meaning; colour is never the only signal.
- **Contrast:** every text pair meets WCAG AA (4.5:1) and input borders meet 3:1, in both themes.
  The final hex values are measured during the build and adjusted until they pass.
- **Type:** Geist 16px body; headings tight and large; Geist Mono, slightly smaller and
  uppercase-tracked, for section labels, ranks, citations, file paths, dates and status lines.
- **Surfaces:** 1px lines and flat panels, small radii (6px, 10px for outer panels). Shadows only
  on raised elements. Nested radii follow outer = inner + padding.

## Screens

### Shared frame
Header with a small three-node glyph and the SkillPool wordmark, the two navigation links, and the
theme toggle (three icon buttons, labelled for screen readers). Skip link and visible focus rings
stay.

### Landing
Headline, one line of explanation, two actions (Search people, Add documents), and one three.js
scene that plays two parts.
- **Hero:** the graph of indexed data (people as green spheres, projects as cyan diamonds, skills
  as amber cubes) turns slowly beside the headline, leans towards the pointer, and carries small
  pulses along its links.
- **Graph view:** as the page scrolls, the same graph flies in, flattens towards the viewer and
  stops. It then shows names for the busiest projects; pointing at a node lights it and its
  neighbours and names them; clicking a person opens their page; dragging turns the graph.
- **Data:** `GET /api/graph`: organisation projects, the people on them and the skills they used,
  at most 600 links of each kind. The layout is computed in the browser (`web/lib/graph.ts`).
- **No data or no service:** a placeholder shape is drawn and the text says so.
- **Without WebGL, a mouse, or sight:** the same content as a list of projects with their people
  and skills. It opens by itself when the scene cannot be drawn.
- **Reduced motion:** nothing turns or pulses, and the two views cross-fade instead of flying.
- **Loading:** see the third revision above. The scene has a `held` state, and its entrance is a
  zoom of the finished picture (a camera view offset), so the brain keeps its pose throughout.
- three.js loads only on this page (about 140 KB compressed, in its own file).

### Search
- A prompt-style question box (mono `>` glyph, large input, Search button) and the example
  questions as chips.
- A mono status line, as today's states: searching, people found and writing, done, no confident
  match, error.
- Two columns from 960px: candidates on the left, the recommendation in a sticky panel on the
  right. On a phone the recommendation comes first.
- Person card: mono rank, name (link), title, the mini graph, then the quoted passages, each with
  its `[n]`, file path and Open source button.
- While searching: placeholder cards. While writing: a caret at the end of the answer.
- No match and error keep their current wording, in restyled panels.
- Fixes the phone-width overflow found on 2026-11-10 (long file paths now wrap).

### Mini graph (`PathGraph`)
- Three columns: the person on the left, projects in the middle, skills on the right. Curved links
  from person to each project (worked on) and from project to each skill (used). A skill the person
  holds directly (a matched skill) links straight from the person and shows its level.
- A skill used by two projects is one node with two links. At most three projects (the service's
  existing limit) and six skills, then "+n more".
- Plain SVG rendered by React, sized by `viewBox` so it scales with the card; long labels are
  shortened with the full text in a tooltip.
- A person matched by text alone has no graph.
- Accessible name: the existing path sentences ("Brenda Adams → worked on → Atlas Migration → used
  → Kafka"), so screen readers get the same information.

### Person
Header block with name, title and aliases as mono chips; the "may be the same person" notice.
Three panels: skills (tags with a three-step level meter), roles and education (list with mono
dates), projects (with collaborator links). Then the evidence list, the same component as on
search.

### Upload
Access code field, a framed picker area with the two existing buttons (folder, files), the ready
and skipped summary, and a progress bar while files upload. The batch table gets a status marker
per row (dot plus label: queued, processing, ingested, failed) and the failure reason.

## Motion rules (from `better-ui` and `animate`)
- Result cards enter 100ms apart: opacity, 4px blur, 12px rise, 300ms, ease-out.
- Buttons scale to 0.96 on press over 150ms; disabled buttons do not.
- Hover styling only on devices that hover. No animation on typing or other frequent actions.
- Movement, scale and blur run only when the visitor has not asked for reduced motion; otherwise
  an opacity fade.
- Transitions are switched off for the instant the theme changes.

## Technical changes

| Area | Change |
|---|---|
| `web/package.json` | Add `tailwindcss` and `@tailwindcss/postcss` (dev), `three` and its types for the landing page |
| `web/components/landing/`, `web/lib/graph.ts` | New: the 3D scene, the landing page, graph layout and sample data |
| `service/skillpool/graph.py`, `api.py` | New `GET /graph` from three fixed queries (`overview`), with a test |
| `web/postcss.config.mjs` | New: the Tailwind PostCSS plugin |
| `web/app/globals.css` | Rewritten: Tailwind import, tokens in `@theme`, theme switching, base styles, keyframes |
| `web/app/layout.tsx` | Fonts, header, theme toggle, and a tiny inline script that applies the saved theme before first paint |
| `web/components/` | New: `PathGraph`, `EvidenceList`, `ThemeToggle`, `icons`, small shared pieces |
| `web/app/**/page.tsx` | All four pages restyled and re-laid-out; logic and requests unchanged |
| `service/skillpool/search/retrieve.py` | Each person in the results also carries `links: [{project, skills[]}]`; `paths` stays |
| `service/tests/test_integration.py` | Assert `links` beside the existing `paths` assertion |
| `web/lib/api.ts`, `web/lib/mock.ts` | Type and canned data for `links` |
| `README.md`, `docs/SPEC.md`, `CLAUDE.md` | Note Tailwind, the theme toggle and the `links` field |

Unchanged: the signed proxy, request signing, the upload flow, answer validation, and the rule that
model output is never rendered as HTML.

## Out of scope
- One graph for a search's result set. (The landing page's graph of indexed data is in scope: PRD R22.)
- The stats view (PRD R21), drag-and-drop upload, and any new behaviour beyond citation highlight.
- Component, icon or animation libraries. three.js is the one drawing library, for the landing page.

## Order of work
1. **Foundations and search.** Tailwind, tokens, fonts, header, theme toggle, `links` in the
   service and mock, `PathGraph`, the search screen. Checkpoint: screenshots at desktop and phone
   width in both themes, for the owner to approve the look before the rest is built.
2. **Person and upload screens.**
3. **Landing with the 3D graph and graph view.** Built before step 2 at the owner's request.
4. **Polish pass** against the `better-ui` checklist, then docs.

## How it is checked
- `cd web && npm run lint && npm run build`.
- `cd service && uv run pytest` (with the Neo4j test variables for the pipeline tests).
- Every screen and state in headless Chromium through `npm run dev:mock`, at 1280px and 390px,
  dark and light: no horizontal scroll, no page errors.
- Contrast of every token pair computed against WCAG AA.
- Reduced motion: the landing example and result entrance fall back to a fade.
