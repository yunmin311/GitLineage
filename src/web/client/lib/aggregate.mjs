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

/** How a claim was written down, as far as the evidence shows. */
export const DeclarationForm = Object.freeze({
  /** A row of a table, e.g. a markdown pipe row. */
  TableRow: 'table-row',
  /** Anything else written as running text. */
  Prose: 'prose',
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
    const group = groups.get(form) || { form, paths: new Set(), memberEdgeIds: [] };
    group.paths.add(declaringPath(card));
    group.memberEdgeIds.push(member.edgeId);
    groups.set(form, group);
  }

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
    .sort((a, b) => (a.form === b.form ? (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) : a.form < b.form ? -1 : 1));
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
  const edges = (options.edges || []).slice();
  const evidence = view.evidenceByRelationship || {};
  const expanded = options.expandedAggregates || new Set();

  const fans = fanOf(edges).sort((a, b) => {
    if (b.edgeIds.length !== a.edgeIds.length) return b.edgeIds.length - a.edgeIds.length;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const looseEdgeIds = [];
  const plates = [];
  let remaining = budget;

  for (const fan of fans) {
    if (fan.edgeIds.length < MIN_PLATE_SIZE || fan.edgeIds.length <= remaining) {
      looseEdgeIds.push(...fan.edgeIds);
      remaining -= fan.edgeIds.length;
      continue;
    }

    // Over budget, so it becomes a plate. Members are the relationships that
    // carry evidence cards; a relationship without one is still a member, it
    // simply cannot contribute to a named subgroup.
    const members = [...fan.edgeIds].sort().map((edgeId) => {
      const cards = evidence[edgeId] || [];
      return { edgeId, card: cards[0] };
    });
    const subgroups = evidenceSubgroups(members);

    plates.push({
      key: fan.key,
      relationshipType: fan.relationshipType,
      family: fan.family,
      status: fan.status,
      // The neutral label claims nothing beyond the relation and the count.
      label: `${fan.relationLabel} ×${fan.edgeIds.length}`,
      count: fan.edgeIds.length,
      memberEdgeIds: [...fan.edgeIds].sort(),
      subgroups,
      expanded: expanded.has(fan.key),
    });
  }

  return {
    subjectId: view.subject && view.subject.id,
    looseEdgeIds: looseEdgeIds.sort(),
    plates: plates.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    budget,
    /** True when nothing at all would be drawn without plates. */
    empty: looseEdgeIds.length === 0 && plates.length === 0,
  };
}

/**
 * The rows a plate shows when expanded.
 *
 * Rows are content of their plate: they are not re-drawn as spokes from the
 * subject, which is what would turn one aggregate back into fourteen long lines.
 */
export function plateRows(plate) {
  if (!plate.subgroups.length) {
    return [{ label: plate.label, meta: '', memberEdgeIds: plate.memberEdgeIds }];
  }
  return plate.subgroups.map((group) => ({
    label: group.label,
    meta: group.meta,
    memberEdgeIds: group.memberEdgeIds,
  }));
}