/**
 * Presentation-layer aggregation.
 *
 * A plate says one thing: these visible relationships are grouped so the canvas
 * can be read. It is a display convenience with a real count, never a claim about
 * where a relationship came from, what declared it, or what depends on what.
 *
 * Two levels, deliberately separated:
 *
 * 1. Neutral fan-out aggregation. A same-relation fan large enough to crowd the
 *    canvas collapses into `<relation> xN`. That asserts only "N visible
 *    relationships share this relation". It is driven by the canvas's visible
 *    object budget, never by an ontology rule: `same type >= N, always bundle`
 *    would freeze a presentational choice into the contract.
 *
 * 2. Evidence-aware subgroups. A subgroup may only be named when real evidence
 *    supports the grouping, because a name is a claim. The signal used is *where
 *    and how the claim was made* -- the observed text of the declaring line and
 *    its locator -- never the relationship's type, family, status, direction or
 *    the entity types at its ends. Those are attributes of the assertion, not of
 *    where it was asserted, and grouping on them would invent provenance.
 *
 * Nothing here mutates the canonical graph. Members keep their ids, direction,
 * status and evidence, and stay reachable in the drawer.
 */

/**
 * Visible objects the canvas will draw from the subject before a fan has to
 * collapse. This is a canvas budget, not a semantic threshold.
 */
export const VISIBLE_OBJECT_BUDGET = 12;

/**
 * Smallest fan worth putting on a plate.
 *
 * A plate exists to stand in for a group. One member is not a group, so a
 * single relationship always stays drawn however tight the budget is, rather than
 * becoming an `x1` plate.
 */
export const MIN_PLATE_SIZE = 2;

/**
 * Member rows a plate lists before it states how many it is holding back.
 *
 * Six, because that is what the frozen design's own plate lists before offering to
 * expand. The number is a readability budget, not a semantic one: the plate's count
 * is always the full count and every member stays reachable.
 */
export const PLATE_MEMBER_ROWS = 6;

/*
 * How many structural groups may each become a mass of its own.
 *
 * Six, and the reason is the world rather than taste: the data zone is an authored
 * composition with a finite number of plate slots, and asking for more masses than it
 * has room for does not add information -- it draws plates on top of each other. So this
 * is a bound on masses, exactly as the design's own rule bounds a fan, and it is
 * enforced on the GROUP count rather than on the relationship count.
 */
export const MAX_MAJOR_GROUPS = 6;

/*
 * The share of a fan's members the named groups must account for.
 *
 * 0.80, and what it buys is that the remainder mass stays small. When the leading groups
 * already cover four fifths of the fan, the honest remainder is a genuine minority rather
 * than a second full presentation, and it still carries its real count so nothing is
 * misrepresented. The policy stops taking groups as soon as coverage is reached: the
 * remaining ones are not diminished, they are simply reported together.
 */
export const MAJOR_GROUP_COVERAGE = 0.8;

/** How a claim was written down, as far as the evidence shows. */
export const DeclarationForm = Object.freeze({
  /** A row of a table, e.g. a markdown pipe row. */
  TableRow: 'table-row',
  /** Anything else written as running text. */
  Prose: 'prose',
  /*
   * A dependency written in a package manifest.
   *
   * This form did not exist, and its absence was the whole of the
   * one-family-dense-presentation gap. `declarationForm` used to answer `unknown` for
   * anything that was not a document reference, on the sound ground that a manifest
   * dependency carries no prose to be "prose". But `evidenceSubgroups` then declined to
   * group any fan with a single unclassified member, so a repository whose density is
   * entirely manifest-declared -- the common case, not an edge case -- could only ever be
   * presented as one `depends_on x N` mass. The evidence names the declaring manifest in
   * its own structured payload (`data.manifest_path`), so the declaring site is a fact
   * about the evidence rather than an inference, and it is the same axis the node
   * Drawer has always grouped by.
   */
  Manifest: 'manifest',
  /** The evidence does not show it. Never guessed. */
  Unknown: 'unknown',
});

/**
 * The declaration form of one evidence record.
 *
 * Conservative on purpose. Evidence with no observed text yields `unknown`
 * rather than an assumption, and an unknown form is never used to name a group.
 */
export function declarationForm(card) {
  /*
   * The manifest case, read first and from the record's own structured payload.
   *
   * `manifest_path` is a documented field of the packages collector's `data`, so this
   * is a read of the payload and not a guess at its shape. A record that carries no
   * manifest path falls through to the document cases below unchanged.
   */
  if (manifestPathOf(card)) return DeclarationForm.Manifest;

  // A document reference is *written down* somewhere. A submodule edge still has no
  // declaration form, and labelling one "Prose" because its evidence record happened
  // to carry text would be a fabricated claim about where the relationship came from.
  const type = card && typeof card.type === 'string' ? card.type : '';
  if (type && type !== 'document_reference' && type !== 'document_attribution') {
    return DeclarationForm.Unknown;
  }
  const text = typeof (card && card.observedText) === 'string' ? card.observedText.trim() : '';
  if (!text) return DeclarationForm.Unknown;
  // A table row begins with a cell delimiter. This is the observed line itself,
  // so it is evidence about where the claim was made.
  if (text.startsWith('|')) return DeclarationForm.TableRow;
  return DeclarationForm.Prose;
}

/**
 * A qualifier for a table group, taken from the file that declares it.
 *
 * `docs/plugins.md` declares the plugin table, so the group is the plugin table.
 * The word is derived from the declaring file rather than hard-coded, so a future
 * table in another document names itself honestly instead of inheriting a label
 * that was fitted to one repository.
 *
 * Returns null when there is no single declaring file, and the caller then falls
 * back to a neutral label rather than overclaiming.
 */
export function tableQualifier(path) {
  if (!path) return null;
  const base = path.split('/').pop() || '';
  const stem = base.replace(/\.[^.]+$/, '');
  const words = stem.replace(/[-_]+/g, ' ').trim();
  if (!words) return null;
  const singular = /s$/i.test(words) && words.length > 3 ? words.replace(/s$/i, '') : words;
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

/**
 * The declaring manifest named by one evidence record, or null.
 *
 * Read defensively because the payload is shaped by the collector that produced it: the
 * packages collector nests its facts under `data.data`, while a flatter record carries
 * them directly. Both are read; neither is assumed, and a record naming no manifest
 * returns null so the caller can fall through rather than invent one.
 */
export function manifestPathOf(card) {
  const data = card && typeof card === 'object' ? card.data : undefined;
  if (!data || typeof data !== 'object') return null;
  const inner = (data.data && typeof data.data === 'object') ? data.data : data;
  const path = inner.manifest_path;
  return typeof path === 'string' && path ? path : null;
}

/** The repository-relative file a claim was written in, from its locator. */
export function declaringPath(card) {
  const locator = typeof (card && card.locator) === 'string' ? card.locator : '';
  const match = /^([^:]+):/.exec(locator);
  return match ? match[1] : locator;
}

/**
 * The evidence-supported groups inside one fan, or `[]` when evidence does not
 * support any grouping.
 *
 * Every member must classify, and at least one group must hold more than one
 * member, otherwise there is no group to name. A partially understood fan stays
 * neutral, because a label on three of fourteen members would read as a claim
 * about all fourteen.
 */
export function evidenceSubgroups(members) {
  const groups = new Map();
  let classified = 0;

  for (const member of members) {
    const card = member.card;
    const form = declarationForm(card);
    if (form === DeclarationForm.Unknown) continue;
    classified += 1;
    // Grouped by form alone. The declaring file is reported as secondary text
    // rather than used as the grouping key: prose written in two different files
    // is still prose, and keying on the file would invent two groups where the
    // evidence shows one.
    /*
     * Grouped by form AND, for a manifest, by the declaring manifest itself.
     *
     * Prose stays grouped by form alone -- prose written in two different files is still
     * prose, and keying on the file would invent two groups where the evidence shows one.
     * A manifest declaration is the opposite case: `manifest_path` IS the declaring site,
     * and grouping every manifest together would answer "these are all declarations" when
     * the real question is "which part of the repository declared these". So the manifest
     * axis keys on that path, and the form is folded into the key so a fan never mixes
     * two declaration forms under one group.
     */
    const key = form === DeclarationForm.Manifest
      ? `${form}:${manifestPathOf(card)}`
      : form;
    const group = groups.get(key) || { form, paths: new Set(), memberEdgeIds: [], manifest: null };
    group.paths.add(manifestPathOf(card) || declaringPath(card));
    if (form === DeclarationForm.Manifest) group.manifest = manifestPathOf(card);
    group.memberEdgeIds.push(member.edgeId);
    groups.set(key, group);
  }

  /*
   * Every member must classify, or the fan stays neutral.
   *
   * This is unchanged on purpose. A label over some of a fan is a claim about all of
   * it, and the reader cannot see which members the label covers. Relaxing this to
   * "group what you can" was tried and is wrong: it names a group over two of three
   * members and the third silently contradicts it.
   *
   * The one-family-dense gap is therefore NOT fixed here. It is fixed by
   * `declarationForm` recognising a manifest declaration, so that a fan the evidence
   * fully supports classifies completely. A fan that genuinely mixes a manifest with
   * an unattributable claim stays neutral, which is the honest answer.
   */
  if (classified !== members.length) return [];
  const list = [...groups.values()];
  if (!list.some((group) => group.memberEdgeIds.length > 1)) return [];

  return list
    .map((group) => {
      const paths = [...group.paths].filter(Boolean).sort();
      // The label names where the claim was written, and only that. A table in a
      // single known document is named after that document; anything vaguer stays
      // neutral rather than guessing.
      const qualifier =
        group.form === DeclarationForm.TableRow && paths.length === 1 ? tableQualifier(paths[0]) : null;
      /*
       * A manifest group is named by the manifest that declares it, and by nothing else.
       *
       * The declaring site is what the grouping axis IS, so it is the label too -- the
       * same fact, not a second inference. The qualifier falls back to the manifest's own
       * file name when the path has no usable words to qualify it with, so a group is
       * never left nameless.
       */
if (group.form === DeclarationForm.Manifest) {
        const site = group.manifest || (paths.length === 1 ? paths[0] : null);
        /*
         * Named by the directory that declares it, not by the bare file name.
         *
         * `tableQualifier` reduces `nebula_app/Cargo.toml` to "Cargo", which is the file
         * every Rust crate in the repository shares -- so a workspace crate and a nested
         * binary both became a plate labelled "Cargo", and two masses with different
         * members carried the same name. The declaring DIRECTORY is what distinguishes
         * two sites in one repository, so that is the label, and the full path stays in
         * `meta` for the row's secondary text.
         */
        const dir = site ? site.split('/').slice(0, -1).join('/') : '';
        const name = dir || (site ? (site.split('/').pop() ?? site) : null) || 'manifest';
        return {
          form: group.form,
          meta: paths.length === 1 ? paths[0] : `${paths.length} manifests`,
          label: `${name} ×${group.memberEdgeIds.length}`,
          memberEdgeIds: [...group.memberEdgeIds].sort(),
        };
      }
      return {
        form: group.form,
        // One declaring file names the place. Several are summarised rather than
        // listed, because a row's job is to say where the claim was made, not to
        // become a file index.
        meta: paths.length === 1 ? paths[0] : `${paths.length} files`,
        label:
          group.form === DeclarationForm.TableRow
            ? `${qualifier ? `${qualifier}-table` : 'Table'} references ×${group.memberEdgeIds.length}`
            : `Prose references ×${group.memberEdgeIds.length}`,
        memberEdgeIds: [...group.memberEdgeIds].sort(),
      };
    })
    // Deterministic under reordered input: by form, then label.
    // Deterministic under reordered input: by form, then by label, which now carries the
    // declaring site for manifest groups and therefore orders them by that site.
    .sort((a, b) => (a.form === b.form ? (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) : a.form < b.form ? -1 : 1));
}

/**
 * Turns a set of relationships into a plate.
 *
 * Subgroups are named only where the evidence supports it, and the plate's own label
 * says nothing beyond the relation and the count. A single member is never plated:
 * one is not a group.
 */
function aggregateFan(fan, memberIds, evidence, expanded, plates, describe) {
  const members = [...memberIds].sort().map((edgeId) => ({
    edgeId,
    card: (evidence[edgeId] || [])[0],
  }));
  const subgroups = evidenceSubgroups(members);
  const base = {
    relationshipType: fan.relationshipType,
    family: fan.family,
    status: fan.status,
    count: memberIds.length,
    memberEdgeIds: [...memberIds].sort(),
  };

  /*
   * One tie per group.
   *
   * The frozen design's own key says an aggregate is "one tie per group", so a fan
   * the evidence genuinely splits into two groups is two aggregates, not one
   * aggregate with two lines of text inside it. That is also what makes the default
   * paint composed: a single collapsed card in a data zone authored for real mass
   * read as an empty page, while two plates carry the evidence into the space the
   * design reserved for them.
   *
   * This is still presentation-only. The grouping key is where and how the claim was
   * written down, never the relationship's type, family, status or direction, and a
   * fan whose evidence does not support a split stays one neutral plate below.
   */
  if (subgroups.length > 1) {
    /*
     * Which groups become masses, and which are reported together.
     *
     * Ordered by member count and then by the group's own label, so the choice is a
     * function of the data and nothing else -- no significance, no centrality, no
     * dependence on iteration order. The loop stops as soon as the named groups account
     * for `MAJOR_GROUP_COVERAGE` of the fan, or once `MAX_MAJOR_GROUPS` masses exist,
     * whichever comes first. Six masses are therefore NOT forced: a fan that genuinely
     * has six declaring sites is six plates, and a fan with three is three.
     */
    const ordered = [...subgroups].sort((a, b) =>
      (b.memberEdgeIds.length - a.memberEdgeIds.length)
      || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    const major = [];
    let covered = 0;
    for (const group of ordered) {
      major.push(group);
      covered += group.memberEdgeIds.length;
      if (major.length >= MAX_MAJOR_GROUPS) break;
      /*
       * Coverage ends the walk only once the fan has more distinct groups than the cap
       * would ever name. A single 12-member group already clears 80% of a 14-member fan,
       * so stopping on coverage alone would demote the remaining `x2` prose group into a
       * remainder -- and a two-member group the evidence clearly supports is a plate, not
       * a remainder. So a group the evidence separates is named whenever the fan has few
       * enough groups to name them all; the remainder is for the fans that genuinely have
       * more structure than masses.
       */
      if (ordered.length > MAX_MAJOR_GROUPS
          && covered >= Math.ceil(memberIds.length * MAJOR_GROUP_COVERAGE)) break;
    }
    const majorIds = new Set(major.flatMap((group) => group.memberEdgeIds));

    /*
     * Whether the first paint shows rows or just the named masses.
     *
     * A plate opened by default carries its rows, and a stack of open plates is a tall
     * stack: the data zone is an authored column and six open structural masses run past
     * its bottom. So when a fan genuinely has several structural groups, the first paint
     * presents them as NAMED masses -- which is the whole point of the grouping, the
     * reader sees "nebula_app", "mobile/link", "third_party/winit" instead of one
     * depends_on x 97 -- and each opens on request. A fan with one or two groups still
     * opens, because two short plates fit and the first paint can carry their claims.
     */
    const openGroups = major.filter((group) => group.memberEdgeIds.length >= MIN_PLATE_SIZE).length;
    const openByDefault = openGroups <= 2;

    for (const group of major) {
      if (group.memberEdgeIds.length < MIN_PLATE_SIZE) continue;
      /*
       * The key must be unique per MASS, not per fan.
       *
       * It used to be `${fan.key}::${group.form}`, which is one key for every structural
       * group in a fan -- so several distinct masses were stored under one entry in the
       * renderer's position map and were all drawn at the same slot. The canvas then
       * reported them overlapping each other, and the renderer could only ever place the
       * last one. The group's own label identifies the declaring site, so it is what
       * distinguishes the keys.
       */
      const key = `${fan.key}::${group.form}::${group.label}`;
      plates.push({
        ...base,
        key,
        label: group.label,
        count: group.memberEdgeIds.length,
        memberEdgeIds: [...group.memberEdgeIds].sort(),
        members: [...group.memberEdgeIds].sort().map(describe),
        meta: group.meta,
        form: group.form,
        // A group plate is already named for its evidence, so it does not carry a
        // nested set of the same groups again.
        subgroups: [],
        // Open by default when the stack has room to carry the claims; closed otherwise,
        // so a many-group fan reads as named masses on the first paint. Either way
        // `expanded` is the reader asking for the rest.
        open: openByDefault,
        expanded: expanded.has(key),
      });
    }
    /*
     * The remainder, and it is explicit.
     *
     * Two things land here: a structural group too small to be a mass of its own, and any
     * further group beyond the major cap or past the coverage target. Both are real
     * relationships with real evidence, so the plate carries its true count and its own
     * member rows, and it says plainly that it is a remainder rather than reading as
     * another declaring site.
     */
    const leftover = [...memberIds].filter((id) => !majorIds.has(id)).sort();
    if (leftover.length >= MIN_PLATE_SIZE) {
      plates.push({
        ...base,
        key: fan.key,
        label: `${fan.relationLabel} remainder ×${leftover.length}`,
        count: leftover.length,
        memberEdgeIds: leftover,
        members: leftover.map(describe),
        meta: '',
        form: null,
        subgroups: [],
        open: true,
        expanded: expanded.has(fan.key),
      });
    }
    return;
  }

  plates.push({
    ...base,
    key: fan.key,
    label: `${fan.relationLabel} ×${memberIds.length}`,
    members: [...memberIds].sort().map(describe),
    meta: subgroups.length === 1 ? subgroups[0].meta : '',
    form: subgroups.length === 1 ? subgroups[0].form : null,
    subgroups,
    open: true,
    expanded: expanded.has(fan.key),
  });
}

/** One fan: the visible relationships sharing a relation type and status. */
function fanOf(edges) {
  const map = new Map();
  for (const edge of edges) {
    const key = `${edge.relationshipType}/${edge.status}`;
    const fan = map.get(key) || {
      key,
      relationshipType: edge.relationshipType,
      family: edge.family,
      status: edge.status,
      relationLabel: edge.relationLabel,
      edgeIds: [],
    };
    fan.edgeIds.push(edge.id);
    map.set(key, fan);
  }
  return [...map.values()];
}

/**
 * The composition the canvas draws: the subject, the loose relationships drawn
 * individually, and the aggregate plates.
 *
 * The budget is spent in a deterministic order, biggest fan first, so a small fan
 * is never starved by a large one that arrived earlier in the input.
 */
export function buildComposition(view, options = {}) {
  const budget = Number.isFinite(options.budget) ? options.budget : VISIBLE_OBJECT_BUDGET;
  /*
   * Relationships the regime has promoted to direct presence.
   *
   * The budget decides how much of a *fan* is drawn individually. It must not be
   * able to aggregate away a relationship the composition has deliberately chosen
   * to show: a promoted edge is drawn, and the budget applies to what is left.
   */
  const promoted = new Set(options.directEdgeIds || []);
  /*
   * Relationships that must be aggregated whatever the budget says.
   *
   * A homogeneous fan is not a direct-topology candidate at all: every peer carries
   * one identical relationship, so there is no peer that earns its own place on the
   * canvas. Left to the budget it appeared as fourteen loose edges, because the fan
   * happened to fit exactly. Room is the wrong question for this decision.
   */
  const forceAggregate = new Set(options.aggregateEdgeIds || []);
  const edges = (options.edges || []).slice();
  const evidence = view.evidenceByRelationship || {};
  const expanded = options.expandedAggregates || new Set();

  /*
   * A fan is the whole group of relationships sharing a relation and status.
   *
   * Promoted relationships leave the fan's remainder, and the remainder aggregates
   * on its own -- but the plate it produces is still about that relation, so a fan
   * of fourteen with six promoted yields one plate of eight, not two half-fans.
   */
  const fans = fanOf(edges).sort((a, b) => {
    if (b.edgeIds.length !== a.edgeIds.length) return b.edgeIds.length - a.edgeIds.length;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const looseEdgeIds = [];
  const plates = [];
  /*
   * One allowance, shared.
   *
   * Promoted relationships are drawn directly, but they occupy the field just as a
   * loose relationship does. They were previously free, which meant promotion
   * *increased* the number of direct relationships instead of trading against the
   * budget: `yunmin311/obsidian-config` promoted six and then drew the remaining
   * eight loose as well, so fourteen spokes appeared and no plate was ever made.
   */
  let remaining = Math.max(0, budget - promoted.size);

  /*
   * How a member is named in a plate row.
   *
   * The peer entity's own label, with the evidence locator beside it, so a row says
   * which claim it is rather than repeating the plate's count. The locator is the
   * evidence's, verbatim: it is the reader's way back to the line that made the
   * claim, so it must not be reformatted into something vaguer.
   */
  const subjectId = view.subject && view.subject.id;
  const edgeById = new Map((options.edges || []).map((edge) => [edge.id, edge]));
  const labelOf = new Map((view.nodes || []).map((node) => [node.id, node.label]));
  const describe = (edgeId) => {
    const edge = edgeById.get(edgeId);
    const peerId = edge ? (edge.source === subjectId ? edge.target : edge.source) : subjectId;
    const card = (evidence[edgeId] || [])[0];
    return {
      edgeId,
      label: (peerId && labelOf.get(peerId)) || (edge && edge.label) || edgeId,
      meta: (card && typeof card.locator === 'string' && card.locator) || '',
      // The member's own evidence status, so a row states its own strength instead of
      // inheriting the plate's. Read from the relationship, never inferred.
      status: edge ? edge.status : 'DECLARED',
      // Canonical direction, carried through so a renderer never has to infer it.
      directed: edge ? edge.directed : false,
    };
  };

  for (const fan of fans) {
    const remainder = fan.edgeIds.filter((id) => !promoted.has(id));
    const forced = remainder.filter((id) => forceAggregate.has(id));

    if (forced.length > 0) {
      // Aggregate what was forced, and let the rest of the fan fall through to the
      // budget: a fan can be part homogeneous and part varied.
      if (forced.length >= MIN_PLATE_SIZE) {
        aggregateFan(fan, forced, evidence, expanded, plates, describe);
        continue;
      }
      looseEdgeIds.push(...forced);
      remaining -= forced.length;
    }

    const rest = remainder.filter((id) => !forceAggregate.has(id));
    if (rest.length < MIN_PLATE_SIZE || rest.length <= remaining) {
      looseEdgeIds.push(...rest);
      remaining -= rest.length;
      continue;
    }

    aggregateFan(fan, rest, evidence, expanded, plates, describe);
  }

  /*
   * Accounting.
   *
   * `drawnEdgeIds` is what the canvas actually shows: the loose relationships, the
   * promoted ones, and every plate member. It exists because a promoted relationship
   * was previously drawn but appeared in none of the other lists, so the composition
   * could not prove it had lost nothing -- which is exactly the check that matters
   * when the budget moves relationships around.
   */
  const plateMembers = plates.flatMap((plate) => plate.memberEdgeIds);
  const drawnEdgeIds = [...new Set([...looseEdgeIds, ...promoted, ...plateMembers])].sort();

  return {
    subjectId: view.subject && view.subject.id,
    looseEdgeIds: looseEdgeIds.sort(),
    /** Promoted relationships, kept out of the budget but still drawn. */
    promotedEdgeIds: [...promoted].sort(),
    /** Everything the canvas draws, for the accounting check. */
    drawnEdgeIds,
    plates: plates.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    budget,
    /** True when nothing at all would be drawn without plates. */
    empty: looseEdgeIds.length === 0 && plates.length === 0,
  };
}

/**
 * The rows a plate shows: one per member relationship, each individually
 * selectable.
 *
 * Rows are content of their plate. They are never re-drawn as spokes from the
 * subject, which is what would turn one aggregate back into fourteen long lines.
 *
 * The member's own name and locator are shown rather than a group summary,
 * because a group summary is not a way in: with subgroups as rows, only the first
 * member of each group was reachable and the other twelve could not be selected at
 * all. Naming the members is what makes every one of them checkable.
 *
 * A plate shows a bounded number of rows and states how many it is holding back,
 * rather than growing without limit: an uncapped list is how a plate becomes the
 * thing the design was avoiding.
 */
export function plateRows(plate) {
  if (plate.open === false) return [];
  const members = plate.members && plate.members.length
    ? plate.members
    : plate.memberEdgeIds.map((edgeId) => ({ edgeId, label: '', meta: '' }));
  const shown = plate.expanded ? members : members.slice(0, PLATE_MEMBER_ROWS);
  return shown.map((member) => ({
    edgeId: member.edgeId,
    label: member.label,
    meta: member.meta || '',
    status: member.status,
    directed: member.directed,
    // A row is exactly one relationship, so the row carries one id. That is what
    // lets a reader select a specific claim rather than a group.
    memberEdgeIds: [member.edgeId],
  }));
}

/** How many member rows a plate is holding back, so the plate can say so. */
export function plateHiddenRows(plate) {
  if (plate.open === false) return 0;
  const total = plate.members && plate.members.length ? plate.members.length : plate.memberEdgeIds.length;
  if (plate.expanded) return 0;
  return Math.max(0, total - PLATE_MEMBER_ROWS);
}