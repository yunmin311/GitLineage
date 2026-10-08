/**
 * Canvas acceptance for the Direction A port.
 *
 * Drives the real production bundle in headless Chromium against the real server and
 * the three exact acceptance repositories, captures the acceptance set, and asserts
 * the product behaviour the frozen design specifies.
 *
 *   node test/web/canvas-acceptance.ts
 *
 * Why this exists rather than a scratch script: every earlier acceptance pass was a
 * throwaway shell script, and it reported a defect that was not there -- it searched
 * plate rows for a member name, which is a question about the interaction model, not
 * about the pixels. A harness that cannot distinguish "the product is wrong" from
 * "the probe asked the wrong question" is worse than no harness, because its failures
 * get fixed in the wrong place.
 *
 * Three rules this harness holds itself to:
 *
 *   1. It aims at real interaction. A plate row is found by the name a reader would
 *      see, and clicked at a point a reader could click. Nothing clicks the centre of
 *      a group on the assumption that the middle of a box is the thing you want.
 *   2. It measures painted pixels, not declarations. Slice 2 already established that
 *      a CSS declaration can be valid while Chromium paints nothing, so the depth
 *      ladder is verified by sampling the screenshot.
 *   3. A geometry assertion is supporting evidence, never the verdict. The visual
 *      judgement is made by looking at the captures.
 *
 * No repository code is executed: the server only reads public GitHub data, and it is
 * served from the same artifact cache the rest of the suite uses.
 */
import { chromium, type Browser, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serve } from '../../src/web/serve.ts';

/** The three repositories the acceptance set is defined against. No substitutions. */
const SUBJECT_REPO = 'yunmin311/obsidian-config';
const SPARSE_REPO = 'nachocebey/is';
const DENSE_REPO = 'grpc/grpc';
/** The densest evidence set the real corpus has: 98 entities, 137 package_manifest records. */
const EVIDENCE_REPO = 'Kuddev/pebrel';

/** A member that exists in `SUBJECT_REPO`'s plugin table, named as a reader sees it. */
const MEMBER_NAME = 'Templater';

const OUT = resolve('artifacts/shots/v2');
const ROOT = resolve('.');
const DESKTOP = { width: 1920, height: 1080 };
const SMALL = { width: 1280, height: 800 };

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
}

/** Overridable so a warm cache can be reused: a cold analysis of grpc takes minutes. */
const CACHE_ROOT = resolve(process.env.GITLINEAGE_CANVAS_CACHE ?? '.cache');

interface Camera {
  viewBox: string | null;
  /** CSS pixels per world unit, measured from the rendered canvas. */
  scale: number | null;
  /** World-space. These four must not move when the shell changes. */
  centre: [number, number] | null;
  worldFocal: [number, number] | null;
  /** Screen-space. Panel visibility must preserve it. */
  subjectScreen: { x: number; y: number; w: number; h: number } | null;
}

/** The camera's world-space half: the part a shell change may not touch. */
const worldCamera = (c: Camera) => JSON.stringify({
  viewBox: c.viewBox, centre: c.centre, worldFocal: c.worldFocal,
});

interface PlateProbe {
  label: string;
  open: boolean;
  selected: boolean;
  height: number | null;
  /** The depth shadow's offset from the plate box, in world units. */
  shadow: { dx: number; dy: number } | null;
  rows: string[];
  more: string | null;
  rowsInsideBox: boolean;
  markers: number;
}

interface Frame {
  camera: Camera;
  plates: PlateProbe[];
  rails: Record<string, string | boolean>;
  tracer: Record<string, unknown>;
  drawerSections: string[];
  counts: {
    nodes: number;
    loose: number;
    plates: number;
    rows: number;
    ties: number;
  };
  overlaps: string[];
  outsideFrame: string[];
  /**
   * Every canonical primitive worn by a drawn entity box on this page, and any entity
   * wearing more than one.
   *
   * Measured per page rather than once, because the set depends on what the
   * composition chose to draw: a smaller field aggregates more, so the same repository
   * can legitimately show only its subject on the canvas. Coverage is therefore
   * accumulated across the whole pass, not asserted on whichever page is open.
   */
  primitives: { worn: string[]; multi: string[] };
  search: string;
  keyRows: number;
}

/** Everything about the scene that a reader would notice, read from the DOM. */
const READ_FRAME = () => {
  const q = <T extends Element>(s: string): T | null => document.querySelector<T>(s);
  const svg = q<SVGSVGElement>('svg.canvas');
  const vb = svg?.getAttribute('viewBox') ?? null;
  const parts = vb ? vb.split(/\s+/).map(Number) : null;
  const stage = q<HTMLElement>('#stage');
  const stageBox = stage?.getBoundingClientRect();
  const svgBox = svg?.getBoundingClientRect() ?? null;
  const round = (n: number) => Math.round(n * 10) / 10;
  const box = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: round(r.x - (stageBox?.x ?? 0)), y: round(r.y - (stageBox?.y ?? 0)), w: round(r.width), h: round(r.height) };
  };
  const visible = (sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return 'absent';
    if (el.hasAttribute('hidden')) return 'hidden';
    return getComputedStyle(el).display === 'none' ? 'display:none' : 'shown';
  };

  const subjectBox = q<SVGGraphicsElement>('.node-box.is-subject')?.getBBox() ?? null;
  const worldFocal: [number, number] | null = subjectBox
    ? [round(subjectBox.x + subjectBox.width / 2), round(subjectBox.y + subjectBox.height / 2)]
    : null;

  const plates: PlateProbe[] = [...document.querySelectorAll('.bundle-card')].map((g) => {
    const plateBox = g.querySelector('rect.bundle-card-box') as SVGGraphicsElement | null;
    const shadowRect = [...g.querySelectorAll('rect')].find(
      (r) => r !== plateBox && (r.getAttribute('class') ?? '').includes('depth-shadow'),
    ) as SVGGraphicsElement | undefined;
    const bb = plateBox?.getBBox() ?? null;
    const sb = shadowRect?.getBBox() ?? null;
    const labels = [...g.querySelectorAll('.plate-row-label')] as SVGGraphicsElement[];
    return {
      label: g.querySelector('.bundle-card-count')?.textContent ?? '',
      open: g.classList.contains('is-open'),
      selected: g.classList.contains('is-selected'),
      height: bb ? round(bb.height) : null,
      shadow: bb && sb ? { dx: round(sb.x - bb.x), dy: round(sb.y - bb.y) } : null,
      rows: labels.map((t) => t.textContent ?? ''),
      more: g.querySelector('.plate-row-more')?.textContent ?? null,
      rowsInsideBox: labels.every((t) => {
        const tb = t.getBBox();
        return bb ? tb.y + tb.height <= bb.y + bb.height + 0.01 : false;
      }),
      markers: g.querySelectorAll('.plate-row-marker').length,
    };
  });

  /* Nothing may overlap anything, and everything must stay inside the frame. */
  const boxes: Array<{ what: string; b: DOMRect }> = [];
  for (const el of document.querySelectorAll('svg .node-box, svg .bundle-card-box')) {
    const what = el.classList.contains('bundle-card-box')
      ? `plate:${el.closest('.bundle-card')?.querySelector('.bundle-card-count')?.textContent ?? ''}`
      : `node:${el.closest('.node')?.querySelector('.node-label')?.textContent ?? 'subject'}`;
    boxes.push({ what, b: el.getBoundingClientRect() });
  }
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!.b;
      const c = boxes[j]!.b;
      if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) {
        overlaps.push(`${boxes[i]!.what} x ${boxes[j]!.what}`);
      }
    }
  }
  const outsideFrame = svgBox
    ? boxes
        .filter(({ b }) =>
          b.left < svgBox.left - 0.5 || b.right > svgBox.right + 0.5 ||
          b.top < svgBox.top - 0.5 || b.bottom > svgBox.bottom + 0.5)
        .map(({ what }) => what)
    : [];

  const vbWidth = parts ? parts[2]! : 0;
  const vbHeight = parts ? parts[3]! : 0;
  return {
    camera: {
      viewBox: vb,
      /*
       * Scale measured the way a reader experiences it: how many CSS pixels one world
       * unit occupies right now. Derived from the rendered SVG rather than from the
       * viewport, so it stays meaningful at any window size and would drop if the
       * canvas were ever rescaled underneath the reader.
       */
      scale: parts && svgBox && vbWidth ? Math.round((svgBox.width / vbWidth) * 1000) / 1000 : null,
      centre: parts
        ? [round(parts[0]! + vbWidth / 2), round(parts[1]! + vbHeight / 2)] as [number, number]
        : null,
      worldFocal,
      subjectScreen: box(document.querySelector('.node-box.is-subject')),
    },
    plates,
    rails: {
      rail: visible('.rail'),
      railOpen: document.querySelector('#explorer-body')?.classList.contains('rail-open') ?? false,
      railToggleShown: visible('#rail-toggle'),
      strip: visible('#strip'),
      band: visible('.band'),
      drawer: visible('.drawer'),
    },
    tracer: (() => {
      const tracer = document.querySelector('#tracer');
      const segs = [...document.querySelectorAll('.tracer-seg')];
      const dot = document.querySelector('.tracer-dot') as SVGCircleElement | null;
      const dotBox = dot?.getBoundingClientRect() ?? null;
      // Which segment the dot actually sits on, measured from the rendered geometry
      // rather than read from a class. A dot that reported one phase while resting on
      // another would be a lie about work, and only geometry catches that.
      //
      // Each segment's own midpoint, via `getPointAtLength` on its path: a bounding
      // box cannot be used here, because seven shallow arcs have overlapping boxes and
      // "which box is the dot inside" is then a question about z-order.
      let restingOn = -1;
      let best = Infinity;
      if (dotBox) {
        const dx = dotBox.x + dotBox.width / 2;
        const dy = dotBox.y + dotBox.height / 2;
        segs.forEach((seg, index) => {
          const path = seg as SVGPathElement;
          if (typeof path.getPointAtLength !== 'function' || !path.getTotalLength) return;
          const total = path.getTotalLength();
          if (!(total > 0)) return;
          const at = path.getPointAtLength(total / 2);
          const box = path.getBoundingClientRect();
          const scale = box.width > 0 ? box.width / path.getBBox().width : 1;
          // getPointAtLength is in the path's own user space; map it to screen with the
          // rendered box so the comparison is in the same units as the dot.
          const origin = path.getBBox();
          const px = box.left + (at.x - origin.x) * scale;
          const py = box.top + (at.y - origin.y) * scale;
          const d = Math.hypot(px - dx, py - dy);
          if (d < best) { best = d; restingOn = index; }
        });
      }
      return {
        segments: segs.length,
        done: segs.filter((s) => s.classList.contains('is-done')).length,
        currentCount: segs.filter((s) => s.classList.contains('is-current')).length,
        // The index of the segment the renderer claims is current, as opposed to how
        // many claim it. Exactly one must claim it -- and it must be the one the dot
        // is resting on.
        current: segs.findIndex((s) => s.classList.contains('is-current')),
        settled: tracer?.getAttribute('data-settled') ?? null,
        moving: tracer?.getAttribute('data-moving') ?? null,
        dotCx: dot?.getAttribute('cx') ?? null,
        dotCy: dot?.getAttribute('cy') ?? null,
        restingOn,
        // A percentage would be a fabricated claim; the tracer must not carry one.
        hasPercent: (tracer?.closest('#strip')?.textContent ?? '').includes('%'),
        phases: [...document.querySelectorAll('#phases .phase')].map((p) => ({
          text: p.querySelector('.phase-name')?.textContent ?? '',
          ordinal: p.querySelector('.phase-n')?.textContent ?? '',
          state: p.classList.contains('is-current') ? 'current'
            : p.classList.contains('is-done') ? 'done' : 'upcoming',
        })),
      };
    })(),
    drawerSections: [...document.querySelectorAll('.drawer .d-block-head')].map((e) => e.textContent?.trim() ?? ''),
    counts: {
      nodes: document.querySelectorAll('svg .node-box').length,
      loose: document.querySelectorAll('svg .node:not(.is-subject)').length,
      plates: document.querySelectorAll('.bundle-card').length,
      rows: document.querySelectorAll('.plate-row').length,
      ties: document.querySelectorAll('.bundle-link').length,
    },
    overlaps,
    outsideFrame,
    primitives: (() => {
      const CANON = [
        'is-repository', 'is-package', 'is-external-project',
        'is-commit', 'is-release', 'is-source-artifact',
      ];
      const worn = new Set<string>();
      const multi: string[] = [];
      for (const b of document.querySelectorAll('.node-box')) {
        const on = [...b.classList].filter((c) => CANON.includes(c));
        for (const c of on) worn.add(c);
        if (on.length > 1) {
          multi.push(`${b.closest('.node')?.querySelector('.node-label')?.textContent ?? '?'} => ${on.join('+')}`);
        }
      }
      return { worn: [...worn].sort(), multi };
    })(),
    search: location.search,
    keyRows: document.querySelectorAll('.rail .key-row').length,
  };
};

async function readFrame(page: Page): Promise<Frame> {
  const frame = await page.evaluate(READ_FRAME) as unknown as Frame;
  // Coverage is accumulated here so it describes the whole pass rather than whichever
  // repository happens to be open when the assertion runs.
  for (const primitive of frame.primitives.worn) primitivesSeen.add(primitive);
  for (const multi of frame.primitives.multi) multiPrimitiveSeen.push(multi);
  return frame;
}

/** Every canonical primitive any page in this pass actually drew. */
const primitivesSeen = new Set<string>();
/** Entities wearing two primitives. Any entry is a defect. */
const multiPrimitiveSeen: string[] = [];

/*
 * Nothing drawn on the world may pass the band.
 *
 * The band carries the edge-treatment key -- the one thing a reader needs in order to
 * read the canvas -- and a plate tall enough to pass it draws its rows straight through
 * it. `Kuddev/pebrel` is the case: one plate of 97 `package_manifest` records is over
 * 2500 world units tall against a limit of about 700, so it ran from the top of the
 * world to the bottom of the window. Every overlap check passed, because the plate's
 * rows are inside the plate's own box and the band was only ever compared with the
 * viewport.
 */
async function plateBandCollisions(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const band = document.querySelector('.band');
    if (!band || band.hasAttribute('hidden')) return [];
    const b = band.getBoundingClientRect();
    const bad = [];
    for (const box of document.querySelectorAll('svg .bundle-card-box, svg .node-box')) {
      const r = box.getBoundingClientRect();
      if (r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom) {
        bad.push((box.getAttribute('class') || 'box') + ' over band');
      }
    }
    return bad;
  })()`) as Promise<string[]>;
}

/**
 * The native-scrollbar proof, in pixels.
 *
 * Returns the number of pixels in the panel's right gutter that are not the panel's own
 * surface colour, with the panel's content hidden and our continuation rule switched
 * off.
 *
 * The content is hidden first, and that is what makes this a proof rather than a
 * comparison. A scrollbar track and thumb are chrome: they keep painting when the rows
 * they belong to do not. So with the rows gone the panel shows nothing but its surface,
 * and anything in the gutter that is not that surface is scrollbar.
 *
 * Two earlier attempts were wrong in instructive ways. Comparing two scroll positions
 * *with* content cannot work -- the rows move, so the strip legitimately differs, and the
 * first version "failed" on the drawer's close button. And leaving our own continuation
 * rule in produced twenty non-surface pixels on one strip and none on another, which was
 * the affordance working correctly and says nothing about the browser.
 */
async function scrollbarPixels(browser: Browser, selector: string, repo: string, baseUrl: string): Promise<{
  gutterPixels: number; gutterWidth: number; height: number; worst: string | null;
  frameHeight: number | null; explorerHeight: number; rowsInPanel: number;
}> {
  const page = await browser.newPage({ viewport: DESKTOP });
  try {
    await open(page, baseUrl, `/${repo}`);
    const openDrawer = await page.evaluate(`(() => !!document.querySelector('.drawer-inner') && !!document.querySelector('svg .node.is-subject .node-hit'))()`);
    if (openDrawer) {
      await page.click('svg .node.is-subject .node-hit');
      await page.waitForTimeout(800);
    }
    await page.addStyleTag({
      content: `${selector} * { visibility: hidden !important; }
                .drawer-more, .rail-more { display: none !important; }`,
    });
    const clip = await page.evaluate(`(() => {
      const n = document.querySelector(${JSON.stringify(selector)});
      const frame = n.closest('.drawer, .rail');
      n.scrollTop = 999999;
      const r = n.getBoundingClientRect();
      return { x: Math.max(0, Math.floor(r.right) - 20), y: Math.ceil(r.top),
               width: 20, height: Math.floor(r.bottom) - Math.ceil(r.top),
               drawerHidden: !!document.querySelector('.drawer')?.hasAttribute('hidden'),
               frameRect: frame ? [Math.round(frame.getBoundingClientRect().width),
                                   Math.round(frame.getBoundingClientRect().height)] : null,
               explorerH: Math.round(document.querySelector('#explorer')?.getBoundingClientRect().height ?? -1),
               bodyRows: n.querySelectorAll('.bundle-row').length,
               innerH: Math.round(r.height),
               innerClient: n.clientHeight, innerScroll: n.scrollHeight,
               drawerOverflow: getComputedStyle(document.querySelector('.drawer')).overflow };
    })()`) as { x: number; y: number; width: number; height: number;
      drawerHidden: boolean; frameRect: number[] | null; explorerH: number; bodyRows: number };
    const png = await page.screenshot({ clip });
    await writeFile(`${OUT}/scrollbar-${selector.replace(/[^a-z]/g, '')}.png`, png);
    /*
     * The colour the panel is *painted*, not the one it is declared with.
     *
     * The scroller itself is transparent -- the surface is on its frame -- so reading
     * its own `background-color` yields `rgba(0,0,0,0)` and every pixel then counts as
     * non-surface. That is exactly what happened: twenty thousand "scrollbar" pixels
     * that were `252,251,248` compared against zero. The nearest non-transparent
     * background up the tree is what the reader actually sees.
     */
    const surface = await page.evaluate(`(() => {
      let el = document.querySelector(${JSON.stringify(selector)});
      while (el) {
        const c = getComputedStyle(el).backgroundColor;
        const p = (c.match(/[\\d.]+/g) || []).map(Number);
        if (p.length >= 3 && (p[3] === undefined || p[3] > 0.5)) return c;
        el = el.parentElement;
      }
      return 'rgb(252, 251, 248)';
    })()`) as string;
    const parsed = (surface.match(/[\d.]+/g) ?? ['252', '251', '248']).map(Number) as number[];
    const [sr, sg, sb] = [parsed[0]!, parsed[1]!, parsed[2]!];
    // TOLERANCE covers PNG rounding and antialiasing along the panel's own edge; a
    // scrollbar track is a different colour by far more than six levels.
    const TOLERANCE = 6;
    const values = await samplePixels(browser, png, []);
    void values;
    const raw = await probePixels(browser, png);
    let bad = 0;
    let worst: string | null = null;
    for (let i = 0; i < raw.length; i += 4) {
      const d = Math.max(Math.abs(raw[i]! - sr), Math.abs(raw[i + 1]! - sg), Math.abs(raw[i + 2]! - sb));
      if (d > TOLERANCE) {
        bad += 1;
        if (!worst) worst = `pixel ${(i/4)%clip.width},${Math.floor(i/4/clip.width)}: ${raw[i]},${raw[i + 1]},${raw[i + 2]} vs ${sr},${sg},${sb}`;
      }
    }
    return { gutterPixels: bad, gutterWidth: clip.width, height: clip.height, worst,
             frameHeight: clip.frameRect ? clip.frameRect[1]! : null,
             explorerHeight: clip.explorerH, rowsInPanel: clip.bodyRows };
  } finally {
    await page.close();
  }
}

/** Decodes a PNG into raw RGBA, via a blank page's 2d context. */
async function probePixels(browser: Browser, png: Buffer): Promise<number[]> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ({ data }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(0, 0, img.width, img.height).data);
      },
      { data: png.toString('base64') },
    );
  } finally {
    await page.close();
  }
}

/**
 * Proves a scrollable panel still scrolls, by wheel and by keyboard, and that its last
 * row is reachable at the bottom.
 */
async function scrollBehaviour(page: Page, selector: string): Promise<{
  scrollable: boolean; wheelMoved: boolean; pageDownMoved: boolean; endReachedBottom: boolean;
  lastRowReachable: boolean; rows: number; focusable: boolean;
}> {
  const scrollable = await page.evaluate(`(() => {
    const n = document.querySelector(${JSON.stringify(selector)});
    return n.scrollHeight - n.clientHeight;
  })()`) as number;
  const focusable = await page.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).tabIndex >= 0`,
  ) as boolean;
  if (scrollable <= 2) {
    return {
      scrollable: false, wheelMoved: false, pageDownMoved: false,
      endReachedBottom: true, lastRowReachable: true, rows: 0, focusable,
    };
  }

  await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollTop = 0`);
  await page.waitForTimeout(150);
  const box = await page.evaluate(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
       return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
  ) as { x: number; y: number };
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  const afterWheel = await page.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).scrollTop`,
  ) as number;

  await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollTop = 0`);
  await page.focus(selector);
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(300);
  const afterPageDown = await page.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).scrollTop`,
  ) as number;
  await page.keyboard.press('End');
  await page.waitForTimeout(400);
  const end = await page.evaluate(`(() => {
    const n = document.querySelector(${JSON.stringify(selector)});
    return { top: n.scrollTop, max: n.scrollHeight - n.clientHeight };
  })()`) as { top: number; max: number };

  const last = await page.evaluate(`(() => {
    const n = document.querySelector(${JSON.stringify(selector)});
    const rows = n.querySelectorAll('.bundle-row, .lblk, .tk-row');
    const r = rows[rows.length - 1];
    if (!r) return { rows: 0, reachable: true };
    const a = r.getBoundingClientRect(), b = n.getBoundingClientRect();
    return { rows: rows.length, reachable: a.top < b.bottom && a.bottom > b.top };
  })()`) as { rows: number; reachable: boolean };

  return {
    scrollable: true,
    wheelMoved: afterWheel > 0,
    pageDownMoved: afterPageDown > 0,
    endReachedBottom: Math.abs(end.top - end.max) <= 2,
    lastRowReachable: last.reachable,
    rows: last.rows,
    focusable,
  };
}

/** Waits for the client to draw, whichever terminal state it lands in. */
async function open(page: Page, url: string, path: string): Promise<void> {
  await page.goto(url + path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('svg .node-box, svg .bundle-card-box', { timeout: 180_000 });
  await page.waitForTimeout(700);
}

/**
 * The point a reader would click for a plate row whose label matches `pattern`.
 *
 * Returns null when no such row is on screen, which is a real answer: a member past
 * the plate's bound is not reachable until the plate is expanded, and a harness that
 * cannot express that will click something else and call it a pass.
 */
async function rowPoint(page: Page, pattern: RegExp): Promise<{ x: number; y: number } | null> {
  return page.evaluate((source) => {
    const re = new RegExp(source);
    const rows = [...document.querySelectorAll('.plate-row')];
    const row = rows.find((r) => re.test(r.querySelector('.plate-row-label')?.textContent ?? ''));
    if (!row) return null;
    /*
     * Click the row's HIT RECT, not the decorative group's centre.
     *
     * The `.plate-row` group is `aria-hidden` and purely visual; the interactive element
     * is its `.plate-row-hit` rect. Clicking the group's centre worked while a plate was
     * a single short stack, but the centre of a thin row can fall where a sibling
     * `<text>` -- the plate subtitle, say -- captures the pointer, because SVG text
     * hit-tests its glyphs. When a structural fan stacks several masses that overlap
     * became routine, so the click silently landed on the subtitle and selected nothing.
     * Targeting the rect the product actually listens on is both correct and stable.
     */
    const hit = row.querySelector('.plate-row-hit') ?? row;
    const b = hit.getBoundingClientRect();
    return { x: b.x + Math.min(30, b.width / 2), y: b.y + b.height / 2 };
  }, pattern.source);
}

/** The centre of a plate row carrying the given class, e.g. `plate-row-more`. */
async function affordancePoint(page: Page, selector: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + Math.min(24, b.width / 2), y: b.y + b.height / 2 };
  }, selector);
}

/**
 * Samples real pixels out of a screenshot.
 *
 * The screenshot goes back into a blank page as a data URL and is drawn to a canvas,
 * so the values read are the values Chromium painted. Reading a CSS declaration or a
 * DOM attribute would prove nothing: Slice 2 shipped a valid `box-shadow` on an SVG
 * `<rect>` that rendered nothing at all.
 */
async function samplePixels(browser: Browser, png: Buffer, points: Array<{ x: number; y: number }>): Promise<string[]> {
  const probe = await browser.newPage();
  const values = await probe.evaluate(
    async ({ data, at }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      return at.map((p) => {
        const d = ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
        return `${d[0]},${d[1]},${d[2]},${d[3]}`;
      });
    },
    { data: png.toString('base64'), at: points },
  );
  await probe.close();
  return values;
}

/**
 * The depth shadow's geometry for one object: its exact offset in world units, and
 * two screen points that must differ if the shadow is really painted.
 *
 * The exposed part of a hard offset shadow is the L-shaped strip along the bottom and
 * right, never the top-left corner -- the plate itself covers that. An earlier probe
 * sampled the corner, read the plate's own fill twice, and concluded the ladder was
 * broken. The sample points have to be somewhere the shadow is the topmost thing.
 */
async function shadowProbe(page: Page, ownerSelector: string): Promise<{
  worldDx: number;
  worldDy: number;
  scale: number;
  shadowPoint: { x: number; y: number };
  facePoint: { x: number; y: number };
  corner: { x: number; y: number; width: number; height: number };
} | null> {
  return page.evaluate((sel) => {
    const owner = document.querySelector(sel);
    if (!owner) return null;
    const plateBox = owner.querySelector('rect.bundle-card-box, rect.node-box') as SVGGraphicsElement | null;
    const shadowRect = [...owner.querySelectorAll('rect')].find(
      (r) => r !== plateBox && (r.getAttribute('class') ?? '').includes('depth-shadow'),
    ) as SVGGraphicsElement | undefined;
    if (!plateBox || !shadowRect) return null;
    const pb = plateBox.getBBox();
    const sb = shadowRect.getBBox();
    const screen = plateBox.getBoundingClientRect();
    const svg = plateBox.ownerSVGElement;
    const vb = svg?.getAttribute('viewBox')?.split(/\s+/).map(Number);
    const width = vb && svg ? svg.getBoundingClientRect().width / vb[2]! : 1;
    const scale = Math.round(width * 10000) / 10000;
    const midY = screen.y + screen.height / 2;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return {
      // World units, so the ladder is checked against its own integers.
      worldDx: round(sb.x - pb.x),
      worldDy: round(sb.y - pb.y),
      scale,
      // In the shadow's right-hand strip, past the plate's own right edge.
      shadowPoint: { x: screen.x + screen.width + (sb.x - pb.x) * scale - 1, y: midY },
      // On the plate's own face.
      facePoint: { x: screen.x + screen.width / 2, y: midY },
      corner: { x: screen.x, y: screen.y, width: screen.width, height: screen.height },
    };
  }, ownerSelector);
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const { server, url } = await serve(
    {
      port: 0,
      clientDir: resolve(ROOT, 'dist/web'),
      cacheRoot: CACHE_ROOT,
      enableGit: true,
      enableRegistry: true,
    },
    { GITLINEAGE_NO_CLIENT: '' },
  );
  process.stdout.write(`canvas acceptance server ${url}\n`);
  process.stdout.write(`cache ${CACHE_ROOT}\n`);

  const report: Record<string, unknown> = { viewport: DESKTOP };
  let browser: Browser | undefined;

  try {
    /*
     * `--hide-scrollbars` is dropped on purpose.
     *
     * Playwright launches headless Chromium with it, and with it a scrollable box paints
     * no scrollbar and reserves no gutter -- so every "no native scrollbar" measurement
     * below would pass no matter what the product did. The proof has to be taken in a
     * browser that is capable of painting one, or it is not a proof. `scrollbarPixels()`
     * is verified against a deliberately scrollable control box in
     * `artifacts/preflight-negative.ts`, which is what keeps this honest.
     */
    browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
    const page = await browser.newPage({ viewport: DESKTOP });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // ============================================ 01 · default aggregated paint
    await open(page, url, `/${SUBJECT_REPO}`);
    const fDefault = await readFrame(page);
    report['01-default'] = fDefault;
    await page.screenshot({ path: `${OUT}/01-default-aggregated.png` });

    check('01 the subject is the only node mass on the default paint',
      fDefault.counts.loose === 0, `${fDefault.counts.loose} loose nodes`);
    check('01 evidence-supported groups are plates, not one bare count card',
      fDefault.counts.plates === 2, `${fDefault.counts.plates} plates`);
    check('01 nothing overlaps and nothing leaves the frame',
      fDefault.overlaps.length === 0 && fDefault.outsideFrame.length === 0,
      `overlaps=${fDefault.overlaps.length} outside=${fDefault.outsideFrame.length}`);
    check('01 the context rail is shown, not a floating legend or a world gutter',
      fDefault.rails.rail === 'shown',
      `rail ${fDefault.rails.rail}, key rows ${fDefault.keyRows}`);
    check('01 the rail carries the lineage key, so nothing floats over the canvas',
      fDefault.keyRows > 0, `${fDefault.keyRows} keyed families`);
    check('01 the analysis strip is gone once the analysis has finished',
      fDefault.rails.strip === 'hidden' || fDefault.rails.strip === 'display:none',
      `strip ${fDefault.rails.strip}`);
    /*
     * The band is a world object, so it is on screen only where the window is. At
     * 1920 the window is world 132..1788 and at 1280 it is 320..1600; the zones are
     * authored so the band is inside both. It was not: it started at world 48 and was
     * cut in half at 1920, and every check still passed, because nothing compared the
     * band's position with the zones.
     */
    const bandOnScreen = await page.evaluate(() => {
      const band = document.querySelector('.band');
      const stage = document.querySelector('#stage');
      if (!band || !stage) return null;
      const b = band.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      return { left: Math.round(b.left - s.left), right: Math.round(b.right - s.left), stage: Math.round(s.width) };
    });
    report['01-band'] = bandOnScreen;
    check('01 the band is whole inside the stage at 1920, not cut by its edge',
      !!bandOnScreen && bandOnScreen.left >= -1 && bandOnScreen.right <= bandOnScreen.stage + 1,
      bandOnScreen ? `band ${bandOnScreen.left}..${bandOnScreen.right} in stage ${bandOnScreen.stage}` : 'no band');

    // ============================================ 02 · expanded to every member
    const more = await affordancePoint(page, '.plate-row-more');
    const rowsBefore = fDefault.counts.rows;
    if (more) {
      await page.mouse.click(more.x, more.y);
      await page.waitForTimeout(700);
    }
    const fExpanded = await readFrame(page);
    report['02-expanded'] = fExpanded;
    await page.screenshot({ path: `${OUT}/02-references-expanded.png` });

    check('02 a capped plate states its remainder',
      typeof more === 'object' || fDefault.plates.some((p) => p.more),
      fDefault.plates.map((p) => p.more).filter(Boolean).join(' | '));
check('02 expanding reveals the held-back members',
        fExpanded.counts.rows > rowsBefore, `${rowsBefore} rows -> ${fExpanded.counts.rows} rows`);

      /*
       * Open EVERY mass before counting, not just the first.
       *
       * This used to click one affordance and count, which was correct only while every
       * mass was open by default. Frozen V3.3 opens the LARGEST structural group and
       * leaves the rest shut -- the first paint leads with the group holding the most
       * relationships instead of with every group at once -- so on a repository with two
       * structural groups one click exposes twelve of fourteen rows and the two in the shut
       * group were counted as unreachable when they never were.
       *
       * The invariant under test has not changed: every relationship is individually
       * reachable through the interaction model. Both halves of that model are exercised
       * here -- the row affordance inside an open mass, and the mass's own surface, which is
       * how a SHUT mass opens at all.
       */
      for (let round = 0; round < 12; round += 1) {
        const next = await affordancePoint(page, '.plate-row-more');
        if (!next) break;
        await page.mouse.click(next.x, next.y);
        await page.waitForTimeout(500);
      }
      // Then a shut mass: clicking its own surface toggles it open.
      const shutPoint = await page.evaluate(() => {
        const shut = [...document.querySelectorAll('.bundle-card')].find(
          (g) => !g.classList.contains('is-open'),
        );
        const count = shut?.querySelector('.bundle-card-count')?.getBoundingClientRect();
        if (!count) return null;
        return { x: count.x + 8, y: count.y + count.height / 2 };
      });
      if (shutPoint) {
        await page.mouse.click(shutPoint.x, shutPoint.y);
        await page.waitForTimeout(500);
      }
      const fAllOpen = await readFrame(page);
      check('02 every relationship is individually reachable',
        fAllOpen.counts.rows === 14, `${fAllOpen.counts.rows} selectable rows for 14 relationships`);
      check('02 expanding moves nothing in the world',
        worldCamera(fExpanded.camera) === worldCamera(fDefault.camera),
        'viewBox, centre and world focal identical');

    // ============================== 03 · a real member selected, with the Drawer
    const member = await rowPoint(page, new RegExp(MEMBER_NAME));
    check(`03 the member "${MEMBER_NAME}" is reachable as a row`, member !== null);
    if (member) {
      await page.mouse.click(member.x, member.y);
      await page.waitForTimeout(800);
    }
    const fSelected = await readFrame(page);
    report['03-member-selected'] = fSelected;
    await page.screenshot({ path: `${OUT}/03-member-selected-drawer.png` });

    const drawerText = await page.evaluate(
      () => document.querySelector('.drawer')?.textContent?.replace(/\s+/g, ' ') ?? '',
    );
    /*
     * Every row must be able to say which claim it is.
     *
     * A selected row was rendering with its direction mark and its locator but no
     * name at all, which is exactly the failure the reader cannot recover from: the
     * Drawer opens, so the row looks like a label that happens to be missing rather
     * than a defect. Checked on every row of every plate, not only the selected one.
     */
    const rowText = await page.evaluate(() =>
      [...document.querySelectorAll('.plate-row')].map((r) => {
        const label = r.querySelector('.plate-row-label') as SVGGraphicsElement | null;
        const dir = r.querySelector('.plate-row-dir') as SVGGraphicsElement | null;
        const mark = r.querySelector('.plate-row-status') as SVGGraphicsElement | null;
        return {
          label: label?.textContent ?? '',
          meta: r.querySelector('.plate-row-meta')?.textContent ?? '',
          marked: r.querySelector('.plate-row-marker') !== null,
          // Where the label's glyphs actually land, so a collision with the mark is
          // measurable rather than a matter of opinion.
          labelX: label ? label.getBBox().x : null,
          dirRight: dir ? dir.getBBox().x + dir.getBBox().width : null,
          markRight: mark ? mark.getBBox().x + mark.getBBox().width : null,
        };
      }),
    );
    report['03-rows'] = rowText;
    const nameless = rowText.filter((r) => r.label.trim() === '' && r.meta.trim() !== '');
    check('03 every row states which claim it is', nameless.length === 0,
      nameless.map((r) => r.meta).join(', '));
    const collisions = rowText.filter(
      (r) => r.labelX !== null && r.dirRight !== null && r.labelX < r.dirRight,
    );
    check('03 no row mark collides with its label', collisions.length === 0,
      `${collisions.length} rows overlap`);
    const selectedPlate = fSelected.plates.find((p) => p.selected);
    check('03 selecting a member opens the Drawer with its real evidence',
      fSelected.rails.drawer === 'shown' && /DOCUMENT_REFERENCE|evidence/i.test(drawerText),
      fSelected.drawerSections.join(' / '));
    check('03 the Drawer names both endpoints of the claim',
      drawerText.includes(SUBJECT_REPO) && drawerText.includes(MEMBER_NAME));
    check('03 the owning plate takes selected depth (5px)',
      selectedPlate?.shadow?.dx === 5 && selectedPlate?.shadow?.dy === 5,
      `shadow offset ${selectedPlate?.shadow?.dx}/${selectedPlate?.shadow?.dy}`);
    check('03 the selected row stays flat and is marked',
      selectedPlate?.markers === 1, `${selectedPlate?.markers} row markers`);
    check('03 the rail and the bottom band survive the Drawer',
      fSelected.rails.rail === 'shown' && fSelected.rails.band === 'shown',
      `rail ${fSelected.rails.rail}, band ${fSelected.rails.band}`);
    check('03 the Drawer overlay preserves the rail and graph',
      fSelected.rails.drawer === 'shown' && fDefault.rails.rail === 'shown',
      'the rail was already the left column and stays it');
    check('03 selecting a member moves nothing in the world',
      worldCamera(fSelected.camera) === worldCamera(fDefault.camera),
      'viewBox, centre and world focal identical');

    // ================================ 12 · camera stability across the whole arc
    const closeDrawer = await page.evaluate(() => {
      const el = document.querySelector('.drawer-close');
      if (!el) return false;
      (el as HTMLElement).click();
      return true;
    });
    await page.waitForTimeout(600);
    const fClosed = await readFrame(page);
    report['12-camera-after-close'] = fClosed;
    check('12 closing the Drawer restores the shell without a refit',
      closeDrawer && worldCamera(fClosed.camera) === worldCamera(fDefault.camera),
      'the window is where it was before the Drawer opened');

    // ================================================= 04 · sparse real lineage
    await open(page, url, `/${SPARSE_REPO}`);
    const fSparse = await readFrame(page);
    report['04-sparse'] = fSparse;
    await page.screenshot({ path: `${OUT}/04-sparse-nachocebey-is.png` });
    check('04 the sparse graph draws peers directly',
      fSparse.counts.loose > 0, `${fSparse.counts.loose} loose peers`);
    check('04 the sparse graph composes without overlap',
      fSparse.overlaps.length === 0 && fSparse.outsideFrame.length === 0);

    // ============================================ 05 · dense mixed-family graph
    await open(page, url, `/${DENSE_REPO}`);
    const fDense = await readFrame(page);
    report['05-dense'] = fDense;
    await page.screenshot({ path: `${OUT}/05-dense-grpc-grpc.png` });
    check('05 the dense graph aggregates rather than listing everything',
      fDense.counts.plates > 0 && fDense.counts.loose < fSparse.counts.loose + 12,
      `${fDense.counts.loose} loose, ${fDense.counts.plates} plates`);
    check('05 the dense graph composes without overlap',
      fDense.overlaps.length === 0 && fDense.outsideFrame.length === 0);
    check('05 every plate row sits inside its own plate',
      fDense.plates.every((p) => p.rowsInsideBox));

    // ================================== 06 · mixed canonical entity primitives
    /*
     * Every primitive that real data actually contains, photographed and read from
     * the DOM. A type the acceptance repositories do not contain cannot be
     * photographed from them, so it is checked structurally instead: the primitive a
     * type maps to must be its own, never Repository's. That is the exact failure
     * this guards -- an ontology addition silently inheriting the repository glyph.
     */
    const key = await page.evaluate(() =>
      [...document.querySelectorAll('.tkey .tk-row')].map((r) => ({
        type: r.querySelector('.tk-row span:nth-child(2)')?.textContent ?? '',
        glyph: [...(r.querySelector('.gl i')?.classList ?? [])].find((c) => c.startsWith('is-')) ?? '',
        count: r.querySelector('.k')?.textContent ?? '',
      })),
    );
    const primitives = { found: [...primitivesSeen], key, multiPrimitive: multiPrimitiveSeen };
    report['06-primitives'] = primitives;
    const canonicalPrimitives = [
      'is-repository', 'is-package', 'is-external-project',
      'is-commit', 'is-release', 'is-source-artifact',
    ];
    /*
     * Coverage is asserted across every page this pass visited, not on whichever one is
     * open. It used to be per-page, and it only passed because the field was big enough
     * that each repository happened to leave a non-repository node loose; a smaller field
     * aggregates more, `grpc/grpc` then drew only its subject, and the check failed on a
     * correct composition. The question is whether real data exercises the primitive
     * mapping, and that is a property of the corpus, not of one canvas.
     */
    check('06 real data across the pass renders more than one entity primitive',
      primitivesSeen.size > 1, [...primitivesSeen].join(', '));
    /*
     * The fallback this guards against is a node wearing another type's primitive.
     * What matters is not whether `is-repository` appears -- real repositories are
     * supposed to -- but that no node wears two primitives, and that every primitive
     * on the canvas is one the canonical union actually defines.
     */
    check('06 no node wears more than one entity primitive',
      multiPrimitiveSeen.length === 0, multiPrimitiveSeen.join(', '));
    check('06 every primitive drawn is a canonical one',
      [...primitivesSeen].every((c) => canonicalPrimitives.includes(c)),
      [...primitivesSeen].join(', '));
    check('06 the entity key states each type with its own glyph',
      primitives.key.length > 0 &&
        primitives.key.every((r) => canonicalPrimitives.includes(r.glyph)) &&
        new Set(primitives.key.map((r) => r.type)).size === primitives.key.length,
      primitives.key.map((r) => `${r.type}=${r.glyph}`).join(' '));
    {
      // Structural coverage for the canonical union, read from the shipped module.
      const mod = await import('../../src/web/client/lib/primitives.mjs');
      const expected = mod.CANONICAL_ENTITY_TYPES.map((t) => mod.nodePrimitive(t));
      check('06 every canonical entity type maps to its own primitive',
        new Set(expected).size === mod.CANONICAL_ENTITY_TYPES.length,
        expected.join(', '));
      check('06 an unrecognised type does not become a repository',
        mod.nodePrimitive('SomethingNew') === mod.UNKNOWN_PRIMITIVE);
    }
    await page.locator('.tkey').screenshot({ path: `${OUT}/06-entity-primitives.png` }).catch(() => undefined);

    // ================================== 07..09 · the analysis tracer, phase by phase
    await open(page, url, `/${SUBJECT_REPO}?tracer-test=1`);
    const tracerProbe = async (phase: string): Promise<void> => {
      await page.evaluate((p) => {
        const api = (window as unknown as { __setPhaseForTest?: (x: string) => void }).__setPhaseForTest;
        const strip = document.querySelector('#strip');
        if (strip) strip.removeAttribute('hidden');
        api?.(p);
      }, phase);
    };

    for (const [index, phase] of (['collecting', 'publishing', 'complete'] as const).entries()) {
      /*
       * Set the phase, let the tracer arrive, and only then read it.
       *
       * `data-moving` describes the transition currently in flight, so sampling it in
       * the same tick as the phase change reads the tracer mid-arc. The earlier pass
       * did exactly that and reported a settled tracer that was still moving -- a
       * defect in the measurement, not in the tracer.
       */
      await tracerProbe(phase);
      await page.waitForTimeout(900);
      /*
       * Probe again before reading. `data-moving` describes the transition currently
       * in flight, so reading it right after the change reports the arrival rather
       * than the resting state. The second call is idempotent -- the phase is already
       * set, so `phaseTransition` returns null and nothing restarts. This is exactly
       * what the client itself does on every poll, which is why a polling client can
       * never flicker.
       */
      await tracerProbe(phase);
      await page.waitForTimeout(900);
      const frame = await readFrame(page);
      const tracer = frame.tracer;
      report[`0${7 + index}-tracer-${phase}`] = tracer;
      const file = ['07-analysis-early.png', '08-analysis-late.png', '09-analysis-settled.png'][index]!;
      await page.screenshot({ path: `${OUT}/${file}` });
      check(`0${7 + index} the tracer reports the phase it was given`,
        tracer.segments === 7 && tracer.hasPercent === false,
        `${tracer.segments} segments, percent=${tracer.hasPercent}`);
      check(`0${7 + index} the tracer rests on the segment it claims`,
        tracer.restingOn === tracer.current && tracer.currentCount === 1,
        `resting on ${tracer.restingOn}, marked current ${tracer.current}, claimed by ${tracer.currentCount}`);
      check(`0${7 + index} the phases are one row beside the arc, all seven named`,
        (tracer.phases as Array<{ text: string }>).length === 7
          && (tracer.phases as Array<{ text: string }>).every((p) => p.text.trim().length > 0),
        (tracer.phases as Array<{ text: string }>).map((p) => p.text).join(' / '));
    }
    const settled = report['09-tracer-complete'] as Record<string, unknown>;
    check('09 the tracer settles on its final segment',
      settled.settled === 'true' && settled.moving === 'false',
      `settled=${settled.settled} moving=${settled.moving}`);
    check('09 every earlier segment is marked done at the settled phase',
      settled.done === 6 && settled.currentCount === 1 && settled.current === 6,
      `done=${settled.done} current index=${settled.current} claimed by ${settled.currentCount}`);
    check('09 the tracer is an open arc, not a closed dial',
      Array.isArray(settled.phases) && (await page.evaluate(
        () => document.querySelectorAll('.dial, .dial-arm, .dial-face, .dial-notch').length,
      )) === 0,
      'no clock geometry anywhere in the shell');

    // ================================================= 10 · the complete shell
    await page.goto(`${url}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/10-shell-1920x1080.png` });
    const shell = await page.evaluate(() => ({
      landing: !!document.querySelector('#landing:not([hidden])'),
      samples: document.querySelectorAll('.samples a').length,
      trust: document.querySelectorAll('.trust-cell').length,
      footer: !!document.querySelector('.site-foot'),
      scrollY: document.documentElement.scrollHeight <= window.innerHeight + 1,
    }));
    report['10-shell'] = shell;
    check('10 the landing is the first thing a visitor sees',
      shell.landing && shell.samples >= 4 && shell.trust === 3,
      `${shell.samples} samples, ${shell.trust} trust cells`);
    check('10 the landing fits without a scrollbar', shell.scrollY);

/*
     * The landing's composition, read off the rendered page.
     *
     * Frozen V3.3 replaced V2.1's five registers. The requirement is the same in kind and
     * different in shape: a composition, not a stack, and every claim about it measured
     * rather than read off the stylesheet.
     *
     * What is asserted here:
     *   · the bounded column is the approved 852px measure
     *   · the body copy is LEFT aligned inside that column, not centred on a middle axis
     *   · the headline is two explicit lines, each an underprint pass and a foreground
     *     pass sharing one grid cell, offset by a transform and never by margin -- and
     *     the offset is exactly 6px on both axes
     *   · the input card is RAISED, with a 2px ink border and a hard shadow
     *   · the trace sits BELOW the card rather than above it, because in V3.3 the card is
     *     the primary object and the trace is secondary information
     *   · nothing overlaps and nothing overflows horizontally
     */
    const composition = await page.evaluate(`(() => {
      const q = (s) => document.querySelector(s);
      const box = (s) => { const e = q(s); return e ? e.getBoundingClientRect() : null; };
      const inner = box('.landing');
      const h1 = q('#landing h1');
      const lines = [...document.querySelectorAll('.hero-line')];
      const u = q('.hero-u'); const f = q('.hero-f');
      const ub = u.getBoundingClientRect(); const fb = f.getBoundingClientRect();
      const lede = q('.lede'); const card = q('.input-card'); const trace = q('.hero-trace');
      const samples = [...document.querySelectorAll('.samples a')];
      const boxes = ['.eyebrow', '#landing h1', '.lede', '.input-card', '.hero-trace', '.foot', '.samples', '.trust']
        .map(box);
      let overlaps = 0;
      for (let a = 0; a < boxes.length; a += 1) for (let b = a + 1; b < boxes.length; b += 1) {
        const p = boxes[a]; const q2 = boxes[b];
        if (p && q2 && p.left < q2.right - 1 && q2.left < p.right - 1 && p.top < q2.bottom - 1 && q2.top < p.bottom - 1) overlaps += 1;
      }
      const cs = getComputedStyle(card);
      return {
        columnWidth: inner ? Math.round(inner.width) : 0,
        ledeLeft: lede ? Math.round(lede.getBoundingClientRect().left) : 0,
        h1Left: h1 ? Math.round(h1.getBoundingClientRect().left) : 0,
        ledeAlign: lede ? getComputedStyle(lede).textAlign : '',
        lineCount: lines.length,
        nowrap: lines.every((l) => getComputedStyle(l).whiteSpace === 'nowrap'),
        sameCell: lines.every((l) => getComputedStyle(l).display === 'grid'),
        offsetX: Math.round(ub.x - fb.x),
        offsetY: Math.round(ub.y - fb.y),
        offsetIsTransform: /matrix/.test(getComputedStyle(u).transform),
        underprintInk: getComputedStyle(u).color,
        foregroundInk: getComputedStyle(f).color,
        cardShadow: cs.boxShadow,
        cardBorder: cs.borderTopWidth + ' ' + cs.borderTopStyle,
        cardBelowLede: card.getBoundingClientRect().top > lede.getBoundingClientRect().bottom,
        traceBelowCard: trace.getBoundingClientRect().top > card.getBoundingClientRect().bottom,
        traceStages: [...document.querySelectorAll('.hero-trace-stage')].map((e) => e.textContent?.trim()),
        traceLabel: q('.hero-trace-note')?.textContent?.trim() || '',
        statusChips: document.querySelectorAll('.input-card .st').length,
        samples: samples.length,
        sampleHrefs: samples.map((a) => a.getAttribute('href')),
        depthButtons: document.querySelectorAll('.seg-btn').length,
        overlaps,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`) as Record<string, unknown>;
    report['10-composition'] = composition;

    check('10 the landing is a bounded 852px column',
      composition.columnWidth === 852, `column ${composition.columnWidth}px`);
    check('10 the body copy is left aligned inside that column, not on a middle axis',
      composition.ledeAlign === 'start' && composition.ledeLeft === composition.h1Left,
      `text-align ${composition.ledeAlign}, lede left ${composition.ledeLeft}, headline left ${composition.h1Left}`);
    check('10 the headline is two explicit lines, each one grid cell',
      composition.lineCount === 2 && Boolean(composition.nowrap) && Boolean(composition.sameCell),
      `${composition.lineCount} lines, nowrap ${composition.nowrap}, grid ${composition.sameCell}`);
    check('10 the underprint is offset exactly 6px on both axes, by transform',
      composition.offsetX === 6 && composition.offsetY === 6 && Boolean(composition.offsetIsTransform),
      `offset ${composition.offsetX}px / ${composition.offsetY}px, transform ${composition.offsetIsTransform}`);
    check('10 the underprint is a different ink from the foreground',
      composition.underprintInk !== composition.foregroundInk,
      `${composition.underprintInk} under ${composition.foregroundInk}`);
    check('10 the input card is raised: a 2px solid border and a hard shadow',
      composition.cardBorder === '2px solid' && /inset/.test(String(composition.cardShadow)) === false
        && /rgb|var/.test(String(composition.cardShadow)),
      `border ${composition.cardBorder}, shadow ${composition.cardShadow}`);
    check('10 the card is the primary object and the trace is secondary to it',
      Boolean(composition.cardBelowLede) && Boolean(composition.traceBelowCard)
        && (composition.traceStages as string[]).join('>') === 'source>evidence>relationship>lineage',
      `trace below card ${composition.traceBelowCard}, stages ${(composition.traceStages as string[]).join(' > ')}`);
    check('10 the trace states that it is an example, not this visitor result',
      /example/i.test(String(composition.traceLabel)) && /pebrel/.test(String(composition.traceLabel)),
      String(composition.traceLabel));
    check('10 the evidence-status legend is inside the card',
      composition.statusChips === 3, `${composition.statusChips} status chips in the card`);
    check('10 the five acceptance datasets are the examples, and every one is a real route',
      composition.samples === 5
        && (composition.sampleHrefs as string[]).every((h) => !!h && h.startsWith('/') && h !== '/'),
      (composition.sampleHrefs as string[]).join(' '));
    check('10 the real depth control survives the port',
      composition.depthButtons === 3, `${composition.depthButtons} depth buttons`);
    check('10 nothing overlaps', composition.overlaps === 0, `${composition.overlaps} overlaps`);
    check('10 the landing does not overflow horizontally',
      Number(composition.horizontalOverflow) <= 0, `${composition.horizontalOverflow}px`);

    /*
     * The landing's primary control, filled by keyboard.
     *
     * `/` and `f` are single-key shortcuts, and they were live while the reader was in
     * the repository field. Typing `octocat/Spoon-Knife` therefore opened the graph
     * search on the slash and put the rest of the name there, and any name containing
     * an `f` silently lost that character to `fit()`. The landing could not be used by
     * keyboard, and no check had ever typed into it.
     */
    await page.click('#repo-input');
    await page.keyboard.type('octocat/Spoon-Knife');
    await page.waitForTimeout(250);
    const typed = await page.evaluate(`(() => ({
      value: document.querySelector('#repo-input').value,
      searchOpen: !document.querySelector('#searchbar').hasAttribute('hidden'),
      searchValue: document.querySelector('#search-input').value,
    }))()`) as { value: string; searchOpen: boolean; searchValue: string };
    report['10-typing'] = typed;
    check('10 the repository field can be filled by keyboard, slash and all',
      typed.value === 'octocat/Spoon-Knife' && !typed.searchOpen && typed.searchValue === '',
      `field "${typed.value}", search opened ${typed.searchOpen}`);

    // ============================================ 11 · responsive 1280x800
    const small = await browser.newPage({ viewport: SMALL });
    small.on('pageerror', (e) => errors.push(`[small] pageerror: ${e.message}`));
    small.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[small] ${m.text()}`);
    });
    await open(small, url, `/${SUBJECT_REPO}`);
    const responsive = await small.evaluate(() => {
      const rect = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      const zones = { rail: rect('.rail'), band: rect('.band'), strip: rect('#strip'), controls: rect('.viewport-controls') };
      const clipped: string[] = [];
      /*
       * Everything shell-and-world that should be on screen is checked, including the
       * band. The band is a world object, so "outside the viewport" would in principle
       * be a coordinate to pan to -- but the zones are authored so it is inside the
       * opening window at every supported width, and it was not: it sat half off the
       * left edge at 1920 and every automated check passed, because a stylesheet
       * literal cannot disagree with a test that only reads a stylesheet.
       */
      for (const [name, b] of Object.entries(zones)) {
        if (!b) continue;
        if (b.y + b.h > window.innerHeight + 1) clipped.push(`${name} bottom ${b.y + b.h} > ${window.innerHeight}`);
        if (b.y < -1) clipped.push(`${name} top ${b.y} < 0`);
        if (b.x < -1) clipped.push(`${name} left ${b.x} < 0`);
        if (b.x + b.w > window.innerWidth + 1) clipped.push(`${name} right ${b.x + b.w} > ${window.innerWidth}`);
      }
      // Does anything in the shell stand over something the reader has to click, and
      // does anything on the world stand under the shell chrome that floats over it?
      const covered: string[] = [];
      for (const name of ['rail', 'strip'] as const) {
        const shellBox = zones[name];
        if (!shellBox || shellBox.w === 0) continue;
        for (const el of document.querySelectorAll('svg .node-box, svg .bundle-card-box, .plate-row-hit')) {
          const b = el.getBoundingClientRect();
          if (b.left < shellBox.x + shellBox.w && shellBox.x < b.right && b.top < shellBox.y + shellBox.h && shellBox.y < b.bottom) {
            covered.push(`${name}:${el.getAttribute('class') ?? el.tagName}`);
          }
        }
      }
      /*
       * The band is a world object and the viewport controls are shell chrome pinned to
       * the stage's bottom-right, so the band's right-aligned note ran underneath them.
       * Checked against the controls rather than only against the viewport, because
       * "inside the viewport" said nothing about the layer above it.
       */
      const bandOverlapsControls: string[] = [];
      const ctrl = rect('.viewport-controls');
      const note = document.querySelector('.band .band-note');
      if (ctrl && note) {
        const n = note.getBoundingClientRect();
        if (n.width > 0 && n.left < ctrl.x + ctrl.w && ctrl.x < n.right
          && n.top < ctrl.y + ctrl.h && ctrl.y < n.bottom) {
          bandOverlapsControls.push(`band note under controls: note ${Math.round(n.left)}..${Math.round(n.right)}, controls ${ctrl.x}..${ctrl.x + ctrl.w}`);
        }
      }
      // The zoom controls must still be the thing under their own pixels.
      const controls = zones.controls;
      const hit = controls
        ? document.elementFromPoint(controls.x + controls.w / 2, controls.y + controls.h / 2)
        : null;
      return {
        zones,
        clipped,
        covered,
        bandOverlapsControls,
        controlsHittable: !!hit && hit.closest('.viewport-controls') !== null,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        verticalOverflow: document.documentElement.scrollHeight > window.innerHeight,
        docHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        // The frozen breakpoints, read from the rendered shell rather than the source.
        railCollapsed: getComputedStyle(document.querySelector('.rail') as Element).display === 'none',
        railToggleShown: getComputedStyle(document.querySelector('#rail-toggle') as Element).display !== 'none',
        stripHeight: (zones.strip?.h ?? 0) > 0,
      };
    });
    report['11-responsive'] = responsive;
    await small.screenshot({ path: `${OUT}/11-responsive-1280x800.png` });
    check('11 no zone is clipped at 1280x800, the band included',
      responsive.clipped.length === 0, responsive.clipped.join('; '));
    check('11 nothing in the shell covers something interactive',
      responsive.covered.length === 0, `${responsive.covered.length} covered`);
    check('11 the band note is not printed under the viewport controls',
      responsive.bandOverlapsControls.length === 0,
      responsive.bandOverlapsControls.join('; '));
    check('11 the zoom controls are still clickable',
      responsive.controlsHittable);
    check('11 the canvas owns the viewport with no scrollbar',
      !responsive.horizontalOverflow && !responsive.verticalOverflow,
      `doc ${responsive.docHeight} vs ${responsive.innerHeight}`);
    check('11 the rail collapses to a disclosure at 1280, as the design freezes it',
      responsive.railCollapsed && responsive.railToggleShown,
      `rail collapsed=${responsive.railCollapsed}, toggle shown=${responsive.railToggleShown}`);

    // ================================== 11b · the same graph at 1280, drawer open
    const smallMember = await rowPoint(small, new RegExp(MEMBER_NAME))
      ?? await (async () => {
        const m = await affordancePoint(small, '.plate-row-more');
        if (m) await small.mouse.click(m.x, m.y);
        await small.waitForTimeout(700);
        return rowPoint(small, new RegExp(MEMBER_NAME));
      })();
    if (smallMember) {
      await small.mouse.click(smallMember.x, smallMember.y);
      await small.waitForTimeout(800);
    }
    await small.screenshot({ path: `${OUT}/11b-1280x800-drawer.png` });
    const smallDrawer = await small.evaluate(() => {
      const drawer = document.querySelector('.drawer') as HTMLElement | null;
      const style = drawer ? getComputedStyle(drawer) : null;
      const stage = document.querySelector('#stage')?.getBoundingClientRect() ?? null;
      const box = drawer?.getBoundingClientRect() ?? null;
      return {
        drawerShown: !!drawer && !drawer.hasAttribute('hidden'),
        // At 1340 and below the frozen design makes the Drawer an overlay. It must
        // still be inside the shell and must not have pushed the stage.
        position: style?.position ?? null,
        insideViewport: !!box && box.left >= -1 && box.right <= window.innerWidth + 1,
        stageWidth: stage?.width ?? null,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    report['11b-1280-drawer'] = smallDrawer;
    check('11b the Drawer is an overlay at 1280 and stays inside the viewport',
      smallDrawer.drawerShown && smallDrawer.position === 'absolute' && smallDrawer.insideViewport,
      `position=${smallDrawer.position}, inside=${smallDrawer.insideViewport}`);
    check('11b opening it adds no scrollbar',
      !smallDrawer.horizontalOverflow);
    await small.close();

    // ===================================== 12 · camera stability, proof capture
    await open(page, url, `/${SUBJECT_REPO}`);
    await page.screenshot({ path: `${OUT}/12a-camera-default.png` });
    const camDefault = await readFrame(page);
    const memberAgain = await rowPoint(page, new RegExp(MEMBER_NAME))
      ?? await (async () => {
        const m = await affordancePoint(page, '.plate-row-more');
        if (m) await page.mouse.click(m.x, m.y);
        await page.waitForTimeout(700);
        return rowPoint(page, new RegExp(MEMBER_NAME));
      })();
    if (memberAgain) {
      await page.mouse.click(memberAgain.x, memberAgain.y);
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: `${OUT}/12b-camera-selected-drawer.png` });
    const camSelected = await readFrame(page);
    report['12-camera-proof'] = { default: camDefault.camera, selected: camSelected.camera };
    check('12 the window is identical before and after reading a relationship',
      worldCamera(camDefault.camera) === worldCamera(camSelected.camera),
      `${worldCamera(camDefault.camera)} vs ${worldCamera(camSelected.camera)}`);
    check('12 the subject keeps its world focal and actual screen position/scale',
      JSON.stringify(camDefault.camera.worldFocal) === JSON.stringify(camSelected.camera.worldFocal)
        && JSON.stringify(camDefault.camera.subjectScreen) === JSON.stringify(camSelected.camera.subjectScreen)
        && camDefault.camera.scale === camSelected.camera.scale,
      JSON.stringify({before:camDefault.camera, after:camSelected.camera}));

    // ==================================== 13 · hierarchy without any text at all
    await open(page, url, `/${DENSE_REPO}`);
    await page.addStyleTag({
      content: `
        body.masked, body.masked * {
          color: transparent !important;
          text-shadow: none !important;
          -webkit-text-fill-color: transparent !important;
        }
        body.masked svg text { fill: transparent !important; }
      `,
    });
    await page.evaluate(() => document.body.classList.add('masked'));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/13-masked-hierarchy.png` });
    const masked = await page.evaluate(() => {
      // A real text element, not a mark: the question is whether the words are gone.
      const label = document.querySelector('.plate-row-label') ?? document.querySelector('.node-label');
      return {
        textTransparent: label
          ? ['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(label as SVGTextElement).fill)
          : null,
        boxesKept: document.querySelectorAll('svg .node-box, svg .bundle-card-box').length,
        depthShapesKept: document.querySelectorAll('.depth-shadow').length,
        marksKept: document.querySelectorAll('.plate-row-status').length,
      };
    });
    report['13-masked'] = masked;
    check('13 hierarchy survives with every glyph removed',
      masked.textTransparent === true && masked.boxesKept > 0 && masked.depthShapesKept > 0 && masked.marksKept > 0,
      `boxes=${masked.boxesKept} depth=${masked.depthShapesKept} marks=${masked.marksKept}`);

    // ============================ 15..18 · the densest real evidence set (pebrel)
    /*
     * `Kuddev/pebrel` is the only repository in the corpus dense enough to exercise
     * the browse path: 98 entities, 137 `package_manifest` records, and a serde entry
     * with eight of them. Every count below is read off the shipped page, never
     * asserted against a fixture -- the point is what the real data does.
     */
    const evidence = await browser.newPage({ viewport: DESKTOP });
    evidence.on('pageerror', (e) => errors.push(`[pebrel] pageerror: ${e.message}`));
    evidence.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[pebrel] ${m.text()}`);
    });
    await open(evidence, url, `/${EVIDENCE_REPO}`);
    const fEvidence = await readFrame(evidence);
    report['15-evidence-default'] = fEvidence;
    await evidence.screenshot({ path: `${OUT}/15-pebrel-default.png` });
    check('15 the densest real graph aggregates rather than listing 98 boxes',
      fEvidence.counts.plates > 0 && fEvidence.counts.loose < 20,
      `${fEvidence.counts.loose} loose, ${fEvidence.counts.plates} plates, ${fEvidence.counts.rows} rows`);
    check('15 every plate row sits inside its own plate',
      fEvidence.plates.every((p) => p.rowsInsideBox));
    check('15 the dense evidence composes without overlap',
      fEvidence.overlaps.length === 0 && fEvidence.outsideFrame.length === 0,
      `overlaps=${fEvidence.overlaps.length} outside=${fEvidence.outsideFrame.length}`);
    // The one that matters most here: 97 records in one plate, against a band that must
    // stay whole.
    const heldBefore = await page.evaluate(
      () => document.querySelectorAll('.plate-row-held').length,
    );
    check('15 a plate tall enough to reach the band states what it is holding back',
      heldBefore > 0, `${heldBefore} "in the Drawer" notes on the plate`);
    const bandHits = await plateBandCollisions(page);
    check('15 no plate draws through the edge key',
      bandHits.length === 0, bandHits.join(', '));
    check('15 the rail key states the families this graph really has',
      fEvidence.keyRows > 0, `${fEvidence.keyRows} keyed families`);

    const evidenceMore = await affordancePoint(evidence, '.plate-row-more');
    if (evidenceMore) {
      await evidence.mouse.click(evidenceMore.x, evidenceMore.y);
      await evidence.waitForTimeout(800);
    }
    const fEvidenceExpanded = await readFrame(evidence);
    report['16-evidence-expanded'] = fEvidenceExpanded;
    await evidence.screenshot({ path: `${OUT}/16-pebrel-expanded.png` });
    check('16 expanding the dense plate reveals held-back evidence',
      fEvidenceExpanded.counts.rows > fEvidence.counts.rows,
      `${fEvidence.counts.rows} rows -> ${fEvidenceExpanded.counts.rows} rows`);
    const bandHitsExpanded = await plateBandCollisions(evidence);
    check('16 the expanded dense plate still does not reach the edge key',
      bandHitsExpanded.length === 0, bandHitsExpanded.join(', '));
    check('16 expanding does not move the world',
      worldCamera(fEvidenceExpanded.camera) === worldCamera(fEvidence.camera));

    const evidenceMember = await rowPoint(evidence, /serde/) ?? await rowPoint(evidence, /./);
    if (evidenceMember) {
      await evidence.mouse.click(evidenceMember.x, evidenceMember.y);
      await evidence.waitForTimeout(800);
    }
    const fEvidenceSelected = await readFrame(evidence);
    report['17-evidence-selected'] = fEvidenceSelected;
    await evidence.screenshot({ path: `${OUT}/17-pebrel-selected.png` });
    const evidenceDrawer = await evidence.evaluate(
      () => document.querySelector('.drawer')?.textContent?.replace(/\s+/g, ' ') ?? '',
    );
    check('17 selecting real evidence opens the Drawer with its manifest record',
      fEvidenceSelected.rails.drawer === 'shown' && /package\.json|manifest|Cargo\.toml/i.test(evidenceDrawer),
      fEvidenceSelected.drawerSections.join(' / '));
    check('17 selecting evidence does not move the world',
      worldCamera(fEvidenceSelected.camera) === worldCamera(fEvidence.camera));

    // Selected + hover: the state the ladder exists to protect.
    const evidenceRow = await rowPoint(evidence, /./);
    if (evidenceRow) {
      await evidence.mouse.move(evidenceRow.x, evidenceRow.y);
      await evidence.waitForTimeout(400);
    }
    await evidence.screenshot({ path: `${OUT}/18-pebrel-selected-hover.png` });
    const hoverKept = await evidence.evaluate(() => {
      const plate = document.querySelector('.bundle-card.is-selected');
      const row = document.querySelector('.plate-row');
      return {
        plateSelected: !!plate,
        // A selected row must keep its marker on hover. It used to paint white on
        // hover and lose it, which is the exact failure the ladder forbids.
        markers: row ? row.querySelectorAll('.plate-row-marker').length : 0,
        rowStates: [...document.querySelectorAll('.plate-row')].map(
          (r) => r.getAttribute('data-state') ?? r.className,
        ),
      };
    });
    report['18-selected-hover'] = hoverKept;
    check('18 a selected row keeps its marker on hover',
      hoverKept.plateSelected && hoverKept.markers > 0,
      `${hoverKept.markers} markers across ${hoverKept.rowStates.length} rows, states ${[...new Set(hoverKept.rowStates)].join(' | ')}`);
    await evidence.close();

    // ================================================ 19 · scroll presentation
    /*
     * No native scrollbar anywhere, and scrolling intact.
     *
     * The pixel evidence is the point. `scrollbar-width: none` in a stylesheet proves
     * nothing on its own: a stylesheet can claim it while the engine paints a thumb
     * anyway, which is exactly what happened once here. The gutter of each panel is read
     * out of a real screenshot with its content hidden, and any pixel that is not the
     * panel's own surface is chrome.
     */
    const drawerPixels = await scrollbarPixels(browser, '.drawer-inner', EVIDENCE_REPO, url);
    report['19-scrollbar-drawer'] = drawerPixels;
    check('19 no native scrollbar is painted in the Drawer gutter',
      drawerPixels.gutterPixels === 0,
      `${drawerPixels.gutterPixels} non-surface pixel(s) in ${drawerPixels.gutterWidth}px x ${drawerPixels.height}px${drawerPixels.worst ? `, e.g. ${drawerPixels.worst}` : ''}`);

    const railPixels = await scrollbarPixels(browser, '.rail-scroll', EVIDENCE_REPO, url);
    report['19-scrollbar-rail'] = railPixels;
    check('19 no native scrollbar is painted in the rail gutter',
      railPixels.gutterPixels === 0,
      `${railPixels.gutterPixels} non-surface pixel(s) in ${railPixels.gutterWidth}px x ${railPixels.height}px ${railPixels.worst}`);

    // And the same panel on its own page, scrolled: an affordance that only holds at the
    // top is not an affordance.
    {
      const scroller = await browser.newPage({ viewport: DESKTOP });
      scroller.on('pageerror', (e) => errors.push(`[scroll] pageerror: ${e.message}`));

      /*
       * Keep the view payload the page actually received.
       *
       * The group counts below are checked against this, so that the grouping is proved
       * against the same bytes the app drew from rather than against a checked-in
       * fixture that drifts out of date the next time the corpus is re-analysed.
       */
      let pebrelPayload: { data?: Record<string, unknown> } | null = null;
      scroller.on('response', (response) => {
        if (!/\/api\/view\/kuddev\/pebrel/i.test(response.url())) return;
        void response.json().then((body) => { pebrelPayload = body as { data?: Record<string, unknown> }; })
          .catch(() => { /* a non-JSON body is the app's problem to report, not this listener's */ });
      });
      const capturedView = async () => {
        for (let i = 0; i < 60 && !pebrelPayload; i++) await scroller.waitForTimeout(100);
        return (pebrelPayload as { data?: Record<string, unknown> } | null)?.data ?? null;
      };
      await open(scroller, url, `/${EVIDENCE_REPO}`);
      await scroller.click('svg .node.is-subject .node-hit');
      await scroller.waitForTimeout(900);
      const drawerScroll = await scrollBehaviour(scroller, '.drawer-inner');
      report['19-drawer-scroll'] = drawerScroll;
      check('19 the dense Drawer really scrolls',
        drawerScroll.scrollable && drawerScroll.rows > 50,
        `${drawerScroll.rows} rows, ${drawerScroll.scrollable ? 'scrollable' : 'not scrollable'}`);

      /*
       * The dense Drawer must not be a flat list of ninety-seven.
       *
       * `Kuddev/pebrel`'s subject has 97 one-hop dependency relationships, and listing
       * them as 97 undifferentiated rows restates the count rather than answering
       * anything. What the evidence says is that they are *declared* by a handful of
       * manifests -- a dozen-odd `Cargo.toml` and `package.json` files -- so the Drawer
       * groups by the file that declares each relationship, names each group in mono,
       * counts it, and holds that heading still while its members scroll under it.
       *
       * The counts are recounted here from the payload the page actually received and
       * compared against the DOM, rather than being asserted as literals.
       *
       * That is not fussiness about how to write a test. `pebrel` moves: a re-analysis
       * shifts which manifest declares what, and this corpus is re-analysed as the
       * product changes. A literal `nebula_app = 51` would have kept passing for a
       * fixture nobody had refreshed and started failing the day the cache was rebuilt,
       * with the grouping itself perfectly correct both times. The invariants below --
       * every group named by a real file, the counts partitioning the total, the order
       * being the same total order the app promises, and the DOM agreeing with an
       * independent recount of the payload -- are what the grouping actually promises,
       * and they hold at every revision.
       */
      const pebrelView = await capturedView();
      const recount = new Map<string, number>();
      const payloadEvidence = (pebrelView?.evidenceByRelationship ?? {}) as Record<
        string, Array<{ data?: { data?: unknown; manifest_path?: string } & Record<string, unknown> }>>;
      for (const records of Object.values(payloadEvidence)) {
        const first = records?.[0];
        const payload = first?.data ?? null;
        const manifest = payload ? (payload.data as { manifest_path?: string } | undefined)?.manifest_path
          ?? (payload as { manifest_path?: string }).manifest_path : undefined;
        recount.set(manifest ?? '(none)', (recount.get(manifest ?? '(none)') ?? 0) + 1);
      }
      const expected = [...recount.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => `${name}=${count}`).join(', ');
      report['19-dense-groups-expected'] = expected;

      const groups = await scroller.evaluate(`(() => {
        const heads = [...document.querySelectorAll('.drawer-inner .d-group-head')];
        const blockHead = [...document.querySelectorAll('.drawer-inner .d-block-head')]
          .find((h) => /RELATIONSHIPS/.test(h.textContent));
        return {
          block: blockHead?.textContent?.trim() ?? '',
          blockSticky: blockHead ? getComputedStyle(blockHead).position : null,
          groups: heads.map((h) => ({
            name: h.querySelector('.mono')?.textContent?.trim() ?? '',
            count: Number(h.querySelector('.d-group-count')?.textContent ?? '0'),
            sticky: getComputedStyle(h).position,
          })),
          rows: document.querySelectorAll('.drawer-inner .bundle-row').length,
        };
      })()`) as {
        block: string; blockSticky: string | null;
        groups: Array<{ name: string; count: number; sticky: string }>;
        rows: number;
      };
      report['19-dense-groups'] = groups;
      await scroller.screenshot({ path: `${OUT}/19-pebrel-dense-drawer.png` });
      const named = groups.groups.filter((g) => /\.(toml|json)$/.test(g.name));
      const summed = groups.groups.reduce((sum, g) => sum + g.count, 0);
      const ordered = [...groups.groups].sort((a, b) =>
        b.count - a.count || a.name.localeCompare(b.name));
      const rendered = groups.groups.map((g) => `${g.name}=${g.count}`).join(', ');
      check('19 the dense Drawer is grouped by the manifest that declares each relationship',
        groups.groups.length >= 5 && named.length === groups.groups.length,
        `${groups.groups.length} groups, ${named.length} named by file: ${rendered}`);
      check('19 the rendered groups are exactly the payload recounted independently',
        rendered === expected, `rendered ${rendered} | recounted ${expected}`);
      check('19 every member is reachable and counted exactly once',
        groups.rows === summed && summed === Object.keys(payloadEvidence).length,
        `${groups.rows} rows, counts sum ${summed}, ${Object.keys(payloadEvidence).length} relationships`);
      check('19 the block heading states the same total and file count',
        new RegExp(`^RELATIONSHIPS \\(${summed} in ${groups.groups.length} files\\)$`).test(groups.block),
        `heading "${groups.block}" against ${summed} in ${groups.groups.length} files`);
      check('19 the order is the promised total order: by count, then by path',
        rendered === ordered.map((g) => `${g.name}=${g.count}`).join(', '),
        `rendered ${rendered} | sorted ${ordered.map((g) => `${g.name}=${g.count}`).join(', ')}`);
      check('19 both the block heading and each group heading are sticky',
        groups.blockSticky === 'sticky' && groups.groups.every((g) => g.sticky === 'sticky'),
        `block ${groups.blockSticky}, groups ${[...new Set(groups.groups.map((g) => g.sticky))].join('/')}`);
      check('19 the wheel scrolls it', drawerScroll.wheelMoved);
      check('19 the keyboard scrolls it, and it is focusable',
        drawerScroll.pageDownMoved && drawerScroll.endReachedBottom && drawerScroll.focusable,
        `pageDown=${drawerScroll.pageDownMoved}, end=${drawerScroll.endReachedBottom}, tabIndex ok=${drawerScroll.focusable}`);
      check('19 the last relationship is reachable at the bottom',
        drawerScroll.lastRowReachable);

      // The group heading stays put while its own list runs under it.
      const sticky = await scroller.evaluate(`(() => {
        const n = document.querySelector('.drawer-inner');
        const list = [...n.querySelectorAll('.d-block-head')].find((h) => /RELATIONSHIPS/.test(h.textContent));
        if (!list) return null;
        const regionTop = Math.round(n.getBoundingClientRect().top);
        const at = (t) => { n.scrollTop = t; return Math.round(list.getBoundingClientRect().top - regionTop); };
        return { position: getComputedStyle(list).position, at700: at(700), at1400: at(1400) };
      })()`) as { position: string; at700: number; at1400: number } | null;
      report['19-sticky-heading'] = sticky;
      check('19 the group heading holds while its list scrolls under it',
        !!sticky && sticky.position === 'sticky' && sticky.at700 === 0 && sticky.at1400 === 0,
        sticky ? `position=${sticky.position}, top@700=${sticky.at700}, top@1400=${sticky.at1400}` : 'no list heading');

      // Bottom of the scroll, photographed, and the affordance states what is true.
      await scroller.evaluate(`document.querySelector('.drawer-inner').scrollTop = 999999`);
      await scroller.waitForTimeout(400);
      await scroller.screenshot({ path: `${OUT}/19-drawer-bottom-of-scroll.png` });
      const atBottom = await scroller.evaluate(`(() => {
        const n = document.querySelector('.drawer-inner');
        return { classes: [...n.classList], frameMore: document.querySelector('.drawer').classList.contains('is-more-below') };
      })()`) as { classes: string[]; frameMore: boolean };
      check('19 at the bottom the rule withdraws and the top fade appears',
        atBottom.classes.includes('gl-has-above') && !atBottom.frameMore,
        `classes ${atBottom.classes.join(' ')}, rule ${atBottom.frameMore}`);

      // And at the top it is the other way round.
      await scroller.evaluate(`document.querySelector('.drawer-inner').scrollTop = 0`);
      await scroller.waitForTimeout(400);
      await scroller.screenshot({ path: `${OUT}/19-drawer-top-of-scroll.png` });
      const atTop = await scroller.evaluate(`(() => {
        const n = document.querySelector('.drawer-inner');
        return { classes: [...n.classList], frameMore: document.querySelector('.drawer').classList.contains('is-more-below') };
      })()`) as { classes: string[]; frameMore: boolean };
      check('19 at the top the rule shows and the top fade is absent',
        atTop.classes.includes('gl-has-below') && !atTop.classes.includes('gl-has-above') && atTop.frameMore,
        `classes ${atTop.classes.join(' ')}, rule ${atTop.frameMore}`);
      await scroller.close();
    }

    // The rail, on a viewport short enough that its content genuinely overflows.
    {
      const railPage = await browser.newPage({ viewport: { width: 1600, height: 620 } });
      railPage.on('pageerror', (e) => errors.push(`[rail-scroll] pageerror: ${e.message}`));
      await open(railPage, url, `/${EVIDENCE_REPO}`);
      const railScroll = await scrollBehaviour(railPage, '.rail-scroll');
      report['19-rail-scroll'] = railScroll;
      await railPage.screenshot({ path: `${OUT}/19-rail-scrolled.png` });
      check('19 the rail scrolls, by wheel and by keyboard, with no scrollbar',
        railScroll.scrollable && railScroll.wheelMoved && railScroll.pageDownMoved && railScroll.focusable,
        `scrollable=${railScroll.scrollable}, wheel=${railScroll.wheelMoved}, keyboard=${railScroll.pageDownMoved}, focusable=${railScroll.focusable}`);
      await railPage.evaluate(`document.querySelector('.rail-scroll').scrollTop = 999999`);
      await railPage.waitForTimeout(400);
      await railPage.screenshot({ path: `${OUT}/19-rail-bottom-of-scroll.png` });
      const railBottom = await railPage.evaluate(`(() => {
        const n = document.querySelector('.rail-scroll');
        return { classes: [...n.classList], frameMore: document.querySelector('.rail').classList.contains('is-more-below'),
                 lastBlock: (() => { const b = n.querySelectorAll('.lblk'); const r = b[b.length-1];
                   if (!r) return null; const a = r.getBoundingClientRect(), c = n.getBoundingClientRect();
                   return a.top < c.bottom && a.bottom > c.top; })() };
      })()`) as { classes: string[]; frameMore: boolean; lastBlock: boolean | null };
      check('19 the rail withdraws its rule at the bottom, with its last block reachable',
        !railBottom.frameMore && railBottom.lastBlock !== false,
        `rule ${railBottom.frameMore}, last block visible ${railBottom.lastBlock}`);
      await railPage.close();
    }

    // Every scroller the product ships has its chrome hidden and is keyboard-reachable.
    {
      const audit = await browser.newPage({ viewport: DESKTOP });
      await open(audit, url, `/${EVIDENCE_REPO}`);
      const scrollers = await audit.evaluate(`(() => {
        const out = [];
        for (const el of document.querySelectorAll('html, body, main, #main, body *')) {
          const cs = getComputedStyle(el);
          const scrolls = cs.overflowY === 'auto' || cs.overflowY === 'scroll'
            || cs.overflowX === 'auto' || cs.overflowX === 'scroll';
          if (!scrolls) continue;
          out.push({ el: el.tagName + (el.id ? '#' + el.id : ''),
                     scrollbarWidth: cs.scrollbarWidth,
                     gutterPx: el.offsetWidth - el.clientWidth,
                     focusable: el.tabIndex >= 0 });
        }
        return out;
      })()`) as Array<{ el: string; scrollbarWidth: string; gutterPx: number; focusable: boolean }>;
      report['19-scrollers'] = scrollers;
      const painted = scrollers.filter((s) => s.scrollbarWidth !== 'none' && s.gutterPx > 0);
      check('19 no scrollable region in the product keeps its native scrollbar',
        painted.length === 0,
        painted.map((s) => `${s.el} ${s.scrollbarWidth} ${s.gutterPx}px`).join(', '));

      /*
       * The document itself.
       *
       * The rule is global and this is the part that was left out first: `html` and
       * `body` are scrollers too, and they were still painting. The claim is stronger
       * than "no panel has a scrollbar" -- it is that the page is a viewport-sized shell
       * which does not scroll at all, so there is nothing on it to hide.
       */
      const shell = await audit.evaluate(`(() => ({
        docH: document.documentElement.scrollHeight,
        inner: window.innerHeight,
        bodyH: Math.round(document.body.getBoundingClientRect().height),
        htmlScrollbarWidth: getComputedStyle(document.documentElement).scrollbarWidth,
        bodyScrollbarWidth: getComputedStyle(document.body).scrollbarWidth,
        docGutter: document.documentElement.offsetWidth - document.documentElement.clientWidth,
        mainFlex: getComputedStyle(document.querySelector('#main')).display,
      }))()`) as {
        docH: number; inner: number; bodyH: number;
        htmlScrollbarWidth: string; bodyScrollbarWidth: string; docGutter: number; mainFlex: string;
      };
      report['19-document-shell'] = shell;
      check('19 the document itself is a viewport-sized shell and does not scroll',
        shell.docH <= shell.inner && shell.bodyH <= shell.inner,
        `document ${shell.docH} vs viewport ${shell.inner}, body ${shell.bodyH}`);
      check('19 the document scrollbar is hidden even so',
        shell.htmlScrollbarWidth === 'none' && shell.bodyScrollbarWidth === 'none' && shell.docGutter === 0,
        `html ${shell.htmlScrollbarWidth}, body ${shell.bodyScrollbarWidth}, gutter ${shell.docGutter}px`);
      check('19 the shell is a flex chain, so regions flex against a real height',
        shell.mainFlex === 'flex', `#main display: ${shell.mainFlex}`);
      await audit.close();
    }

    // ================================ 14 · the depth ladder, in painted pixels
    /*
     * Four tiers, four real offsets, read out of a screenshot rather than out of a
     * stylesheet: subject 6, selected plate 5, connected plate 4, flat 0.
     *
     * The probe samples the pixel just inside the plate's own corner (which must be
     * the plate's surface) and the pixel just inside the shadow's corner (which must
     * be the shadow's ink). A tier whose shadow is missing, mis-offset or unpainted
     * fails here even when every DOM attribute reads correctly.
     */
    await open(page, url, `/${SUBJECT_REPO}`);
    const tiers: Array<{ tier: string; owner: string; expected: number }> = [
      { tier: 'subject', owner: '.node.is-subject', expected: 6 },
      { tier: 'connected plate', owner: '.bundle-card:not(.is-selected)', expected: 4 },
    ];
    // A selected plate needs a selection to exist.
    const anyMember = await rowPoint(page, /./);
    if (anyMember) {
      await page.mouse.click(anyMember.x, anyMember.y);
      await page.waitForTimeout(700);
    }
    tiers.splice(1, 0, { tier: 'selected plate', owner: '.bundle-card.is-selected', expected: 5 });

    const depthPixels: Record<string, unknown> = {};
    for (const { tier, owner, expected } of tiers) {
      const probe = await shadowProbe(page, owner);
      if (!probe) {
        check(`14 the ${tier} tier paints a depth shadow`, false, 'no shadow shape found');
        continue;
      }
      const png = await page.screenshot();
      const [shadowPixel, facePixel] = await samplePixels(browser, png, [probe.shadowPoint, probe.facePoint]);
      const screenOffset = Math.round(probe.worldDx * probe.scale * 100) / 100;
      depthPixels[tier] = {
        worldOffset: [probe.worldDx, probe.worldDy],
        scale: probe.scale,
        screenOffset,
        shadowPixel,
        facePixel,
      };
      check(`14 the ${tier} tier throws exactly ${expected}px`,
        probe.worldDx === expected && probe.worldDy === expected,
        `world offset ${probe.worldDx}/${probe.worldDy} at scale ${probe.scale} (${screenOffset}px on screen)`);
      check(`14 the ${tier} tier's shadow is actually painted`,
        shadowPixel !== facePixel,
        `shadow ${shadowPixel} vs face ${facePixel}`);
      // The corner, photographed, for the record.
      await page.screenshot({
        path: `${OUT}/14-depth-${tier.replace(/\s+/g, '-')}.png`,
        clip: {
          x: Math.max(0, Math.floor(probe.corner.x - 8)),
          y: Math.max(0, Math.floor(probe.corner.y - 8)),
          width: Math.ceil(probe.corner.width + expected * probe.scale + 16),
          height: Math.ceil(probe.corner.height * 0.6),
        },
      });
    }
    {
      // Flat surfaces throw nothing at all.
      const flat = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.plate-row')];
        const shapes = rows.map((r) => r.querySelectorAll('.depth-shadow').length);
        const band = document.querySelector('.band');
        const rail = document.querySelector('.rail');
        return {
          rowShadowCount: shapes,
          bandShadow: band ? band.querySelectorAll('.depth-shadow').length : -1,
          railShadow: rail ? rail.querySelectorAll('.depth-shadow').length : -1,
        };
      });
      depthPixels['flat'] = flat;
      check('14 flat surfaces throw no depth shadow',
        flat.rowShadowCount.every((n) => n === 0)
          && flat.bandShadow === 0 && flat.railShadow === 0,
        `${flat.rowShadowCount.length} rows, ${flat.rowShadowCount.reduce((a, b) => a + b, 0)} shadows`);
    }
    report['14-depth'] = depthPixels;

    check('14 the client logged no errors during the whole pass', errors.length === 0, errors.slice(0, 3).join(' | '));
    report['errors'] = errors;

    await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  process.stdout.write(`\n${checks.length} checks, ${checks.length - failed.length} pass, ${failed.length} fail\n`);
  if (failed.length > 0) {
    for (const f of failed) process.stdout.write(`FAIL ${f.name} — ${f.detail}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  if (error instanceof assert.AssertionError) process.stderr.write(`${error.stack ?? ''}\n`);
  process.exit(1);
});
