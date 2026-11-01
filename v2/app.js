/* Fantasy NBA Model — v2 site. Static: data/*.json are built daily by
   src/site2/build.py; everything is scored here, in the browser, under the
   visitor's ACTIVE league (League tab, saved in localStorage). */
(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fx = (v, nd = 1) => (v == null || isNaN(v) ? "-" : v.toFixed(nd));
const sg = (v, nd = 1) => (v == null || isNaN(v) ? "-" : (v > 0 ? "+" : "") + v.toFixed(nd));
const clone = (o) => JSON.parse(JSON.stringify(o));

let META, PLAYERS, BYID = {}, STATS, TEAMLEFT = {}, GAMES = null, GAMES_P = null;
const SI = {};                       // stat name -> index in a stat line

// ================================================================ LEAGUES
const KEY = "fnba.v2.leagues";
const BASE_SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL", "BE", "IR"];
const ALL_SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "SG/SF", "G/F", "PF/C", "F/C", "UTIL", "BE", "IR"];
const STAT_LBL = {PTS: "PTS", FGM: "FGM", FGA: "FGA", FTM: "FTM", FTA: "FTA", FG3M: "3PM",
  REB: "REB", OREB: "OREB", AST: "AST", STL: "STL", BLK: "BLK", TOV: "TOV"};
// ESPN fantasy basketball stat ids (verified against our game logs, 2026-09-26)
const ESPN_STAT = {0: "PTS", 1: "BLK", 2: "STL", 3: "AST", 4: "OREB", 5: "DREB", 6: "REB",
  11: "TOV", 13: "FGM", 14: "FGA", 15: "FTM", 16: "FTA", 17: "FG3M", 37: "DD", 38: "TD", 39: "QD"};
const ESPN_UNMOD = {7: "ejections", 8: "flagrant fouls", 9: "personal fouls", 10: "technical fouls",
  12: "disqualifications", 18: "3-point attempts", 19: "FG%", 20: "FT%", 21: "3P%", 40: "minutes"};
const ESPN_SLOT = {0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C", 5: "G", 6: "F", 7: "SG/SF",
  8: "G/F", 9: "PF/C", 10: "F/C", 11: "UTIL", 12: "BE", 13: "IR"};

let STORE, L, DRAFT;
function readStore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
  if (!s || !s.list || !Object.keys(s.list).length) {
    const d = clone(META.league);
    d.key = "espn-" + d.id;
    s = {active: d.key, list: {[d.key]: d}};
  }
  if (!s.list[s.active]) s.active = Object.keys(s.list)[0];
  return s;
}
function writeStore() {
  try { localStorage.setItem(KEY, JSON.stringify(STORE)); return true; } catch (e) { return false; }
}
const rostered = (lg) => Object.entries(lg.slots).reduce((a, [k, v]) => a + (k === "IR" ? 0 : +v || 0), 0);
const starters = (lg) => Object.entries(lg.slots).reduce((a, [k, v]) => a + (k === "IR" || k === "BE" ? 0 : +v || 0), 0);

// fantasy points per game of a stat line under the ACTIVE league;
// bp = [double-double, triple-double, quadruple-double] rates
function fpg(s, bp) {
  if (!s) return null;
  let v = 0;
  for (let i = 0; i < STATS.length; i++) v += (s[i] || 0) * (L.w[STATS[i]] || 0);
  if (bp) {
    const d = bp[0] || 0, t = bp[1] || 0, q = bp[2] || 0, b = L.b;
    v += L.cum ? d * (b.DD || 0) + t * (b.TD || 0) + q * (b.QD || 0)
               : (d - t) * (b.DD || 0) + (t - q) * (b.TD || 0) + q * (b.QD || 0);
  }
  return v;
}

function fillLeaguePicker() {
  const sel = $("lgsel");
  sel.innerHTML = Object.values(STORE.list).map((lg) =>
    `<option value="${esc(lg.key)}"${lg.key === STORE.active ? " selected" : ""}>${esc(lg.name || lg.key)}</option>`).join("");
}
function setActive(key) {
  STORE.active = key;
  writeStore();
  L = clone(STORE.list[key]);
  DRAFT = clone(L);
  fillLeaguePicker();
  renderLeagueForm();
  renderAll();
}

function lgMsg(kind, html) { $("lg-msg").innerHTML = html ? `<div class="msg ${kind}">${html}</div>` : ""; }

function renderLeagueForm() {
  const d = DRAFT;
  $("lg-espn").value = d.id || "";
  $("lg-name").value = d.name || "";
  $("lg-teams").value = d.teams;
  $("lg-adds").value = d.adds ?? "";
  $("lg-po1").value = (d.playoff_weeks || [])[0] ?? "";
  $("lg-po2").value = (d.playoff_weeks || [])[1] ?? "";
  const shown = ALL_SLOTS.filter((s) => BASE_SLOTS.includes(s) || (d.slots[s] || 0) > 0);
  $("lg-slots").innerHTML = shown.map((s) =>
    `<div class="ctl"><label for="sl-${s}">${s}</label><input id="sl-${s}" data-slot="${s}" type="number" min="0" max="15" value="${d.slots[s] || 0}"></div>`).join("");
  $("lg-scoring").innerHTML = STATS.map((s) =>
    `<div class="ctl"><label for="sc-${s}">${STAT_LBL[s]}</label><input id="sc-${s}" data-stat="${s}" type="number" step="0.5" value="${d.w[s] ?? 0}"></div>`).join("");
  $("lg-bonus").innerHTML = [["DD", "Double-double"], ["TD", "Triple-double"], ["QD", "Quad-double"]].map(([k, lbl]) =>
    `<div class="ctl"><label for="bo-${k}">${lbl}</label><input id="bo-${k}" data-bonus="${k}" type="number" step="0.5" value="${d.b[k] ?? 0}"></div>`).join("");
  $("lg-cum").checked = !!d.cum;
  $("lg-unmod").innerHTML = (d.unmod && d.unmod.length)
    ? "This league also scores " + d.unmod.map(esc).join(", ") + " &mdash; the model does not project " +
      (d.unmod.length > 1 ? "those" : "that") + ", so it is left out of every number here."
    : "";
  rosterNote();
  $("lg-del").textContent = Object.keys(STORE.list).length > 1 ? "Delete this league" : "Reset to default";
  $("lg-state").textContent = STORE.list[d.key] ? (d.key === STORE.active ? "Active league" : "Saved") : "Not saved yet";
}
function rosterNote() {
  const d = readForm(true);
  $("lg-roster-note").textContent = `${starters(d)} starters + ${(d.slots.BE || 0)} bench = ${rostered(d)} rostered per team; ` +
    `${d.teams} teams roster the top ${d.teams * rostered(d)} players (the waiver line on the Projections tab).`;
}
function readForm(quiet) {
  const d = clone(DRAFT);
  d.id = ($("lg-espn").value || "").trim() || d.id || "";
  d.name = ($("lg-name").value || "").trim() || "My league";
  d.teams = Math.max(2, parseInt($("lg-teams").value, 10) || 8);
  d.adds = $("lg-adds").value === "" ? null : parseInt($("lg-adds").value, 10);
  const p1 = parseInt($("lg-po1").value, 10), p2 = parseInt($("lg-po2").value, 10);
  d.playoff_weeks = isNaN(p1) ? null : [p1, isNaN(p2) ? p1 : p2];
  document.querySelectorAll("#lg-slots input").forEach((el) => { d.slots[el.dataset.slot] = Math.max(0, parseInt(el.value, 10) || 0); });
  document.querySelectorAll("#lg-scoring input").forEach((el) => { d.w[el.dataset.stat] = parseFloat(el.value) || 0; });
  document.querySelectorAll("#lg-bonus input").forEach((el) => { d.b[el.dataset.bonus] = parseFloat(el.value) || 0; });
  d.cum = $("lg-cum").checked;
  if (!quiet) DRAFT = d;
  return d;
}

function pullEspn() {
  const id = ($("lg-espn").value || "").trim();
  if (!/^\d+$/.test(id)) { lgMsg("err", "Enter a numeric ESPN league id."); return; }
  const sid = parseInt(META.season.slice(0, 4), 10) + 1;
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${sid}/segments/0/leagues/${id}?view=mSettings`;
  $("lg-pull").disabled = true;
  lgMsg("info", "Pulling league " + esc(id) + " from ESPN&hellip;");
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 401 || r.status === 403 ? " — the league must be public" : ""));
    return r.json();
  }).then((j) => {
    const s = j.settings || {};
    const key = "espn-" + id;
    const d = STORE.list[key] ? clone(STORE.list[key]) : clone(DRAFT);
    d.key = key; d.id = id; d.platform = "espn";
    d.name = s.name || d.name || ("ESPN " + id);
    if (s.size) d.teams = s.size;
    const w = Object.fromEntries(STATS.map((k) => [k, 0])), b = {DD: 0, TD: 0, QD: 0}, unmod = [];
    ((s.scoringSettings || {}).scoringItems || []).forEach((it) => {
      const nm = ESPN_STAT[it.statId], pts = +it.points || 0;
      if (!pts) return;
      if (nm === "DREB") { w.REB += pts; w.OREB -= pts; }   // DREB = REB - OREB
      else if (nm in b) b[nm] = pts;
      else if (nm) w[nm] = pts;
      else unmod.push((ESPN_UNMOD[it.statId] || "stat #" + it.statId) + " (" + (pts > 0 ? "+" : "") + pts + ")");
    });
    d.w = w; d.b = b; d.unmod = unmod;
    const ss = (s.scoringSettings || {});
    if (ss.scoringType && /CATEGOR|ROTO/i.test(ss.scoringType)) unmod.push("this is a categories league — the site scores points");
    const slots = {};
    Object.entries((s.rosterSettings || {}).lineupSlotCounts || {}).forEach(([k, v]) => {
      if (v && ESPN_SLOT[k]) slots[ESPN_SLOT[k]] = v;
    });
    if (Object.keys(slots).length) d.slots = slots;
    let adds = (s.acquisitionSettings || {}).matchupAcquisitionLimit;
    if (adds != null && adds > 0 && adds < 1) adds = Math.round(adds * 7);   // ESPN serves a per-day fraction
    d.adds = adds != null && adds >= 0 ? adds : d.adds;
    const sch = s.scheduleSettings || {};
    if (sch.matchupPeriodCount && sch.playoffTeamCount) {
      const start = sch.matchupPeriodCount + 1, len = sch.playoffMatchupPeriodLength || 1;
      d.playoff_weeks = [start, start + Math.ceil(Math.log2(sch.playoffTeamCount)) * len - 1];
    }
    DRAFT = d;
    renderLeagueForm();
    lgMsg("ok", `Pulled <strong>${esc(d.name)}</strong>: ${d.teams} teams, ${rostered(d)} roster spots, scoring and bonuses filled in. Review, then <strong>Save league</strong>.`);
  }).catch((e) => {
    lgMsg("err", "Could not pull league " + esc(id) + " (" + esc(e.message) + "). Private leagues can't be read; make it viewable to the public in ESPN's league settings, or enter the rules by hand.");
  }).finally(() => { $("lg-pull").disabled = false; });
}

function bindLeague() {
  $("lgsel").addEventListener("change", (e) => setActive(e.target.value));
  $("lg-pull").addEventListener("click", pullEspn);
  $("lg-espn").addEventListener("keydown", (e) => { if (e.key === "Enter") pullEspn(); });
  $("tab-league").addEventListener("input", (e) => {
    if (e.target.closest("#lg-slots") || e.target.id === "lg-teams") rosterNote();
    $("lg-state").textContent = "Unsaved changes";
  });
  $("lg-new").addEventListener("click", () => {
    const d = clone(META.league);
    d.key = "custom-" + Date.now(); d.id = ""; d.name = "New league"; d.unmod = [];
    DRAFT = d;
    renderLeagueForm();
    lgMsg("info", "New league started from the default rules. Pull an ESPN league id or edit the fields, then save.");
  });
  $("lg-save").addEventListener("click", () => {
    const d = readForm();
    if (d.id && /^\d+$/.test(d.id) && d.key.startsWith("custom-")) {
      delete STORE.list[d.key];
      d.key = "espn-" + d.id;
    }
    STORE.list[d.key] = d;
    const ok = writeStore();
    setActive(d.key);
    lgMsg(ok ? "ok" : "err", ok ? `Saved <strong>${esc(d.name)}</strong> and made it the active league.`
      : "Saved for this visit, but this browser blocks storage, so it won't be remembered.");
  });
  $("lg-del").addEventListener("click", () => {
    const keys = Object.keys(STORE.list);
    if (keys.length > 1) {
      if (!confirm("Delete " + (DRAFT.name || "this league") + " from this browser?")) return;
      delete STORE.list[DRAFT.key];
      setActive(Object.keys(STORE.list)[0]);
      lgMsg("ok", "League deleted.");
    } else {
      const d = clone(META.league); d.key = "espn-" + d.id;
      STORE = {active: d.key, list: {[d.key]: d}};
      setActive(d.key);
      lgMsg("ok", "Reset to the default league.");
    }
  });
}

// ============================================================ PROJECTIONS
const PJ = {view: "ros", pos: "", sort: null, dir: -1};
const VIEWS = {
  ros: {tot: "rosTot", fp: "ros", gp: "rosGp", line: "s", mpg: "mpg", gpLbl: "GP left",
        what: "Rest of season"},
  pre: {tot: "preTot", fp: "pre", gp: "preGp", line: "ps", mpg: "pmpg", gpLbl: "GP",
        what: "Preseason (draft day)"},
  sofar: {tot: "sofarTot", fp: "sofar", gp: "gp", line: "td", mpg: "mpg_td", gpLbl: "GP",
          what: "Season so far"},
};
function projRows() {
  return PLAYERS.map((p) => {
    const left = TEAMLEFT[p.tm] || 0;
    const ros = fpg(p.s, p.bp), rosGp = (p.av || 0) * left;
    const pre = p.ps ? fpg(p.ps, p.pbp) : null;
    const sofar = p.td && p.gp ? fpg(p.td, p.tbp || [0, 0, 0]) : null;
    const adj = p.adj ? fpg(p.adj, p.abp) : null;
    return {p, ros, rosGp, rosTot: ros * rosGp, pre, preGp: p.pre_gp ?? null,
      preTot: pre != null && p.pre_gp ? pre * p.pre_gp : null,
      sofar, gp: p.gp || 0, sofarTot: sofar != null ? sofar * p.gp : null,
      adj, luck: sofar != null && adj != null ? sofar - adj : null};
  });
}
function tags(p) {
  let t = "";
  if (p.inj === "OUT" || p.inj === "INJURY_RESERVE" || p.inj === "SUSPENSION")
    t += `<span class="tag inj" title="ESPN status">${p.inj === "INJURY_RESERVE" ? "IR" : p.inj === "SUSPENSION" ? "SUSP" : "OUT"}</span>`;
  else if (p.inj === "DAY_TO_DAY") t += '<span class="tag dtd" title="ESPN status">DTD</span>';
  if (p.rook) t += '<span class="tag rk">RK</span>';
  return t;
}
function pct(m, a) { return m != null && a ? (100 * m / a).toFixed(1) : "-"; }

function renderProj() {
  const V = VIEWS[PJ.view];
  const all = projRows().filter((r) => r[V.tot] != null && r[V.tot] > 0);
  all.sort((a, b) => b[V.tot] - a[V.tot]);
  all.forEach((r, i) => { r.rank = i + 1; });
  const top = all.slice(0, 300);
  const q = ($("pj-q").value || "").trim().toLowerCase();
  let list = top.filter((r) => (!PJ.pos || String(r.p.pos || "").split(/[,/ ]+/).includes(PJ.pos)) &&
    (!q || r.p.n.toLowerCase().includes(q) || String(r.p.tm).toLowerCase() === q));
  const sk = PJ.sort;
  if (sk) {
    const val = (r) => (sk === "n" ? r.p.n : sk === "tm" ? r.p.tm : sk in r ? r[sk] : r.p[sk]);
    list.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return typeof x === "string" ? PJ.dir * x.localeCompare(y) : PJ.dir * (x - y);
    });
  }
  const cut = L.teams * rostered(L);
  const H = (k, lbl, cls = "", tip = "") =>
    `<th${k ? ` data-k="${k}"` : ""} class="${cls}${PJ.sort === k ? " on" + (PJ.dir > 0 ? " asc" : "") : ""}"${tip ? ` title="${esc(tip)}"` : ""}>${lbl}</th>`;
  $("pj-table").querySelector("thead").innerHTML = "<tr>" +
    H("rank", "#") + H("n", "Player", "l") + H("tm", "Tm", "l") + '<th class="l">Pos</th>' +
    H(V.fp, "FP/G", "grp", V.what + " fantasy points per game under " + L.name) +
    H(V.gp, V.gpLbl, "", PJ.view === "ros" ? "Projected games from here: availability x team games left" : "") +
    H(V.tot, "Total") +
    '<th class="grp">MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>3PM</th><th>TOV</th><th>FG%</th><th>FT%</th>' +
    H("sofar", "Now FP/G", "grp", "Actual FP/G this season") +
    H("adj", "Luck-adj", "", "FP/G with luck removed: his own per-minute rates at the minutes he played, plus his real shot attempts and assists") +
    H("luck", "Luck/G", "", "Actual minus luck-adjusted, per game. Positive = the box score flatters him") +
    H("pre_rank", "Pre #", "grp", "Preseason board rank") +
    H("espn", "ESPN #", "", "ESPN's preseason rank") +
    H("own", "Own%", "", "Rostered % across ESPN leagues") + "</tr>";
  const rows = [];
  const plain = !sk && !q && !PJ.pos;
  list.forEach((r) => {
    const p = r.p, s = p[V.line];
    const st = (k) => (s ? fx(s[SI[k]]) : "-");
    rows.push(`<tr data-id="${p.id}">` +
      `<td class="${r.rank > cut ? "dim" : ""}">${r.rank}</td>` +
      `<td class="l name">${esc(p.n)}${tags(p)}</td><td class="l dim">${esc(p.tm)}</td><td class="l dim">${esc(p.pos || "")}</td>` +
      `<td class="grp big">${fx(r[V.fp])}</td><td>${fx(r[V.gp], PJ.view === "sofar" ? 0 : 1)}</td><td>${fx(r[V.tot], 0)}</td>` +
      `<td class="grp">${fx(p[V.mpg])}</td><td>${st("PTS")}</td><td>${st("REB")}</td><td>${st("AST")}</td><td>${st("STL")}</td>` +
      `<td>${st("BLK")}</td><td>${st("FG3M")}</td><td>${st("TOV")}</td>` +
      `<td>${s ? pct(s[SI.FGM], s[SI.FGA]) : "-"}</td><td>${s ? pct(s[SI.FTM], s[SI.FTA]) : "-"}</td>` +
      `<td class="grp">${fx(r.sofar)}</td><td>${fx(r.adj)}</td>` +
      `<td class="${r.luck == null ? "" : r.luck >= 1 ? "pos-dn" : r.luck <= -1 ? "pos-up" : ""}">${sg(r.luck)}</td>` +
      `<td class="grp dim">${p.pre_rank ?? "-"}</td><td class="dim">${p.espn != null ? Math.round(p.espn) : "-"}</td>` +
      `<td class="dim">${p.own != null ? p.own.toFixed(0) : "-"}</td></tr>`);
    if (plain && r.rank === cut)
      rows.push(`<tr class="cutlbl"><td colspan="23">Waiver line — ${L.teams} teams × ${rostered(L)} roster spots = ${cut} rostered players</td></tr>`);
  });
  $("pj-table").querySelector("tbody").innerHTML = rows.join("");
  $("pj-count").textContent = `${list.length} of top ${top.length}`;
  $("pj-lede").innerHTML = `Top 300 under <strong>${esc(L.name)}</strong> scoring, ranked by total points. ` +
    (PJ.view === "ros" ? "Rest of season = the preseason projection updated by every game so far (the blend tested on 24 seasons); games left = projected availability × team games remaining."
      : PJ.view === "pre" ? "The frozen draft-day board — what the model projected before tip-off."
      : "What has actually happened, with each player's luck-adjusted FP/G alongside.") +
    ` Box scores through <strong>${esc(META.last_game_day || META.asof)}</strong>.`;
  $("pj-note").innerHTML = "Click any player for his page. <strong>Luck/G</strong> in orange = running hot " +
    "(the box score overstates him), green = running cold. Rank numbers past the waiver line are greyed.";
}
function bindProj() {
  document.querySelectorAll("#pj-view .chip").forEach((c) => c.addEventListener("click", () => {
    PJ.view = c.dataset.v; PJ.sort = null;
    document.querySelectorAll("#pj-view .chip").forEach((x) => x.setAttribute("aria-pressed", String(x === c)));
    renderProj();
  }));
  document.querySelectorAll("#pj-pos .chip").forEach((c) => c.addEventListener("click", () => {
    PJ.pos = c.dataset.p;
    document.querySelectorAll("#pj-pos .chip").forEach((x) => x.setAttribute("aria-pressed", String(x === c)));
    renderProj();
  }));
  $("pj-q").addEventListener("input", renderProj);
  $("pj-table").querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (!th) return;
    const k = th.dataset.k;
    if (k === "rank") { PJ.sort = null; renderProj(); return; }
    if (PJ.sort === k) PJ.dir = -PJ.dir;
    else { PJ.sort = k; PJ.dir = ["n", "tm", "pre_rank", "espn"].includes(k) ? 1 : -1; }
    renderProj();
  });
  $("pj-table").querySelector("tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) openPlayer(+tr.dataset.id);
  });
}

// ============================================================ PLAYER PAGE
function loadGames() {
  if (GAMES) return Promise.resolve(GAMES);
  if (!GAMES_P) GAMES_P = fetch("data/games.json").then((r) => r.json()).then((j) => {
    const C = {};
    j.cols.forEach((c, i) => { C[c] = i; });
    const byP = {};
    j.rows.forEach((r) => { (byP[r[C.id]] = byP[r[C.id]] || []).push(r); });
    GAMES = {C, rows: j.rows, byP};
    return GAMES;
  });
  return GAMES_P;
}
function opponent(tm, d) {
  const g = (META.sched[tm] || []).find((x) => x[0] === d);
  return g ? (g[2] ? "vs " : "@ ") + g[1] : "";
}
function spark(vals, w = 220, h = 34) {
  if (!vals.length) return "";
  const mx = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const mid = h / 2, step = w / vals.length, bw = Math.max(1.5, step - 1.5);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle">` +
    `<line x1="0" x2="${w}" y1="${mid}" y2="${mid}" stroke="var(--rule2)"/>` +
    vals.map((v, i) => {
      const bh = Math.max(1, Math.abs(v) / mx * (mid - 1));
      return `<rect x="${(i * step).toFixed(1)}" y="${(v >= 0 ? mid - bh : mid).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${v >= 0 ? "var(--warn)" : "var(--good)"}"><title>${v >= 0 ? "+" : ""}${v.toFixed(1)} luck</title></rect>`;
    }).join("") + "</svg>";
}
function openPlayer(id) {
  const p = BYID[id];
  if (!p) return;
  const left = TEAMLEFT[p.tm] || 0;
  const ros = fpg(p.s, p.bp), pre = p.ps ? fpg(p.ps, p.pbp) : null;
  const now = p.td && p.gp ? fpg(p.td, p.tbp || [0, 0, 0]) : null;
  const adj = p.adj ? fpg(p.adj, p.abp) : null;
  const kpi = (v, lbl) => `<div class="kpi"><b>${v}</b><span>${lbl}</span></div>`;
  const lineRow = (lbl, s, mpg, fp, extra = "") => !s ? "" :
    `<tr><td class="l">${lbl}</td><td>${fx(mpg)}</td>` +
    STATS.map((k) => `<td>${fx(s[SI[k]])}</td>`).join("") + `<td class="grp big">${fx(fp)}</td>${extra}</tr>`;
  const next = (META.sched[p.tm] || []).filter((g) => g[0] > (META.last_game_day || "")).slice(0, 7);
  $("drawer").innerHTML =
    `<div class="dhead"><div><h1>${esc(p.n)}${tags(p)}</h1>` +
    `<div class="dsub">${esc(p.tm)} · ${esc(p.pos || "")}${p.age ? " · age " + Math.floor(p.age) : ""}` +
    `${p.own != null ? " · " + p.own.toFixed(0) + "% rostered" : ""}${p.inj && p.inj !== "ACTIVE" ? " · ESPN: " + esc(p.inj) : ""}</div></div>` +
    `<button class="x" id="dclose" aria-label="Close">×</button></div>` +
    '<div class="kpis">' +
      kpi(fx(ros), "Rest-of-season FP/G") +
      kpi(fx(now), `Actual FP/G (${p.gp || 0} gp)`) +
      kpi(fx(adj), "Luck-adjusted FP/G") +
      kpi(now != null && adj != null ? sg(now - adj) : "-", "Luck per game") +
      kpi(fx(pre), "Preseason FP/G" + (p.pre_rank ? ` (#${p.pre_rank})` : "")) +
      kpi(fx((p.av || 0) * left, 0) + " / " + left, "Projected games left / team games") +
    "</div>" +
    `<p class="note">All fantasy points under <strong>${esc(L.name)}</strong> scoring.</p>` +
    "<h2>Per-game lines</h2>" +
    '<div class="tablewrap" style="max-height:none"><table><thead><tr><th class="l">Line</th><th>MIN</th>' +
    STATS.map((k) => `<th>${STAT_LBL[k]}</th>`).join("") + '<th class="grp">FP/G</th></tr></thead><tbody>' +
    lineRow("Preseason projection", p.ps, p.pmpg, pre) +
    lineRow("Season so far", p.td, p.mpg_td, now) +
    lineRow("Luck-adjusted so far", p.adj, p.mpg_td, adj) +
    lineRow("Rest of season", p.s, p.mpg, ros) +
    (p.ls ? lineRow("Last season", p.ls, null, fpg(p.ls, p.lbp)) : "") +
    "</tbody></table></div>" +
    (p.lb ? "<h2>Where the luck came from</h2><div class=\"lbar\">" +
      p.lb.map(([k, v]) => `<span class="${v > 0.5 ? "pos-dn" : v < -0.5 ? "pos-up" : ""}">${esc(k)} ${sg(v)}</span>`).join("") +
      '</div><p class="note">Season totals vs his own rates, in fantasy points under the default league scoring. Orange = ran hot, green = ran cold.</p>' : "") +
    "<h2>Game log</h2><div id=\"dlog\"><p class=\"note\">Loading games&hellip;</p></div>" +
    (next.length ? "<h2>Next games</h2><p class=\"lbar\">" +
      next.map((g) => `<span>${g[0].slice(5)} ${g[2] ? "vs" : "@"} ${esc(g[1])}</span>`).join("") + "</p>" : "");
  $("scrim").hidden = false;
  document.body.style.overflow = "hidden";
  $("dclose").addEventListener("click", closePlayer);
  $("drawer").scrollTop = 0;
  loadGames().then((G) => {
    if ($("scrim").hidden) return;
    const C = G.C, rows = (G.byP[id] || []).slice().sort((a, b) => (a[C.d] < b[C.d] ? 1 : -1));
    if (!rows.length) { $("dlog").innerHTML = '<p class="note">No games yet this season.</p>'; return; }
    const lucks = [];
    const body = rows.map((r) => {
      const box = STATS.map((k) => r[C[k]]);
      const fp = fpg(box, [r[C.dd], r[C.td], r[C.qd]]);
      const a = r[C.adj] ? fpg(r[C.adj], r[C.abp]) : null;
      const lk = a == null ? null : fp - a;
      if (lk != null) lucks.unshift(lk);
      return `<tr><td class="l">${r[C.d].slice(5)}</td><td class="l dim">${esc(opponent(r[C.tm], r[C.d]))}</td>` +
        `<td>${r[C.min] ?? "-"}</td><td>${r[C.PTS]}</td><td>${r[C.REB]}</td><td>${r[C.AST]}</td><td>${r[C.STL]}</td>` +
        `<td>${r[C.BLK]}</td><td>${r[C.FG3M]}</td><td>${r[C.TOV]}</td><td>${r[C.FGM]}-${r[C.FGA]}</td><td>${r[C.FTM]}-${r[C.FTA]}</td>` +
        `<td class="grp big">${fx(fp)}</td><td>${fx(a)}</td>` +
        `<td class="${lk == null ? "" : lk >= 3 ? "pos-dn" : lk <= -3 ? "pos-up" : ""}">${sg(lk)}</td>` +
        `<td class="l dim">${r[C.sh] ? "w/o " + esc(r[C.sh].join(", ")) : ""}</td></tr>`;
    }).join("");
    $("dlog").innerHTML = (lucks.length > 1 ? `<p>Luck by game, oldest to newest: ${spark(lucks)}</p>` : "") +
      '<div class="tablewrap" style="max-height:none"><table><thead><tr><th class="l">Date</th><th class="l">Opp</th>' +
      "<th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>3PM</th><th>TOV</th><th>FG</th><th>FT</th>" +
      '<th class="grp">FP</th><th title="His own rates at the minutes he played + real shots and assists">Luck-adj</th><th>Luck</th><th class="l" title="Key teammates missing while active">Context</th></tr></thead><tbody>' +
      body + "</tbody></table></div>";
  });
}
function closePlayer() { $("scrim").hidden = true; document.body.style.overflow = ""; }

// ================================================================ ROUTING
const TABS = ["league", "proj", "insea", "wire", "recap", "week", "trade", "how"];
function showTab(t) {
  if (!TABS.includes(t)) t = "proj";
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  TABS.forEach((k) => { $("tab-" + k).hidden = k !== t; });
  if (location.hash !== "#" + t) history.replaceState(null, "", "#" + t);
}
function renderAll() { renderProj(); }

// ================================================================== BOOT
Promise.all([fetch("data/meta.json").then((r) => r.json()), fetch("data/players.json").then((r) => r.json())])
  .then(([meta, players]) => {
    META = meta; PLAYERS = players; STATS = meta.stats;
    STATS.forEach((s, i) => { SI[s] = i; });
    players.forEach((p) => { BYID[p.id] = p; });
    const last = META.last_game_day || META.asof;
    Object.entries(META.sched).forEach(([t, g]) => { TEAMLEFT[t] = g.filter((x) => x[0] > last).length; });
    $("asof").textContent = "through " + last;
    STORE = readStore();
    L = clone(STORE.list[STORE.active]);
    DRAFT = clone(L);
    fillLeaguePicker();
    renderLeagueForm();
    bindLeague();
    bindProj();
    document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    $("scrim").addEventListener("click", (e) => { if (e.target === $("scrim")) closePlayer(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePlayer(); });
    renderAll();
    showTab((location.hash || "#proj").slice(1));
  })
  .catch((e) => {
    document.querySelector("main").innerHTML = '<div class="msg err">Could not load the data (' + esc(e.message) + ").</div>";
  });
})();
