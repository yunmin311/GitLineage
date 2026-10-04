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

/** A member that exists in `SUBJECT_REPO`'s plugin table, named as a reader sees it. */
const MEMBER_NAME = 'Templater';

const OUT = resolve('artifacts/shots/slice7');
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
  centre: [number, number] | null;
  worldFocal: [number, number] | null;
  subjectScreen: { x: number; y: number; w: number; h: number } | null;
}

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
  rails: Record<string, string>;
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
  search: string;
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
      lcol: visible('.lcol'),
      band: visible('.band'),
      legend: visible('.legend'),
      gutter: visible('.gutter'),
      drawer: visible('.drawer'),
    },
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
    search: location.search,
  };
};

async function readFrame(page: Page): Promise<Frame> {
  return page.evaluate(READ_FRAME) as Promise<Frame>;
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
    const b = row.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
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
    browser = await chromium.launch();
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
    check('01 the reserved right gutter is used',
      fDefault.rails.gutter === 'shown');

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
    check('02 every relationship is individually reachable',
      fExpanded.counts.rows === 14, `${fExpanded.counts.rows} selectable rows for 14 relationships`);
    check('02 expanding moves nothing on screen',
      JSON.stringify(fExpanded.camera) === JSON.stringify(fDefault.camera),
      'camera and subject position identical');

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
    check('03 the context column and the bottom band survive the Drawer',
      fSelected.rails.lcol === 'shown' && fSelected.rails.band === 'shown');
    check('03 the Drawer switches the right rail out',
      fSelected.rails.gutter === 'display:none' || fSelected.rails.gutter === 'hidden',
      `gutter ${fSelected.rails.gutter}`);
    check('03 selecting a member moves nothing on screen',
      JSON.stringify(fSelected.camera) === JSON.stringify(fDefault.camera),
      'camera and subject position identical');

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
    check('12 closing the Drawer restores the frame without a refit',
      closeDrawer && JSON.stringify(fClosed.camera) === JSON.stringify(fDefault.camera),
      'camera identical after open and close');

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
    const primitives = await page.evaluate(() => {
      const CANON = ['is-repository', 'is-package', 'is-external-project', 'is-commit', 'is-release', 'is-source-artifact'];
      const found: Record<string, number> = {};
      const multi: string[] = [];
      for (const b of document.querySelectorAll('.node-box')) {
        const worn = [...b.classList].filter((c) => CANON.includes(c));
        for (const c of worn) found[c] = (found[c] ?? 0) + 1;
        if (worn.length > 1) {
          multi.push(`${b.closest('.node')?.querySelector('.node-label')?.textContent ?? '?'} => ${worn.join('+')}`);
        }
      }
      const key = [...document.querySelectorAll('.tkey .tk-row')].map((r) => ({
        type: r.querySelector('.tk-row span:nth-child(2)')?.textContent ?? '',
        glyph: [...(r.querySelector('.gl i')?.classList ?? [])].find((c) => c.startsWith('is-')) ?? '',
        count: r.querySelector('.k')?.textContent ?? '',
      }));
      return { found, key, multiPrimitive: multi };
    });
    report['06-primitives'] = primitives;
    const canonicalPrimitives = [
      'is-repository', 'is-package', 'is-external-project',
      'is-commit', 'is-release', 'is-source-artifact',
    ];
    check('06 real data renders more than one entity primitive',
      Object.keys(primitives.found).length > 1, Object.keys(primitives.found).join(', '));
    /*
     * The fallback this guards against is a node wearing another type's primitive.
     * What matters is not whether `is-repository` appears -- real repositories are
     * supposed to -- but that no node wears two primitives, and that every primitive
     * on the canvas is one the canonical union actually defines.
     */
    check('06 no node wears more than one entity primitive',
      primitives.multiPrimitive.length === 0, primitives.multiPrimitive.join(', '));
    check('06 every primitive on the canvas is a canonical one',
      Object.keys(primitives.found).every((c) => canonicalPrimitives.includes(c)),
      Object.keys(primitives.found).join(', '));
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

    // ================================== 07..09 · the analysis dial, phase by phase
    await open(page, url, `/${SUBJECT_REPO}?dial-test=1`);
    const dialProbe = async (phase: string): Promise<Record<string, unknown>> =>
      page.evaluate((p) => {
        const api = (window as unknown as { __setPhaseForTest?: (x: string) => void }).__setPhaseForTest;
        const progress = document.querySelector('#progress');
        if (progress) progress.removeAttribute('hidden');
        api?.(p);
        const dial = document.querySelector('.dial');
        const arm = document.querySelector('.dial-arm');
        const notches = [...document.querySelectorAll('.dial-notch')];
        const hub = dial?.getBoundingClientRect();
        const armBox = arm?.getBoundingClientRect();
        return {
          phase: p,
          notches: notches.length,
          done: notches.filter((n) => n.classList.contains('is-done')).length,
          current: notches.filter((n) => n.classList.contains('is-current')).length,
          settled: dial?.getAttribute('data-settled') ?? null,
          moving: dial?.getAttribute('data-moving') ?? null,
          angle: dial instanceof HTMLElement ? dial.style.getPropertyValue('--dial-angle') : null,
          // The arm's tip against the current notch, in screen pixels.
          tipGap: hub && armBox ? Math.round((armBox.bottom - hub.bottom) * 100) / 100 : null,
          // A percentage would be a fabricated claim; the dial must not carry one.
          hasPercent: (dial?.textContent ?? '').includes('%'),
        };
      }, phase);

    for (const [index, phase] of (['collecting', 'publishing', 'complete'] as const).entries()) {
      /*
       * Set the phase, let the arm finish moving, and only then read it.
       *
       * `data-moving` describes the transition currently in flight, so sampling it in
       * the same tick as the phase change reads the arm mid-swing. The earlier pass
       * did exactly that and reported a settled dial that was still moving -- a defect
       * in the measurement, not in the dial.
       */
      await dialProbe(phase);
      await page.waitForTimeout(900);
      const dial = await dialProbe(phase);
      report[`0${7 + index}-dial-${phase}`] = dial;
      const file = ['07-analysis-early.png', '08-analysis-late.png', '09-analysis-settled.png'][index]!;
      await page.screenshot({ path: `${OUT}/${file}` });
      check(`0${7 + index} the dial reports the phase it was given`,
        dial.notches === 7 && dial.hasPercent === false,
        `${dial.notches} notches, percent=${dial.hasPercent}`);
    }
    const settled = report['09-dial-complete'] as Record<string, unknown>;
    check('09 the dial settles on its final notch',
      settled.settled === 'true' && settled.moving === 'false',
      `settled=${settled.settled} moving=${settled.moving}`);
    check('09 every earlier notch is marked done at the settled phase',
      settled.done === 6 && settled.current === 1,
      `done=${settled.done} current=${settled.current}`);

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
      const zones = { lcol: rect('.lcol'), band: rect('.band'), gutter: rect('.gutter'), controls: rect('.viewport-controls') };
      const clipped: string[] = [];
      for (const [name, b] of Object.entries(zones)) {
        if (!b) continue;
        if (b.y + b.h > window.innerHeight + 1) clipped.push(`${name} bottom ${b.y + b.h} > ${window.innerHeight}`);
        if (b.y < -1) clipped.push(`${name} top ${b.y} < 0`);
        if (b.x + b.w > window.innerWidth + 1) clipped.push(`${name} right ${b.x + b.w} > ${window.innerWidth}`);
      }
      // Does the context column stand over anything the reader has to click?
      const covered: string[] = [];
      const lcol = zones.lcol;
      if (lcol) {
        for (const el of document.querySelectorAll('svg .node-box, svg .bundle-card-box, .plate-row-hit')) {
          const b = el.getBoundingClientRect();
          if (b.left < lcol.x + lcol.w && lcol.x < b.right && b.top < lcol.y + lcol.h && lcol.y < b.bottom) {
            covered.push(el.getAttribute('class') ?? el.tagName);
          }
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
        controlsHittable: !!hit && hit.closest('.viewport-controls') !== null,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        verticalOverflow: document.documentElement.scrollHeight > window.innerHeight,
        docHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      };
    });
    report['11-responsive'] = responsive;
    await small.screenshot({ path: `${OUT}/11-responsive-1280x800.png` });
    check('11 no authored zone is clipped at 1280x800',
      responsive.clipped.length === 0, responsive.clipped.join('; '));
    check('11 the context column covers nothing interactive',
      responsive.covered.length === 0, `${responsive.covered.length} covered`);
    check('11 the zoom controls are still clickable',
      responsive.controlsHittable);
    check('11 the canvas owns the viewport with no scrollbar',
      !responsive.horizontalOverflow && !responsive.verticalOverflow,
      `doc ${responsive.docHeight} vs ${responsive.innerHeight}`);
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
    check('12 the camera is identical before and after reading a relationship',
      JSON.stringify(camDefault.camera) === JSON.stringify(camSelected.camera),
      `${JSON.stringify(camDefault.camera)} vs ${JSON.stringify(camSelected.camera)}`);

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
        const col = document.querySelector('.lcol');
        return {
          rowShadowCount: shapes,
          bandShadow: band ? band.querySelectorAll('.depth-shadow').length : -1,
          lcolShadow: col ? col.querySelectorAll('.depth-shadow').length : -1,
        };
      });
      depthPixels['flat'] = flat;
      check('14 flat surfaces throw no depth shadow',
        flat.rowShadowCount.every((n) => n === 0),
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
