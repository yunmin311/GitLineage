// Unified display layer; Canonical Graph remains unchanged.
import {openGitLog} from "./git-log.mjs";
import { spatialRoute, spatialExpansion } from "./spatial.mjs";
function mountRepositoryExplorer(getRepository, deep, bridge) {
  const make = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== void 0) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const btn = (id, text, fn) => {
    const n = make("button", text, "d-action");
    n.type = "button";
    if (id) n.id = id;
    n.onclick = fn;
    return n;
  };
  const svg = (tag, attrs = {}, text) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (text !== void 0) n.textContent = text;
    return n;
  };
  // One stroke vocabulary for workspace tools; names remain the accessible labels.
  const icon = (kind) => {
    const paths = {
      relations: 'M3 8h10M3 4v8M13 4v8M6 8V3h4',
      history: 'M8 3a5 5 0 1 1-4 2M3 2v4h4M8 5v3l2 2',
      structure: 'M2 4h5l2 2h5v7H2z',
      observation: 'M10 10l4 4M11 6a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
      similarity: 'M2 3h5v10H2zM9 3h5v10H9zM5 6h6M5 10h6',
      dependency: 'M3 3h4v4H3zM9 9h4v4H9zM5 7v4h4',
      back: 'M7 3 2 8l5 5M2 8h12',
      search: 'M10 10l4 4M11 6a5 5 0 1 1-10 0 5 5 0 0 1 10 0'
    };
    const n = svg('svg', {viewBox:'0 0 16 16', 'aria-hidden':'true', class:'workspace-icon', fill:'none', stroke:'currentColor', 'stroke-width':1.3, 'stroke-linecap':'round', 'stroke-linejoin':'round'});
    n.append(svg('path', {d:paths[kind] || paths.relations}));
    return n;
  };
  const nav = make("nav", void 0, "repository-navigation unified-tools");
  nav.setAttribute("aria-label", "Graph exploration tools");
  document.querySelector("#explorer").prepend(nav);
  const status = make("p", "", "rail-note");
  status.id = "workspace-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const tools = make("section", void 0, "unified-navigation");
  tools.setAttribute("aria-label", "Exploration path and tools");
  const path = make("nav", void 0, "unified-path");
  path.setAttribute("aria-label", "Exploration path");
  const search = make("input");
  search.placeholder = "Find explored objects\u2026";
  search.setAttribute("aria-label", "Find explored objects");
  search.autocomplete = "off";
  search.spellcheck = false;
  const hits = make("div", void 0, "unified-search-results");
  search.oninput = () => {
    hits.replaceChildren();
    if (!search.value.trim()) return;
    for (const n of allNodes().filter((n2) => [n2.label, n2.data?.path, n2.kind].join(" ").toLowerCase().includes(search.value.toLowerCase())).slice(0, 12)) hits.append(btn("", n.label, () => focus(n.id)));
  };
  const layers = make("div", void 0, "unified-layer-controls");
  const searchField = make("label", void 0, "workspace-search");
  searchField.append(icon('search'), search);
  tools.append(make("h3", "Exploration path"), path, searchField, hits, make("h3", "Visible objects"), layers, status);
  const discovery = make("section", void 0, "workspace-discovery-controls");
  discovery.id = "workspace-discovery";
  discovery.hidden = true;
  for (const n of [...deep.dialog.children]) if (!n.matches("header")) discovery.append(n);
  deep.dialog.hidden = true;
  deep.launcher.remove();
  deep.layerLauncher.hidden = true;
  let root = "", rootRevision = "", generation = 0, busy = false, objects = new Map(), links = new Map(), positions = new Map(), collapsed = new Set(), hiddenLayers = new Set(), jobs = new Map(), history = [], trail = [], rootCamera = null, restoring = null;
  let discoveryTarget = "", baselinePending = false;
  const kinds = [["structure", "Structure"], ["dependency", "Dependencies"], ["observation", "Candidates"], ["similarity", "File matches"]];
  const limit = () => innerWidth < 768 ? 5 : 8;
  const key = () => `gitlineage.workspace.v2:${root.toLowerCase()}`;
  const jobKey = (repo) => repo.toLowerCase();
  const sha = (value) => typeof value === "string" ? value : value?.sha ?? "";
  const ref = (repo, revision2, kind, value = "") => `display:${encodeURIComponent(repo.toLowerCase())}:${revision2}:${kind}:${encodeURIComponent(value)}`;
  const rootId = () => bridge.root()?.id;
  function repoNode(repo) {
    return bridge.nodes().find((n) => n.label.toLowerCase() === repo.toLowerCase())?.id ?? ref(repo, "", "repository");
  }
  function node(id, label, kind, data) {
    data = { ...data, revision: sha(data?.revision) };
    if (!objects.has(id)) objects.set(id, { id, label, kind, data });
    else objects.get(id).data = { ...objects.get(id).data, ...data };
    return id;
  }
  function edge(from, to, kind, label, data = {}, directed = false) {
    const id = JSON.stringify([from, to, kind, data.measurement?.method ?? ""]);
    links.set(id, { id, source: from, target: to, kind, label, data, directed });
    return id;
  }
  function allNodes() {
    return [...bridge.nodes(), ...objects.values()];
  }
  function find(id) {
    return objects.get(id) ?? bridge.nodes().find((n) => n.id === id);
  }
  function repositoryOf(id) {
    const n = find(id);
    return n?.data?.repository ?? (n?.type === "Repository" || n?.kind === "repository" ? n.label : root);
  }
  function save() {
    if (!root) return;
    try {
      const value = { version: 2, root, revision: bridge.revision(), objects: [...objects], links: [...links], positions: [...positions], canonicalPositions: bridge.positions?.(), compact: innerWidth < 768, collapsed: [...collapsed], hiddenLayers: [...hiddenLayers], jobs: [...jobs], history, trail, rootCamera, camera: bridge.camera(), selected: bridge.selected() };
      const data = JSON.stringify(value);
      if (data.length < 2e6) sessionStorage.setItem(key(), data);
    } catch {
    }
  }
  function reset() {
    const repo = getRepository(), name = typeof repo === "string" ? repo : repo ? `${repo.owner}/${repo.name}` : "";
    if (!name || name === root && rootRevision === bridge.revision() || !bridge.root()) return;
    generation++;
    root = name;
    rootRevision = bridge.revision();
    objects.clear();
    links.clear();
    positions.clear();
    collapsed.clear();
    hiddenLayers.clear();
    jobs.clear();
    history = [];
    trail = [];
    rootCamera = bridge.camera();
    baselinePending = true;
    restoring = null;
    busy = false;
    discoveryTarget = name;
    deep.workspace.reset(name);
    try {
      const saved = JSON.parse(sessionStorage.getItem(key()) || "null");
      if (saved?.version === 2 && saved.revision === bridge.revision()) {
        objects = new Map(saved.objects);
        links = new Map(saved.links);
        positions = new Map(saved.positions);
        collapsed = new Set(saved.collapsed);
        hiddenLayers = new Set(saved.hiddenLayers);
        jobs = new Map(saved.jobs);
        history = saved.history;
        trail = saved.trail;
        rootCamera = saved.rootCamera;
        baselinePending = false;
        restoring = saved;
      }
    } catch {
    }
  }
  function checkpoint(id) {
    history.push({ camera: bridge.camera(), selected: bridge.selected(), trail: [...trail], collapsed: [...collapsed], hiddenLayers: [...hiddenLayers] });
    if (history.length > 60) history.shift();
    if (id && trail.at(-1) !== id) trail.push(id);
  }
  function focus(id) {
    checkpoint(id);
    // Search also reveals a previously collapsed or filtered observation path.
    const pending = [id], seen = new Set();
    while (pending.length) {
      const target = pending.pop();
      if (seen.has(target)) continue;
      seen.add(target);
      for (const relation of links.values()) if (relation.target === target) {
        collapsed.delete(relation.source);
        hiddenLayers.delete(relation.kind);
        pending.push(relation.source);
      }
    }
    bridge.select(id);
    bridge.focus(id, [...links.values()].find(e => e.target === id && e.kind === "structure")?.source);
    refresh();
  }
  function back() {
    const p = history.pop();
    if (!p) return;
    trail = p.trail;
    collapsed = new Set(p.collapsed);
    hiddenLayers = new Set(p.hiddenLayers ?? []);
    bridge.select(p.selected);
    bridge.restore(p.camera);
    refresh(false);
  }
  function returnRoot() {
    checkpoint(rootId());
    bridge.select(rootId());
    if (rootCamera) bridge.restore(rootCamera);
    refresh(false);
  }
  function refresh(redraw = true) {
    if (redraw) bridge.draw();
    bridge.drawer();
    decorate();
    save();
  }
  async function request(suffix, data) {
    const response = await fetch("/api/explore" + suffix, data === void 0 ? {} : { method: "POST", headers: { "content-type": "application/json", "x-gitlineage-csrf": "1" }, body: JSON.stringify(data) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Exploration unavailable");
    return value;
  }
  async function operate(fn) {
    if (busy) {
      status.textContent = "An exploration is already running.";
      return;
    }
    const token = generation;
    busy = true;
    status.textContent = "Reading fixed Git objects\u2026";
    try {
      await fn(token);
      if (token !== generation) return;
      status.textContent = "Objects added to this graph. Unopened contents remain unknown.";
      refresh();
    } catch (error) {
      if (token === generation) status.textContent = error.message;
    } finally {
      if (token === generation) {
        busy = false;
        decorate();
      }
    }
  }
  async function ensure(repo, token) {
    let task = jobs.get(jobKey(repo));
    const previousLimit = task?.displayHistoryLimit;
    if (task) {
      try {
        task = await request("/" + task.id);
      } catch {
        task = null;
      }
    }
    if (!task) task = await request("", { repository: repo });
    while (task.state === "running") {
      await new Promise((r) => setTimeout(r, 250));
      if (token !== generation) throw new Error("Repository changed");
      task = await request("/" + task.id);
    }
    if (token !== generation) throw new Error("Repository changed");
    if (!task.revision) throw new Error(task.error || "Fixed identity unavailable");
    if (previousLimit) task.displayHistoryLimit = previousLimit;
    jobs.set(jobKey(repo), task);
    if (repoNode(repo) !== rootId()) node(repoNode(repo), repo, "repository", { repository: repo, revision: task.revision });
    return task;
  }
  async function revision(task, sha2, token) {
    if (sha2 && task.revision !== sha2) task = await request(`/${task.id}/revision`, { sha: sha2 });
    if (token !== generation) throw new Error("Repository changed");
    jobs.set(jobKey(task.repository), task);
    return task;
  }
  function changedFiles(task, commit) {
    const cid = ref(task.repository, "", "commit", commit.sha);
    for (const file of commit.changes.slice(0, limit())) {
      const fid = node(ref(task.repository, commit.sha, "file", file.path), file.path.split("/").pop(), "file", { ...file, repository: task.repository, revision: commit.sha, path: file.path, fromCommit: commit.sha });
      edge(cid, fid, "structure", "changed file", { ...file, revision: commit.sha });
    }
    if (commit.changes.length > limit()) status.textContent = `${limit()} of ${commit.changes.length} sampled changes shown; open the commit inspector for more.`;
  }
  function directoryNodes(task, folder = "", count = limit()) {
    const did = node(ref(task.repository, task.revision, "directory", folder), folder ? folder.split("/").pop() : "Tree @ " + task.revision.slice(0, 7), "directory", { repository: task.repository, revision: task.revision, path: folder });
    const c = ref(task.repository, "", "commit", task.revision);
    if (!folder) edge(repoNode(task.repository), did, "structure", "tree at version");
    else {
      const parent = ref(task.repository, task.revision, "directory", folder.split("/").slice(0, -1).join("/"));
      if (objects.has(parent)) edge(parent, did, "structure", "contains directory");
    }
    const d = task.directories.find((d2) => d2.path === folder);
    if (!d) return did;
    const selected = d.entries.slice(0, count);
    for (const entry of selected) {
      const p = folder ? folder + "/" + entry.path : entry.path, kind = entry.type === "tree" ? "directory" : entry.type === "commit" ? "submodule" : "file";
      const child = node(ref(task.repository, task.revision, kind, p), entry.path, kind, { ...entry, repository: task.repository, revision: task.revision, path: p });
      edge(did, child, "structure", entry.type === "tree" ? "contains directory" : "contains " + kind, { tree: d.sha, object: entry.sha });
    }
    objects.get(did).data = { ...objects.get(did).data, shown: selected.length, total: d.entries.length, sha: d.sha };
    collapsed.delete(did);
    return did;
  }
  function readHistory(id = rootId()) {
    const repo=repositoryOf(id),camera=bridge.camera(),selected=bridge.selected();
    const show=task=>openGitLog(task,{close:()=>{bridge.select(selected);bridge.restore(camera);},more:()=>void operate(async token=>{const t=await request(`/${task.id}/history`,{});if(token!==generation)return;jobs.set(jobKey(repo),t);show(t);}),exploreFile:(commit,file)=>{
      checkpoint(id);const fid=node(ref(repo,commit.sha,"file",file.path),file.path.split("/").pop(),"file",{...file,path:file.path,repository:repo,revision:commit.sha,fromCommit:commit.sha});
      edge(repoNode(repo),fid,"structure","changed file at commit",{commit:commit.sha,...file});refresh();focus(fid);
    }});
    void operate(async token=>{const task=await ensure(repo,token);show(task);});
  }
  function readStructure(id = rootId()) {
    checkpoint(id);
    const n = find(id), repo = repositoryOf(id);
    void operate(async (token) => {
      let task = await ensure(repo, token);
      task = await revision(task, n?.kind === "commit" ? n.data.sha : n?.data?.revision, token);
      directoryNodes(task);
      collapsed.delete(id);
    });
  }
  function expand(id) {
    const n = find(id);
    if (!n) return;
    if (n.kind === "candidate" || n.kind === "repository" || n.type === "Repository") {
      if(bridge.grow)void bridge.grow(id);readStructure(id);
      return;
    }
    checkpoint(id);
    void operate(async (token) => {
      let task = await ensure(n.data.repository, token);
      if (n.kind === "commit") {

        changedFiles(task, n.data);
        collapsed.delete(id);
      } else if (n.kind === "branch") {
        task = await revision(task, n.data.sha, token);

        collapsed.delete(id);
      } else if (n.kind === "directory") {
        task = await revision(task, n.data.revision, token);
        if (n.data.path && !task.directories.some((d) => d.path === n.data.path)) task = await request(`/${task.id}/directory`, { path: n.data.path });
        if (token !== generation) return;
        jobs.set(jobKey(task.repository), task);
        directoryNodes(task, n.data.path, (n.data.shown || 0) + limit());
      } else if (n.kind === "file") {
        task = await revision(task, n.data.revision, token);
        const parts = n.data.path.split("/");
        parts.pop();
        let folder = "";
        directoryNodes(task);
        for (const part of parts) {
          folder = folder ? folder + "/" + part : part;
          if (!task.directories.some((d) => d.path === folder)) task = await request(`/${task.id}/directory`, { path: folder });
          if (token !== generation) return;
          directoryNodes(task, folder);
        }
        const did = ref(task.repository, task.revision, "directory", folder);
        if (task.directories.find((d) => d.path === folder)?.entries.some((e) => e.type === "blob" && e.path === n.data.path.split("/").pop())) edge(did, id, "structure", "contains file", { revision: task.revision });


        jobs.set(jobKey(task.repository), task);
      }
      collapsed.delete(id);
    });
  }
  function collapse(id) {
    checkpoint(id);
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    refresh();
  }
  const lineageTool = btn("workspace-origins", "Repository relations", () => {
    discovery.hidden = true;
    bridge.origins();
    decorate();
  });
  nav.append(lineageTool, btn("workspace-history", "Open Git history", () => readHistory(rootId())), btn("workspace-structure", "Expand structure", () => readStructure(bridge.selected() || rootId())), btn("workspace-candidates", "Find related projects", () => {
    discovery.hidden = !discovery.hidden;
    const repo = repositoryOf(bridge.selected() || rootId());
    if (repo !== discoveryTarget) {
      deep.workspace.reset(repo);
      discoveryTarget = repo;
    }
    decorate();
    bridge.navigation();
  }), btn("workspace-return", "Return to repository", returnRoot));
  const shortLabels = { "workspace-origins": "Relations", "workspace-history": "Git history", "workspace-structure": "Structure", "workspace-candidates": "Discover", "workspace-return": "Return" };
  for (const b of nav.children) {
    const full = b.textContent;
    b.setAttribute("aria-label", full);
    const kind = {'workspace-origins':'relations','workspace-history':'history','workspace-structure':'structure','workspace-candidates':'observation','workspace-return':'back'}[b.id];
    b.replaceChildren(icon(kind), make("span", full, "unified-label-full"), make("span", shortLabels[b.id], "unified-label-short"));
  }
  function decorate() {
    reset();
    const host = innerWidth < 768 ? document.querySelector("#mobile-relation-list") : document.querySelector("#rail-scroll");
    if (host) {
      host.prepend(tools);
      tools.append(discovery);
    }
    path.replaceChildren(btn("workspace-back", "Back", back));
    path.firstChild.disabled = !history.length;
    path.firstChild.prepend(icon("back"));
    path.append(btn("", root, returnRoot));
    for (const id of trail.slice(-5)) {
      const n = find(id);
      if (n && id !== rootId()) path.append(btn("", n.label, () => focus(id)));
    }
    layers.replaceChildren();
    for (const [k, label] of kinds) {
      const b = btn("", label, () => {
        if (k === "dependency") {
          bridge.dependencies(!bridge.dependencyEnabled());
        } else {
          hiddenLayers.has(k) ? hiddenLayers.delete(k) : hiddenLayers.add(k);
        }
        refresh();
      });
      b.setAttribute("aria-pressed", String(k === "dependency" ? bridge.dependencyEnabled() : !hiddenLayers.has(k)));
      b.dataset.layer = k;
      b.prepend(icon(k));
      const indicator = make('span', '', 'layer-indicator');
      indicator.setAttribute('aria-hidden', 'true');
      b.append(indicator);
      layers.append(b);
    }
    for (const b of nav.children) b.disabled = busy && b.id !== "workspace-return";
  }
  function visible(canonicalPositions) {
    const enabled = [...links.values()].filter((e) => !hiddenLayers.has(e.kind));
    const roots = new Set(canonicalPositions ? canonicalPositions.keys() : bridge.nodes().map((n) => n.id)), shown = new Set(roots);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of enabled) if (shown.has(e.source) && !collapsed.has(e.source) && !shown.has(e.target)) {
        shown.add(e.target);
        changed = true;
      }
    }
    return { nodes: [...objects.values()].filter((n) => shown.has(n.id)), edges: enabled.filter((e) => shown.has(e.source) && shown.has(e.target) && !collapsed.has(e.source)) };
  }
  function paint(canvas, canonicalPositions) {
    reset();
    const scene = visible(canonicalPositions);
    const connected = scene.nodes.filter((n) => scene.edges.some((e) => e.target === n.id || e.source === n.id));
    const occupied = spatialExpansion({anchors:canonicalPositions,nodes:connected,edges:scene.edges,previous:positions,compact:window.innerWidth<768});
    for(const n of connected)if(occupied.has(n.id))positions.set(n.id,occupied.get(n.id));
    const edgeLayer = svg("g", { class: "unified-edge-layer" }), nodeLayer = svg("g", { class: "unified-node-layer" });
    const defs = svg("defs");
    defs.append(svg("marker", { id: "display-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }));
    defs.firstChild.append(svg("path", { d: "M0 0 L10 5 L0 10 z", fill: "var(--brand)" }));
    canvas.append(defs);
    for (const e of scene.edges) {
      const peers = scene.edges.filter((p) => p.source === e.source && p.target === e.target);
      const sourcePoint=occupied.get(e.source),vertical=Math.abs(Math.cos(sourcePoint?.angle??0))<.7;
      const outgoing=scene.edges.filter(p=>p.source===e.source).sort((a,b)=>{const pa=occupied.get(a.target),pb=occupied.get(b.target);return vertical?((pa?.x??0)-(pb?.x??0)||(pa?.y??0)-(pb?.y??0)):(pa?.y??0)-(pb?.y??0);});
      const route = spatialRoute(e, occupied, outgoing.indexOf(e), outgoing.length);
      if (!route) continue;
      const g = svg("g", { class: "unified-edge kind-" + e.kind + (bridge.selected() === e.id ? " is-selected" : ""), role: "button", tabindex: 0, "aria-label": e.label, "data-display-edge": e.id, "data-source": e.source, "data-target": e.target });
      g.append(svg("path", { d: route.path, class: "unified-line", "marker-end": e.directed ? "url(#display-arrow)" : "none" }), svg("title", {}, e.label));
      const hit = svg("path", { d: route.path, class: "edge-hit" });
      hit.addEventListener("click", (event) => {
        event.stopPropagation();
        bridge.select(e.id, true);
      });
      g.append(hit);
      g.onkeydown = event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          bridge.select(e.id, true);
        }
      };
      if (bridge.selected() === e.source || bridge.selected() === e.target || bridge.selected() === e.id) g.append(svg("text", { x: route.label.x, y: route.label.y - 9, class: "unified-edge-label" }, e.label));
      edgeLayer.append(g);
    }
    for (const n of connected) {
      const p = occupied.get(n.id);
      if (!p || canonicalPositions.has(n.id)) continue;
      const selected = bridge.selected() === n.id, g = svg("g", { class: `node unified-node kind-${n.kind}${selected ? " is-selected" : ""}`, "data-node-id": n.id, "data-kind": n.kind, role: "button", tabindex: 0, "aria-label": n.kind + ": " + n.label });
      const radius = n.kind === "commit" ? 20 : n.kind === "branch" ? 12 : 3;
      g.append(svg("rect", { x: p.x - 105, y: p.y - 23, width: 216, height: 52, rx: radius, class: "workspace-shadow" }), svg("rect", { x: p.x - 108, y: p.y - 26, width: 216, height: 52, rx: radius, class: "node-box" }));
      const label = svg("text", { x: p.x - 98, y: p.y - 3, class: "node-label" }, n.label), meta = svg("text", { x: p.x - 98, y: p.y + 15, class: "node-fact" }, n.kind + (n.data?.revision ? " \xB7 " + n.data.revision.slice(0, 7) : "") + (n.kind === "candidate" ? " \xB7 lineage unverified" : ""));
      g.append(label, meta, svg("title", {}, n.label));
      if (n.kind === "file") g.append(svg("path", { d: `M${p.x+88} ${p.y-26} v12 h20`, class: "unified-file-fold" }));
      if (n.kind === "directory") g.append(svg("path", { d: `M${p.x - 108} ${p.y - 17} h18 l6 -8 h22`, class: "unified-directory-tab" }));
      const hit = svg("rect", { x: p.x - 108, y: p.y - 26, width: 216, height: 52, fill: "transparent", class: "node-hit" });
      hit.onclick = (e) => {
        e.stopPropagation();
        bridge.select(n.id);
      };
      g.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          bridge.select(n.id);
        }
      };
      g.append(hit);
      nodeLayer.append(g);
      canonicalPositions.set(n.id, p);
    }
    canvas.prepend(edgeLayer);
    canvas.append(nodeLayer);
    decorate();
    if (restoring) {
      const snapshot = restoring;
      restoring = null;
      queueMicrotask(() => {
        bridge.restorePositions?.(snapshot.canonicalPositions, snapshot.compact);
        // Restoration is not a second user tap on the selected object.
        bridge.select(snapshot.selected, links.has(snapshot.selected), true);
        bridge.restore(snapshot.camera);
      });
    }
  }
  function inspector(id) {
    const n = objects.get(id), e = links.get(id);
    if (!n && !e) return null;
    const block = make("section", void 0, "unified-inspector");
    block.append(make("p", n ? n.kind.charAt(0).toUpperCase() + n.kind.slice(1) : "Recorded relationship", "d-eyebrow"), make("h2", n?.label ?? e.label, "d-head"));
    if (e) {
      block.append(make("p", e.kind === "observation" ? "Search observation. This connection records a candidate result, not ancestry." : e.kind === "similarity" ? "Measurement of selected files only. This does not prove derivation." : e.kind === "history" ? "Recorded Git parent or reference relation." : "Structure and changed-file observations at a fixed version.", "d-quote"), make("p", (find(e.source)?.label ?? e.source) + (e.directed ? " \u2192 " : " — ") + (find(e.target)?.label ?? e.target), "rail-note"));
      const detail = make("details", void 0, "workspace-technical");
      detail.append(make("summary", "Recorded details"), make("pre", JSON.stringify(e.data, null, 2)));
      if (e.kind === "similarity") {
        const m = e.data.measurement;
        block.append(make("p", `${m.method} \xB7 ${m.score == null ? "unavailable" : (m.score * 100).toFixed(2) + "%"} \xB7 ${m.state}`, "d-quote"), make("p", `${m.firstPath} \u2194 ${m.secondPath}`, "rail-note"));
        for (const f of (e.data.fragments ?? []).slice(0, 4)) block.append(make("pre", `Target: ${f.targetText}
Candidate: ${f.candidateText}`, "workspace-fragment"));
      }
      block.append(detail);
      return block;
    }
    block.append(make("p", (n.data.repository || n.kind) + (n.data.revision ? " \xB7 pinned version " + n.data.revision.slice(0, 7) : ""), "d-sub"));
    if(n.data.path){
      const hierarchy=make("div",void 0,"d-hierarchy");hierarchy.append(make("p","STRUCTURE PATH","d-block-head"));
      const path=make("ol");path.append(make("li",n.data.repository||"Repository"));
      const segments=n.data.path.split("/").filter(Boolean);for(let i=0;i<segments.length;i++)path.append(make("li",segments[i],i===segments.length-1?"hierarchy-scope":"hierarchy-sites"));
      hierarchy.append(path);block.append(hierarchy);
    }
    const actions = make("div", void 0, "unified-node-actions");
    actions.append(btn("workspace-expand", "Expand nearby objects", () => expand(id)), btn("workspace-focus", "Focus here", () => focus(id)), btn("workspace-collapse", collapsed.has(id) ? "Restore neighborhood" : "Collapse neighborhood", () => collapse(id)));
    block.append(actions);
    if (["repository", "candidate", "commit"].includes(n.kind)) actions.append(btn("workspace-node-history", "Open Git history", () => readHistory(id)), btn("workspace-node-structure", "Expand structure at version", () => readStructure(id)));
    if (n.kind === "commit") {
      block.append(make("p", n.data.message, "d-quote"), make("p", `${n.data.author} \xB7 ${n.data.date}`, "rail-note"));
      const task = jobs.get(jobKey(n.data.repository));
      if (task) {
        actions.append(btn("workspace-earlier", "Expand recorded parents", () => void operate(async (token) => {
          const shown = jobs.get(jobKey(n.data.repository))?.displayHistoryLimit ?? limit();
          let t = await ensure(n.data.repository, token);
          if (t.coverage.pendingParents.length) t = await request(`/${t.id}/history`, {});
          if (token !== generation) return;
          t.displayHistoryLimit = Math.min(t.commits.length, shown + limit());
          jobs.set(jobKey(t.repository), t);

        })));
        if (n.data.changes.length > limit()) actions.append(btn("workspace-more-files", "Expand more sampled changes", () => {
          n.data.changeOffset = (n.data.changeOffset ?? limit()) + limit();
          const c = { ...n.data, changes: n.data.changes.slice(n.data.changeOffset - limit(), n.data.changeOffset) };
          changedFiles(task, c);
          refresh();
        }));
      }
    }
    if (n.kind === "file") {
      const a = make("a", "Open pinned source", "d-src");
      a.href = `https://github.com/${n.data.repository}/blob/${n.data.revision}/${n.data.path.split("/").map(encodeURIComponent).join("/")}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      block.append(a);
      actions.append(btn("workspace-file-candidates", "Find cross-repository evidence", () => {
        discovery.hidden = false;
        deep.workspace.reset(n.data.repository);
        discoveryTarget = n.data.repository;
        decorate();
        bridge.navigation();
      }));
    }
    if (n.kind === "directory") block.append(make("p", n.data.total === void 0 ? "Contents not read." : `${n.data.shown} of ${n.data.total} verified entries shown. Expand adds a bounded neighborhood.`, "rail-note"));
    if (n.kind === "candidate") {
      block.append(make("p", "Candidate observation \xB7 lineage unverified", "deep-warning"));
      for (const d of n.data.observation?.discoveries ?? []) block.append(make("p", d.reason, "d-quote"));
    }
    const matches = [...links.values()].filter((e2) => e2.kind === "similarity" && (e2.source === id || e2.target === id));
    for (const match of matches) actions.append(btn("", match.label + " \xB7 read evidence", () => bridge.select(match.id, true)));
    const details = make("details", void 0, "workspace-technical");
    details.append(make("summary", "Technical identity & recorded details"), make("pre", JSON.stringify(n.data, null, 2)));
    block.append(details);
    return block;
  }
  function repositoryActions(id) {
    const n = find(id);
    if (n?.type !== "Repository") return null;
    const b = make("section", void 0, "unified-node-actions");
    b.append(btn("workspace-node-history", "Open Git history", () => readHistory(id)), btn("workspace-node-structure", "Expand structure", () => readStructure(id)), btn("workspace-node-collapse", "Collapse local observations", () => collapse(id)));
    return b;
  }
  deep.workspace.subscribe(() => {
    reset();
    const { parent, current, sourceTask } = deep.workspace.state;
    if (!parent?.search?.target?.identity) return;
    const target = parent.search.target.identity, rid = repoNode(target.fullName);
    if (!bridge.nodes().some((n) => n.id === rid)) node(rid, target.fullName, "repository", { repository: target.fullName, revision: target.revision });
    for (const c of parent.search.result.candidates) {
      const id = repoNode(c.candidate.fullName);
      if (id !== rootId()) node(id, c.candidate.fullName, "candidate", { repository: c.candidate.fullName, revision: c.candidate.revision, observation: c });
      edge(rid, id, "observation", "candidate observation", c);
    }
    for (const r of sourceTask?.sources?.repositories ?? []) {
      const repo = repoNode(r.fullName);
      for (const f of r.files.filter((f2) => f2.selectable).slice(0, limit())) {
        const fid = node(ref(r.fullName, r.revision, "file", f.path), f.path.split("/").pop(), "file", { ...f, repository: r.fullName, revision: r.revision });
        edge(repo, fid, "structure", "listed source file", { coverage: r.coverage });
      }
    }
    for (const result of current?.comparison?.content.comparisons ?? []) {
      const repo = result.candidate?.candidate;
      if (!repo) continue;
      for (const m of result.candidate.similarity ?? []) {
        const a = ref(result.candidate.target.fullName, result.candidate.target.revision, "file", m.firstPath), b = ref(repo.fullName, repo.revision, "file", m.secondPath);
        if (objects.has(a) && objects.has(b)) edge(a, b, "similarity", `${m.method} \xB7 ${m.score == null ? "unavailable" : (m.score * 100).toFixed(2) + "%"}`, { measurement: m, fragments: current.fragments?.filter((f) => f.repositoryId === repo.repositoryId && f.method === m.method && f.firstPath === m.firstPath && f.secondPath === m.secondPath), lineageClaim: "none" });
      }
    }
    refresh();
  });
  addEventListener("pagehide", save);
  const controller = { settle() {
    if (baselinePending) {
      rootCamera = bridge.camera();
      baselinePending = false;
      save();
    }
  }, paint, decorate, inspector, repositoryActions, has: (id) => objects.has(id) || links.has(id), name: (id) => objects.get(id)?.label ?? links.get(id)?.label, search: (query) => visible().nodes.filter((n) => n.label.toLowerCase().includes(query.toLowerCase())).map((n) => n.id), save, reset, focus, expand };
  decorate();
  bridge.draw();
  return controller;
}
export {
  mountRepositoryExplorer
};
