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
  const own = s.list["espn-" + META.league.id];     // saved before the team picker existed
  if (own && own.my_team == null && !own.tl) own.my_team = META.league.my_team;
  if (own && own.keep == null) own.keep = (META.league.keep || []).slice();
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
  Object.assign(WK, {mm: null, mmP: null, team: null, week: null});
  L = clone(STORE.list[key]);
  DRAFT = clone(L);
  fillLeaguePicker();
  fillTeamPicker();
  renderLeagueForm();
  renderAll();
  refreshLeagueData();
}

// ---- the league's teams + rosters (public ESPN leagues), fetched live once
// per visit. Rosters are TODAY's: the recap marks who owns a player now.
const LGDATA = {}, LGRES = {};
const espnBase = () => `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${parseInt(META.season.slice(0, 4), 10) + 1}/segments/0/leagues/`;
function espnLeague(lg) {
  if (!lg || lg.platform !== "espn" || !/^\d+$/.test(lg.id || "")) return Promise.resolve(null);
  if (!LGDATA[lg.id]) {
    LGDATA[lg.id] = fetch(espnBase() + lg.id + "?view=mTeam&view=mRoster").then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then((j) => {
      const teams = (j.teams || []).map((t) => ({id: t.id, ab: t.abbrev || "",
        name: (t.name || [t.location, t.nickname].filter(Boolean).join(" ") || "Team " + t.id).trim()}));
      const owner = {}, slot = {}, name = {}, elig = {}, inj = {}, pro = {}, tx = {};
      (j.teams || []).forEach((t) => {
        tx[t.id] = ((t.transactionCounter || {}).matchupAcquisitionTotals) || {};
        ((t.roster || {}).entries || []).forEach((e) => {
          owner[e.playerId] = t.id; slot[e.playerId] = e.lineupSlotId;
          const pl = (e.playerPoolEntry || {}).player;
          if (pl) {
            name[e.playerId] = pl.fullName;
            elig[e.playerId] = pl.eligibleSlots || [];
            inj[e.playerId] = pl.injuryStatus || null;
            pro[e.playerId] = pl.proTeamId;
          }
        });
      });
      const d = {teams, owner, slot, name, elig, inj, pro, tx, wv: {}, ret: {},
        byId: Object.fromEntries(teams.map((t) => [t.id, t]))};
      // second, optional call: which unrostered players are on waivers (not free agents)
      // ESPN answers 400 to this filter without a sort clause
      const flt = JSON.stringify({players: {filterStatus: {value: ["WAIVERS"]}, limit: 2000,
                                            sortPercOwned: {sortPriority: 1, sortAsc: false}}});
      return fetch(espnBase() + lg.id + "?view=kona_player_info", {headers: {"x-fantasy-filter": flt}})
        .then((r) => (r.ok ? r.json() : {players: []})).catch(() => ({players: []}))
        .then((k) => {
          (k.players || []).forEach((p) => { if (p && p.id != null && d.owner[p.id] == null) d.wv[p.id] = 1; });
          LGRES[lg.id] = d;
          return d;
        });
    }).catch(() => null);
  }
  return LGDATA[lg.id];
}
const myTeam = () => (L && L.my_team != null ? +L.my_team : null);
function fillTeamPicker() {
  const tl = (STORE.list[STORE.active] || {}).tl;
  $("tmpick").hidden = !tl || !tl.length;
  if (!tl) return;
  const mt = myTeam();
  $("tmsel").innerHTML = (mt == null ? '<option value="">pick your team</option>' : "") +
    tl.map(([id, name]) => `<option value="${id}"${id === mt ? " selected" : ""}>${esc(name)}</option>`).join("");
}
function refreshLeagueData() {
  const lg = STORE.list[STORE.active];
  espnLeague(lg).then((d) => {
    if (!d || STORE.list[STORE.active] !== lg) return;
    lg.tl = d.teams.map((t) => [t.id, t.name, t.ab]);
    if (lg.my_team != null && !d.byId[lg.my_team]) delete lg.my_team;
    writeStore();
    L.tl = lg.tl; L.my_team = lg.my_team;
    if (DRAFT.key === lg.key) { DRAFT.tl = lg.tl; DRAFT.my_team = lg.my_team; }
    fillTeamPicker();
    renderAll();
  });
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
    if (!STORE.list[key]) { delete d.tl; delete d.my_team; d.keep = []; }
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
  $("tmsel").addEventListener("change", (e) => {
    const v = e.target.value === "" ? null : +e.target.value;
    const lg = STORE.list[STORE.active];
    if (v == null) delete lg.my_team; else lg.my_team = v;
    writeStore();
    L.my_team = lg.my_team;
    if (DRAFT.key === lg.key) DRAFT.my_team = lg.my_team;
    fillTeamPicker();
    renderAll();
  });
  $("lg-pull").addEventListener("click", pullEspn);
  $("lg-espn").addEventListener("keydown", (e) => { if (e.key === "Enter") pullEspn(); });
  $("tab-league").addEventListener("input", (e) => {
    if (e.target.closest("#lg-slots") || e.target.id === "lg-teams") rosterNote();
    $("lg-state").textContent = "Unsaved changes";
  });
  $("lg-new").addEventListener("click", () => {
    const d = clone(META.league);
    d.key = "custom-" + Date.now(); d.id = ""; d.name = "New league"; d.unmod = [];
    d.platform = "custom"; delete d.my_team; delete d.tl; d.keep = [];
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
    const byP = {}, byG = {};
    j.rows.forEach((r) => {
      (byP[r[C.id]] = byP[r[C.id]] || []).push(r);
      (byG[r[C.g]] = byG[r[C.g]] || {})[r[C.id]] = r;
    });
    GAMES = {C, rows: j.rows, byP, byG};
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

// ================================================================== RECAP
let RECAP = null, RECAP_P = null;
const RC = {day: null, g: null};
function loadRecap() {
  if (!RECAP_P) RECAP_P = fetch("data/recap.json").then((r) => (r.ok ? r.json() : null))
    .then((j) => { RECAP = j; return j; }).catch(() => null);
  return RECAP_P;
}
const pname = (id) => (BYID[id] ? BYID[id].n : (RECAP.nm[id] || "#" + id));
const surname = (n) => {
  const w = n.split(" ").filter((x) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(x));
  return w.length > 1 ? w.slice(1).join(" ") : n;
};
// double/triple/quad-double flags from a box line (for ESPN fallback rows)
function multi(box) {
  const n = ["PTS", "REB", "AST", "STL", "BLK"].filter((k) => (box[SI[k]] || 0) >= 10).length;
  return [+(n >= 2), +(n >= 3), +(n >= 4)];
}
// {team: [player rows in ESPN order]} for one game, scored under the active league
function gameLines(gid) {
  const C = GAMES.C, byG = GAMES.byG[gid] || {}, out = {};
  (RECAP.box[gid] || []).forEach(([id, tm, st, dnp, pm]) => {
    const r = byG[id], f = RECAP.fb[gid + ":" + id];
    const row = {id, tm, st: !!st, dnp, pm, min: null, box: null, fp: null, adj: null, lk: null, fg3a: null};
    if (r) {
      row.box = STATS.map((k) => r[C[k]]); row.min = r[C.min]; row.fg3a = r[C.FG3A];
      row.fp = fpg(row.box, [r[C.dd], r[C.td], r[C.qd]]);
      row.adj = r[C.adj] ? fpg(r[C.adj], r[C.abp]) : null;
      row.sh = r[C.sh];
    } else if (f && dnp == null) {
      row.min = f[0]; row.box = f.slice(1, 1 + STATS.length); row.fg3a = f[1 + STATS.length];
      row.fp = fpg(row.box, multi(row.box));
    }
    if (row.fp != null && row.adj != null) row.lk = row.fp - row.adj;
    (out[tm] = out[tm] || []).push(row);
  });
  return out;
}
const lkCls = (v, t = 3) => (v == null ? "" : v >= t ? "pos-dn" : v <= -t ? "pos-up" : "");

function renderRecap() {
  if (!RECAP || !GAMES) {
    $("rc-games").innerHTML = '<p class="note">Loading games&hellip;</p>';
    Promise.all([loadRecap(), loadGames()]).then(([rc]) => {
      if (rc) renderRecap();
      else $("rc-games").innerHTML = '<div class="msg err">The recap data is not built yet.</div>';
    });
    return;
  }
  const days = [...new Set(RECAP.games.map((g) => g[1]))].sort().reverse();
  if (!days.length) { $("rc-games").innerHTML = '<p class="note">No finished games yet.</p>'; return; }
  if (!RC.day || !days.includes(RC.day)) RC.day = days[0];
  const di = days.indexOf(RC.day);
  const dlabel = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short", month: "short", day: "numeric"});
  $("rc-day").innerHTML = days.map((d) => `<option value="${d}"${d === RC.day ? " selected" : ""}>${dlabel(d)}</option>`).join("");
  $("rc-prev").disabled = di >= days.length - 1;
  $("rc-next").disabled = di <= 0;

  const lg = LGRES[L.id], mt = myTeam();
  const fan = (id) => (lg && lg.owner[id] != null ? lg.byId[lg.owner[id]] : null);
  const games = RECAP.games.filter((g) => g[1] === RC.day);
  if (RC.g && !games.some((g) => g[0] === RC.g)) RC.g = null;
  const lines = {}, all = [];
  games.forEach((g) => {
    lines[g[0]] = gameLines(g[0]);
    Object.values(lines[g[0]]).forEach((rows) => rows.forEach((r) => { if (r.fp != null) all.push(r); }));
  });
  $("rc-count").textContent = `${games.length} game${games.length === 1 ? "" : "s"} · ${all.length} players`;
  $("rc-lede").innerHTML = `Every game of the night, scored under <strong>${esc(L.name)}</strong>. Click a game for both box scores. ` +
    `<strong>Luck</strong> = fantasy points minus luck-adjusted points (his own per-minute rates at the minutes he played, plus his real shots and assists): ` +
    `<span class="pos-dn">orange</span> means the box score flatters him, <span class="pos-up">green</span> means he played better than it looks.`;

  // ---- standouts
  const srow = (r, v, own = true) => `<div class="srow"><span class="nm" data-id="${r.id}">${esc(pname(r.id))}</span>` +
    `<span class="sub">${esc(r.tm)}${own && fan(r.id) ? " · " + esc(fan(r.id).ab) : ""}</span><span class="v">${v}</span></div>`;
  const byFp = all.slice().sort((a, b) => b.fp - a.fp).slice(0, 5);
  const wl = all.filter((r) => r.lk != null);
  const hot = wl.slice().sort((a, b) => b.lk - a.lk).filter((r) => r.lk > 0).slice(0, 5);
  const cold = wl.slice().sort((a, b) => a.lk - b.lk).filter((r) => r.lk < 0).slice(0, 5);
  let cards = "";
  if (mt != null && lg) {
    const mine = all.filter((r) => lg.owner[r.id] === mt).sort((a, b) => b.fp - a.fp);
    const tot = mine.reduce((a, r) => a + r.fp, 0), tl = mine.reduce((a, r) => a + (r.lk || 0), 0);
    cards += `<div class="card"><h4>Your team<b>${esc(lg.byId[mt].name)}</b></h4>` +
      (mine.length ? mine.map((r) => srow(r, `${fx(r.fp)} <span class="${lkCls(r.lk)}">(${sg(r.lk)})</span>`, false)).join("") +
        `<div class="srow" style="border-top:1px solid var(--rule);margin-top:.2rem;padding-top:.25rem"><b>${mine.length} played</b>` +
        `<span class="v"><b>${fx(tot)}</b> <span class="${lkCls(tl, 8)}">(${sg(tl)} luck)</span></span></div>`
        : '<p class="note" style="margin:0">None of your players played.</p>') +
      `<p class="note" style="margin:.3rem 0 0;font-size:.74rem">Everyone on your roster today, started or benched.</p></div>`;
  }
  cards += `<div class="card"><h4>Top fantasy scores</h4>${byFp.map((r) => srow(r, fx(r.fp))).join("")}</div>` +
    `<div class="card"><h4>Ran hot (box score flatters)</h4>${hot.map((r) => srow(r, `<span class="pos-dn">${sg(r.lk)}</span> <span class="sub">${fx(r.fp)} fp</span>`)).join("") || '<p class="note">-</p>'}</div>` +
    `<div class="card"><h4>Ran cold (better than it looks)</h4>${cold.map((r) => srow(r, `<span class="pos-up">${sg(r.lk)}</span> <span class="sub">${fx(r.fp)} fp</span>`)).join("") || '<p class="note">-</p>'}</div>`;
  $("rc-stand").innerHTML = cards;

  // ---- game cards
  const logo = (t) => RECAP.logos[t] ? `<img src="${esc(RECAP.logos[t])}" alt="" loading="lazy">` : "";
  $("rc-games").innerHTML = games.map((g) => {
    const [gid, , aw, hm, ap, hp, , , status] = g;
    const rows = Object.values(lines[gid]).flat().filter((r) => r.fp != null);
    const top = rows.slice().sort((a, b) => b.fp - a.fp)[0];
    const mineN = mt != null && lg ? rows.filter((r) => lg.owner[r.id] === mt).length : 0;
    const side = (t, p, win) => `<div class="gteam${win ? " win" : ""}">${logo(t)}<span>${esc(t)}</span><span class="sc">${p ?? "-"}</span></div>`;
    return `<button class="gcard" data-g="${gid}" aria-pressed="${gid === RC.g}">` +
      side(aw, ap, ap > hp) + side(hm, hp, hp > ap) +
      `<div class="gfoot"><span>${esc(status)}${mineN ? ` · <span class="mine">${mineN} yours</span>` : ""}</span>` +
      `<span>${top ? esc(surname(pname(top.id))) + " " + fx(top.fp) : ""}</span></div></button>`;
  }).join("");

  // ---- box score of the selected game
  if (!RC.g) {
    $("rc-box").innerHTML = '<p class="note">Click a game for both box scores.</p>';
    return;
  }
  const g = games.find((x) => x[0] === RC.g);
  const [gid, , aw, hm, ap, hp, aq, hq, status] = g;
  const qa = (aq || "").split(",").filter(Boolean), qh = (hq || "").split(",").filter(Boolean);
  const qn = Math.max(qa.length, qh.length);
  const qlbl = (i) => (i < 4 ? "Q" + (i + 1) : (i === 4 ? "OT" : "OT" + (i - 3)));
  const qtab = qn ? `<table class="qtab"><thead><tr><th class="l"></th>${Array.from({length: qn}, (_, i) => `<th>${qlbl(i)}</th>`).join("")}<th>T</th></tr></thead><tbody>` +
    `<tr><td class="l">${esc(aw)}</td>${qa.map((v) => `<td>${v}</td>`).join("")}<td><b>${ap}</b></td></tr>` +
    `<tr><td class="l">${esc(hm)}</td>${qh.map((v) => `<td>${v}</td>`).join("")}<td><b>${hp}</b></td></tr></tbody></table>` : "";
  const showFan = !!lg;
  const ncol = 17 + (showFan ? 1 : 0);
  const head = '<tr><th class="l">Player</th>' + (showFan ? '<th class="l" title="Fantasy team that rosters him today">Fantasy</th>' : "") +
    '<th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>3PM</th><th>TOV</th><th>FG</th><th>3P</th><th>FT</th><th>+/-</th>' +
    '<th class="grp">FP</th><th title="His own per-minute rates at the minutes he played, plus his real shot attempts and assists">Luck-adj</th><th>Luck</th></tr>';
  const prow = (r) => {
    const b = r.box, f = fan(r.id), mine = f && f.id === mt;
    const v = (k) => b[SI[k]];
    return `<tr class="${mine ? "mine" : ""}"><td class="l name" data-id="${r.id}">${esc(pname(r.id))}${BYID[r.id] ? tags(BYID[r.id]) : ""}</td>` +
      (showFan ? `<td class="fan">${f ? esc(f.ab) : '<span class="dim">FA</span>'}</td>` : "") +
      `<td>${r.min ?? "-"}</td><td>${v("PTS")}</td><td>${v("REB")}</td><td>${v("AST")}</td><td>${v("STL")}</td><td>${v("BLK")}</td>` +
      `<td>${v("FG3M")}</td><td>${v("TOV")}</td><td>${v("FGM")}-${v("FGA")}</td><td>${v("FG3M")}-${r.fg3a ?? "?"}</td><td>${v("FTM")}-${v("FTA")}</td>` +
      `<td class="dim">${r.pm == null ? "" : (r.pm > 0 ? "+" : "") + r.pm}</td>` +
      `<td class="grp big">${fx(r.fp)}</td><td>${fx(r.adj)}</td><td class="${lkCls(r.lk)}"${r.adj == null ? ' title="No preseason line for this player (two-way / call-up), so no luck split"' : ""}>${sg(r.lk)}</td></tr>`;
  };
  const teamTable = (t, pts) => {
    const rows = lines[gid][t] || [];
    const played = rows.filter((r) => r.box), st = played.filter((r) => r.st), bn = played.filter((r) => !r.st);
    const dnp = rows.filter((r) => !r.box);
    const sum = (k) => played.reduce((a, r) => a + (r.box[SI[k]] || 0), 0);
    const fpT = played.reduce((a, r) => a + r.fp, 0);
    const adjRows = played.filter((r) => r.adj != null);
    const adjT = adjRows.reduce((a, r) => a + r.adj, 0), lkT = adjRows.reduce((a, r) => a + r.lk, 0);
    return `<h3 class="boxteam">${logo(t)}${esc(t)} <span class="dim" style="font-weight:500">${pts}</span></h3>` +
      `<div class="tablewrap" style="max-height:none"><table><thead>${head}</thead><tbody>` +
      `<tr class="sec"><td colspan="${ncol}">Starters</td></tr>` + st.map(prow).join("") +
      `<tr class="sec"><td colspan="${ncol}">Bench</td></tr>` + (bn.map(prow).join("") || `<tr><td class="l dim" colspan="${ncol}">-</td></tr>`) +
      `<tr class="tot"><td class="l">Team</td>${showFan ? "<td></td>" : ""}<td></td><td>${sum("PTS")}</td><td>${sum("REB")}</td><td>${sum("AST")}</td>` +
      `<td>${sum("STL")}</td><td>${sum("BLK")}</td><td>${sum("FG3M")}</td><td>${sum("TOV")}</td><td>${sum("FGM")}-${sum("FGA")}</td><td></td>` +
      `<td>${sum("FTM")}-${sum("FTA")}</td><td></td><td class="grp">${fx(fpT)}</td><td>${fx(adjT)}</td><td class="${lkCls(lkT, 10)}">${sg(lkT)}</td></tr>` +
      "</tbody></table></div>" +
      (dnp.length ? `<p class="note" style="margin:.35rem 0 0"><strong>Did not play:</strong> ` +
        dnp.map((r) => `${esc(pname(r.id))}${r.dnp ? ` <span class="dim">(${esc(String(r.dnp).toLowerCase())})</span>` : ""}`).join(", ") + "</p>" : "");
  };
  $("rc-box").innerHTML =
    `<div class="card"><div class="boxhead">` +
      `<span class="bt${ap < hp ? " lose" : ""}">${logo(aw)}${esc(aw)} ${ap}</span><span class="dim">@</span>` +
      `<span class="bt${hp < ap ? " lose" : ""}">${hp} ${esc(hm)}${logo(hm)}</span>` +
      `<span class="st">${esc(status)} · ${dlabel(RC.day)}</span>${qtab}</div>` +
      teamTable(aw, ap) + teamTable(hm, hp) +
      `<p class="note" style="margin-top:.8rem">Starters and order as ESPN lists them. Team luck sums the players with a preseason line.` +
      (showFan ? " Fantasy owners are today's rosters, not the rosters on the night." : "") + "</p></div>";
}
function bindRecap() {
  $("rc-day").addEventListener("change", (e) => { RC.day = e.target.value; RC.g = null; renderRecap(); });
  const step = (d) => {
    const days = [...new Set(RECAP.games.map((g) => g[1]))].sort().reverse();
    const i = days.indexOf(RC.day) + d;
    if (i >= 0 && i < days.length) { RC.day = days[i]; RC.g = null; renderRecap(); }
  };
  $("rc-prev").addEventListener("click", () => step(1));
  $("rc-next").addEventListener("click", () => step(-1));
  $("rc-games").addEventListener("click", (e) => {
    const b = e.target.closest(".gcard");
    if (!b) return;
    RC.g = RC.g === +b.dataset.g ? null : +b.dataset.g;
    renderRecap();
    if (RC.g) $("rc-box").scrollIntoView({behavior: "smooth", block: "start"});
  });
  $("tab-recap").addEventListener("click", (e) => {
    const n = e.target.closest("[data-id]");
    if (n && BYID[+n.dataset.id]) openPlayer(+n.dataset.id);
  });
}

// ================================================================ WAIVERS
const WV = {win: "0", rank: "proj", pos: "", avail: true, sort: null, dir: -1};
const B2B_KEY = "fnba.v2.b2blist";
const addDays = (d, n) => {
  const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const normName = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
function b2bList() {
  let t = "";
  try { t = localStorage.getItem(B2B_KEY) || ""; } catch (e) { t = ""; }
  return t;
}
// fantasy points of a line under ANY league (the ceiling SD and matchup betas
// were measured under the default league; they are scaled by the ratio)
function fpgUnder(lg, s, bp) {
  const keep = L; L = lg;
  const v = fpg(s, bp);
  L = keep;
  return v;
}
const posCls = (pos) => {
  const t = String(pos || "").split(/[,/ ]+/)[0];
  return t === "C" ? "C" : (t === "SF" || t === "PF" || t === "F") ? "F" : "G";
};
function windowDays() {
  const d0 = META.asof;
  if (WV.win === "0") return [d0];
  if (WV.win === "1") return [addDays(d0, 1)];
  if (WV.win === "01") return [d0, addDays(d0, 1)];
  return Array.from({length: 7}, (_, i) => addDays(d0, i));
}
function streamRows() {
  const days = new Set(windowDays());
  const lg = LGRES[L.id];
  const own = new Set(b2bList().split("\n").map(normName).filter(Boolean));
  const B = META.b2b, CZ = META.ceiling.z;
  const out = [];
  PLAYERS.forEach((p) => {
    if (["OUT", "INJURY_RESERVE", "SUSPENSION"].includes(p.inj)) return;
    const rostered = lg && lg.owner[p.id] != null;
    if (WV.avail && rostered) return;
    if (WV.pos && !String(p.pos || "").split(/[,/ ]+/).includes(WV.pos)) return;
    const sch = (META.sched[p.tm] || []).filter((g) => days.has(g[0]));
    if (!sch.length) return;
    const fp = fpg(p.s, p.bp);
    if (fp == null || fp <= 0) return;
    const fpd = fpgUnder(META.league, p.s, p.bp) || fp;
    const scale = fpd > 0 ? fp / fpd : 1;
    const sd = (p.sd || 0) * scale;
    const teamDays = new Set((META.sched[p.tm] || []).map((g) => g[0]));
    const listed = own.has(normName(p.n));
    const psit = listed ? 1 : p.b2b ? p.b2b[2] : B.base;
    let proj = 0, ceil = null;
    const games = sch.map(([d, opp, home]) => {
      const second = teamDays.has(addDays(d, -1));
      const play = second ? Math.max(0, 1 - Math.max(0, psit - B.other)) : 1;
      const mf = META.mf[opp];
      let adj = 0, tip = "";
      if (mf) {
        const c = posCls(p.pos), b = META.mfb;
        adj = (b.pace * (mf.pace - 1) + b.dvp * ((mf[c] || 1) - 1) + b.fgp * ((mf.fgp || 1) - 1) +
               b.home * (home ? 0.5 : -0.5)) * scale;
        tip = `${opp}: pace ${(mf.pace * 100).toFixed(0)}% of league, allows ${((mf[c] || 1) * 100).toFixed(0)}% of league FP to ${c}s, ` +
          `opponents shoot ${((mf.fgp || 1) * 100).toFixed(0)}% of league FG% against them; ${home ? "home" : "away"} (${mf.n} games so far)`;
      }
      proj += play * (fp + adj);
      if (play >= 0.5) ceil = Math.max(ceil ?? -1e9, fp + adj + CZ * sd);
      return {d, opp, home, second, play, adj, tip};
    });
    const now = p.td && p.gp ? fpg(p.td, p.tbp || [0, 0, 0]) : null;
    const adjFp = p.adj ? fpg(p.adj, p.abp) : null;
    out.push({p, fp, games, proj, ceil, now, adjFp, luck: now != null && adjFp != null ? now - adjFp : null,
      psit, listed, risk: listed || psit >= B.flag, ng: games.length,
      st: rostered ? (lg.byId[lg.owner[p.id]] || {}).ab : lg ? (lg.wv[p.id] ? "WVR" : "FA") : null});
  });
  return out;
}
function renderWaivers() {
  const rows = streamRows();
  const key = WV.sort || (WV.rank === "ceil" ? "ceil" : "proj");
  const val = (r) => (key === "n" ? r.p.n : key === "own" ? r.p.own : r[key]);
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return typeof x === "string" ? WV.dir * x.localeCompare(y) : (WV.sort ? WV.dir : -1) * (x - y);
  });
  const list = rows.slice(0, 120);
  const lg = LGRES[L.id];
  const days = windowDays();
  const dname = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short"});
  const H = (k, lbl, cls = "", tip = "") =>
    `<th${k ? ` data-k="${k}"` : ""} class="${cls}${key === k ? " on" + (WV.sort && WV.dir > 0 ? " asc" : "") : ""}"${tip ? ` title="${esc(tip)}"` : ""}>${lbl}</th>`;
  $("wv-table").querySelector("thead").innerHTML = "<tr>" +
    H("", "#") + H("n", "Player", "l") + '<th class="l">Tm</th><th class="l">Pos</th>' +
    (lg ? '<th class="l" title="FA = free agent, WVR = on waivers">Status</th>' : "") +
    H("proj", days.length > 1 ? "Proj total" : "Proj", "grp big", "Projected fantasy points in the window: rest-of-season FP/G + each game's matchup adjustment, times the chance he plays second nights of back-to-backs") +
    H("ceil", "Ceiling", "", "A top-10% night in the window (his best game): projection + 1.40 x his game-to-game spread, shrunk toward last season's spread. Backtest: 10.6% of games beat it") +
    '<th class="l grp">Games (matchup adjustment)</th>' +
    H("fp", "ROS FP/G", "grp", "Rest-of-season FP/G (the tested in-season blend)") +
    H("now", "Now FP/G", "", "Actual FP/G this season") +
    H("adjFp", "Luck-adj", "", "FP/G with luck removed: his own per-minute rates at the minutes he played, plus his real shot attempts and assists") +
    H("luck", "Luck/G", "", "Actual minus luck-adjusted, per game. Positive = the box score flatters him") +
    H("psit", "B2B sit", "grp", "Chance he sits the second night of a back-to-back (rest sits from the game logs, shrunk toward the league's 11%)") +
    H("own", "Own%", "", "Rostered % across ESPN leagues") + "</tr>";
  const body = list.map((r, i) => {
    const p = r.p;
    const gs = r.games.map((g) => `<span class="gch${g.second ? " b2" : ""}" title="${esc((g.second ? "Second night of a back-to-back" + (r.risk ? ` — ${Math.round(r.psit * 100)}% sit chance` : "") + ". " : "") + g.tip)}">` +
      `${days.length > 1 ? dname(g.d) + " " : ""}${g.home ? "vs" : "@"} ${esc(g.opp)}` +
      `<span class="m ${g.adj >= 1 ? "pos-up" : g.adj <= -1 ? "pos-dn" : "dim"}">${g.tip ? sg(g.adj) : ""}</span></span>`).join("");
    const b2 = r.p.b2b;
    return `<tr data-id="${p.id}"><td class="dim">${i + 1}</td>` +
      `<td class="l name">${esc(p.n)}${tags(p)}${r.risk ? `<span class="tag b2b" title="${r.listed ? "On your list: does not play second nights" : "Sits second nights of back-to-backs"}">B2B</span>` : ""}</td>` +
      `<td class="l dim">${esc(p.tm)}</td><td class="l dim">${esc(p.pos || "")}</td>` +
      (lg ? `<td class="l">${r.st === "WVR" ? '<span class="tag wvr" style="margin:0">WVR</span>' : esc(r.st || "")}</td>` : "") +
      `<td class="grp big">${fx(r.proj)}</td><td>${fx(r.ceil)}</td>` +
      `<td class="l grp">${gs}</td>` +
      `<td class="grp">${fx(r.fp)}</td><td>${fx(r.now)}</td><td>${fx(r.adjFp)}</td>` +
      `<td class="${r.luck == null ? "" : r.luck >= 1 ? "pos-dn" : r.luck <= -1 ? "pos-up" : ""}">${sg(r.luck)}</td>` +
      `<td class="grp ${r.risk ? "" : "dim"}" title="${b2 ? `Sat ${b2[0]} of ${b2[1]} second nights (last season + this)` : "No second nights on record"}">${r.listed ? "your list" : Math.round(r.psit * 100) + "%"}</td>` +
      `<td class="dim">${p.own != null ? p.own.toFixed(0) : "-"}</td></tr>`;
  }).join("");
  $("wv-table").querySelector("tbody").innerHTML = body ||
    `<tr><td class="l dim" colspan="14">No ${WV.avail ? "available " : ""}players have a game in this window.</td></tr>`;
  const wl = WV.win === "0" ? "today" : WV.win === "1" ? "tomorrow" : WV.win === "01" ? "today and tomorrow" : "the next 7 days";
  $("wv-count").textContent = `${list.length} of ${rows.length} with a game ${wl}`;
  $("wv-lede").innerHTML = `Pickups with a game ${wl} (${days[0]}${days.length > 1 ? " to " + days[days.length - 1] : ""}), scored under <strong>${esc(L.name)}</strong>. ` +
    (lg ? `Available = not on any roster in your league${Object.keys(lg.wv).length ? "; WVR = on waivers (a claim, not an instant add)" : ""}. `
      : (L.platform === "espn" ? "Loading your league&rsquo;s rosters&hellip; " : "This league isn&rsquo;t a public ESPN league, so everyone is listed; ESPN&rsquo;s rostered % is your guide. ")) +
    `Players ESPN lists as out, on IR or suspended are left off. Rank by <strong>Ceiling</strong> when you need a big night more than a safe one.`;
  $("wv-note").innerHTML = "Matchup chips: the one-game adjustment tested on 16 seasons (opponent pace, fantasy points it allows to the player's position, " +
    "FG% it allows, home court), worth about ±2–3 points at the extremes. A dashed chip is the second night of a back-to-back. " +
    "Injury statuses and the matchup numbers are from this morning&rsquo;s build; rosters and waivers are read live from ESPN.";
  // ---- the sitters list
  const sit = PLAYERS.filter((p) => p.b2b && p.b2b[2] >= META.b2b.flag).sort((a, b) => b.b2b[2] - a.b2b[2]);
  $("wv-b2bsum").textContent = `— ${sit.length} players flagged`;
  $("wv-b2btab").innerHTML = '<div class="tablewrap" style="max-height:24rem;margin-top:.7rem"><table><thead><tr><th class="l">Player</th><th class="l">Tm</th>' +
    '<th title="Rest sits on second nights / second-night chances (bracketed by games played)">Sat</th><th>Sit chance</th>' + (lg ? '<th class="l">Status</th>' : "") + "</tr></thead><tbody>" +
    sit.map((p) => `<tr data-id="${p.id}"><td class="l name">${esc(p.n)}</td><td class="l dim">${esc(p.tm)}</td><td>${p.b2b[0]} of ${p.b2b[1]}</td>` +
      `<td>${Math.round(p.b2b[2] * 100)}%</td>${lg ? `<td class="l dim">${lg.owner[p.id] != null ? esc((lg.byId[lg.owner[p.id]] || {}).ab) : lg.wv[p.id] ? "WVR" : "FA"}</td>` : ""}</tr>`).join("") +
    "</tbody></table></div>";
}
function bindWaivers() {
  const chipset = (id, attr, fn) => document.querySelectorAll(`#${id} .chip`).forEach((c) => c.addEventListener("click", () => {
    fn(c.dataset[attr]);
    document.querySelectorAll(`#${id} .chip`).forEach((x) => x.setAttribute("aria-pressed", String(x === c)));
    renderWaivers();
  }));
  chipset("wv-win", "w", (v) => { WV.win = v; });
  chipset("wv-rank", "r", (v) => { WV.rank = v; WV.sort = null; });
  chipset("wv-pos", "p", (v) => { WV.pos = v; });
  chipset("wv-who", "a", (v) => { WV.avail = v === "1"; });
  $("wv-table").querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (!th) return;
    const k = th.dataset.k;
    if (WV.sort === k) WV.dir = -WV.dir;
    else { WV.sort = k; WV.dir = k === "n" ? 1 : -1; }
    renderWaivers();
  });
  $("tab-wire").addEventListener("click", (e) => {
    if (e.target.closest("thead")) return;
    const tr = e.target.closest("tr[data-id]");
    if (tr && BYID[+tr.dataset.id]) openPlayer(+tr.dataset.id);
  });
  const ta = $("wv-b2blist");
  ta.value = b2bList();
  ta.addEventListener("input", () => {
    try { localStorage.setItem(B2B_KEY, ta.value); } catch (e) { /* storage blocked */ }
    renderWaivers();
  });
}

// ============================================================== IN-SEASON
const IS = {view: "buy", team: "", sort: null, dir: -1};
const OUT_SET = ["OUT", "INJURY_RESERVE", "SUSPENSION"];
const DROP_MARGIN = 0.08;   // a swap must gain 8%+ of the player's ROS points to be called
// per-player season view under the ACTIVE league: now, luck-adjusted, ROS
function seasonLine(p) {
  const now = p.td && p.gp ? fpg(p.td, p.tbp || [0, 0, 0]) : null;
  const adj = p.adj ? fpg(p.adj, p.abp) : null;
  const ros = fpg(p.s, p.bp);
  const pre = p.ps ? fpg(p.ps, p.pbp) : null;
  const left = TEAMLEFT[p.tm] || 0;
  return {p, now, adj, ros, pre, gp: p.gp || 0, gap: now != null && adj != null ? adj - now : null,
    gl: (p.av || 0) * left, tot: ros * (p.av || 0) * left};
}
// the luck items that explain a gap, from the season breakdown (default scoring)
function luckWhy(p, sign) {
  if (!p.lb || !p.gp) return "";
  const items = p.lb.filter(([, v]) => sign * v > 0).sort((a, b) => sign * (b[1] - a[1])).slice(0, 2);
  const word = {"2P%": "2-pt shooting", "3P%": "3-pt shooting", "FG%": "shooting", "FT%": "FT%", "FTA": "free throws",
    REB: "rebounds", STL: "steals", BLK: "blocks", TOV: "turnovers", bonus: "bonuses", "3PA mix": "shot mix"};
  return items.map(([k, v]) => `${word[k] || k} ${sg(v / p.gp)}`).join(", ");
}
function lucks(id) {
  const C = GAMES.C;
  return (GAMES.byP[id] || []).slice().sort((a, b) => (a[C.d] < b[C.d] ? -1 : 1)).filter((r) => r[C.adj]).map((r) =>
    fpg(STATS.map((k) => r[C[k]]), [r[C.dd], r[C.td], r[C.qd]]) - fpg(r[C.adj], r[C.abp]));
}
const keepSet = () => new Set((L.keep || []).map(normName));
function renderInseason() {
  const lg = LGRES[L.id], mt = myTeam();
  const body = $("is-body");
  $("is-keepbox").hidden = IS.view !== "drop";
  $("is-teamctl").hidden = IS.view !== "buy" || !lg;
  if (!lg) {
    $("is-lede").innerHTML = "";
    body.innerHTML = L.platform === "espn" && /^\d+$/.test(L.id || "")
      ? '<p class="note">Loading your league&rsquo;s rosters from ESPN&hellip;</p>'
      : '<div class="msg info">This tab reads rosters from a public ESPN league. Pull one on the League tab.</div>';
    return;
  }
  if (!GAMES) { body.innerHTML = '<p class="note">Loading games&hellip;</p>'; loadGames().then(renderInseason); return; }
  if (IS.view !== "rost" && IS.view !== "buy" && mt == null) {
    body.innerHTML = '<div class="msg info">Pick your team at the top (&ldquo;You are&rdquo;).</div>';
    return;
  }
  const tname = (id) => (lg.byId[id] || {}).name || "";
  const tab = (id) => (lg.byId[id] || {}).ab || "";
  const all = PLAYERS.map(seasonLine);
  const mine = all.filter((r) => lg.owner[r.p.id] === mt);
  const H = (k, lbl, cls = "", tip = "") =>
    `<th${k ? ` data-k="${k}"` : ""} class="${cls}${IS.sort === k ? " on" + (IS.dir > 0 ? " asc" : "") : ""}"${tip ? ` title="${esc(tip)}"` : ""}>${lbl}</th>`;
  const sortBy = (rows, def) => {
    const k = IS.sort || def, dir = IS.sort ? IS.dir : -1;
    const v = (r) => (k === "n" ? r.p.n : k === "team" ? tname(lg.owner[r.p.id]) : r[k]);
    return rows.sort((a, b) => {
      const x = v(a), y = v(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return typeof x === "string" ? dir * x.localeCompare(y) : dir * (x - y);
    });
  };
  const cut = (v, t = 3) => (v == null ? "" : v >= t ? "pos-up" : v <= -t ? "pos-dn" : "");
  const luckCols = (r, sign) =>
    `<td>${r.gp}</td><td class="grp">${fx(r.now)}</td><td>${fx(r.adj)}</td>` +
    `<td class="big ${sign > 0 ? (r.gap >= 2 ? "pos-up" : "") : (r.gap <= -2 ? "pos-dn" : r.gap >= 2 ? "pos-up" : "")}">${sign > 0 ? sg(r.gap) : sg(-r.gap)}</td>` +
    `<td class="l dim" style="white-space:normal;min-width:11rem">${esc(luckWhy(r.p, -sign))}</td>` +
    `<td class="grp">${fx(r.ros)}</td><td>${fx(r.pre)}</td><td class="${r.pre != null && r.now != null ? cut(r.now - r.pre) : ""}">${r.pre != null && r.now != null ? sg(r.now - r.pre) : "-"}</td>` +
    `<td class="dim">${r.p.pre_rank ?? "-"}</td><td>${spark(lucks(r.p.id), 110, 26)}</td>`;
  const luckHead = (sign) =>
    H("gp", "GP") + H("now", "Now FP/G", "grp", "Actual FP/G this season") +
    H("adj", "Luck-adj", "", "FP/G with luck removed: his own per-minute rates at the minutes he played, plus his real shot attempts and assists (the parts that carry into future games)") +
    H("gap", sign > 0 ? "Buy-low gap" : "Luck/G", "big", sign > 0 ? "Luck-adjusted minus actual FP/G: how far the box score is running BELOW his real level" : "Actual minus luck-adjusted FP/G: how much of his box score is luck") +
    `<th class="l">${sign > 0 ? "Ran cold on" : "Ran hot on"}</th>` +
    H("ros", "ROS FP/G", "grp", "Our rest-of-season projection (the tested in-season blend)") +
    H("pre", "Draft-day FP/G", "", "What we projected before the season: roughly what his manager drafted him to be") +
    H("vsdraft", "Now vs draft", "", "Actual FP/G minus the draft-day projection. Early in the season managers judge players against draft cost") +
    H("pre_rank", "Pre #", "", "Preseason board rank") + "<th>Luck by game</th>";
  all.forEach((r) => { r.vsdraft = r.pre != null && r.now != null ? r.now - r.pre : null; });
  const gpDone = Math.max(...Object.values(META.sched).map((g) => g.filter((x) => x[0] <= META.last_game_day).length));

  if (IS.view === "buy") {
    const teams = [["", "All other teams"]].concat(lg.teams.filter((t) => t.id !== mt).map((t) => [String(t.id), t.name]));
    $("is-team").innerHTML = teams.map(([v, n]) => `<option value="${v}"${v === IS.team ? " selected" : ""}>${esc(n)}</option>`).join("");
    let rows = all.filter((r) => {
      const o = lg.owner[r.p.id];
      return o != null && o !== mt && (!IS.team || String(o) === IS.team) && r.gp >= 3 && r.gap != null && r.gap > 0 &&
        Math.max(r.now, r.adj) >= 20;
    });
    rows = sortBy(rows, "gap");
    body.innerHTML = '<div class="tablewrap"><table id="is-table"><thead><tr>' + H("n", "Player", "l") +
      H("team", "Fantasy team", "l") + '<th class="l">Tm</th>' + luckHead(1) + "</tr></thead><tbody>" +
      rows.map((r) => `<tr data-id="${r.p.id}"><td class="l name">${esc(r.p.n)}${tags(r.p)}</td>` +
        `<td class="l">${esc(tname(lg.owner[r.p.id]))}</td><td class="l dim">${esc(r.p.tm)}</td>${luckCols(r, 1)}</tr>`).join("") +
      "</tbody></table></div>";
    $("is-count").textContent = `${rows.length} players running below their real level`;
    $("is-lede").innerHTML = `Players on other teams whose <strong>luck-adjusted</strong> FP/G is above what they are actually scoring: ` +
      `the box score is running behind the level their minutes, shots and assists say is real, so their managers may sell low. ` +
      `Early in the season managers still judge players against what they drafted them to be (<strong>Now vs draft</strong>); later they go by average points. ` +
      `The best targets combine a big buy-low gap with a disappointing start. About ${gpDone} team games played so far, so small samples swing.`;
  } else if (IS.view === "sell") {
    let rows = mine.filter((r) => r.gp >= 1 && r.gap != null);
    rows.forEach((r) => { r.luckg = -r.gap; });
    rows = sortBy(rows, "luckg");
    body.innerHTML = '<div class="tablewrap"><table id="is-table"><thead><tr>' + H("n", "Player", "l") + '<th class="l">Tm</th>' +
      luckHead(-1).replace('data-k="gap"', 'data-k="luckg"') + "</tr></thead><tbody>" +
      rows.map((r) => `<tr data-id="${r.p.id}"><td class="l name">${esc(r.p.n)}${tags(r.p)}</td><td class="l dim">${esc(r.p.tm)}</td>` +
        luckCols(r, -1) + "</tr>").join("") + "</tbody></table></div>";
    const hot = rows.filter((r) => r.luckg >= 2).length;
    $("is-count").textContent = `${hot} of your ${rows.length} players running 2+ FP/G hot`;
    $("is-lede").innerHTML = `Your players, most luck-inflated first. <strong>Luck/G</strong> is the part of each player&rsquo;s FP/G that ` +
      `comes from things that don&rsquo;t carry over (hot shooting, steal and block spikes). A player well above his draft-day number ` +
      `<em>and</em> running hot is the classic sell-high: other managers see the box score.`;
  } else if (IS.view === "drop") {
    const keep = keepSet();
    $("is-keep").value = (L.keep || []).join("\n");
    const fa = all.filter((r) => lg.owner[r.p.id] == null && !OUT_SET.includes(r.p.inj) && r.tot > 0)
      .sort((a, b) => b.tot - a.tot);
    const posOf = (p) => String(p.elig || p.pos || "").split(/[,/ ]+/).filter(Boolean);
    let rows = mine.filter((r) => lg.slot[r.p.id] !== 13).map((r) => {
      const ps = posOf(r.p);
      const best = fa.find((f) => posOf(f.p).some((x) => ps.includes(x)));
      const kept = keep.has(normName(r.p.n));
      return Object.assign(r, {best, gain: best ? best.tot - r.tot : null, kept});
    });
    rows = sortBy(rows, "gain");
    const irs = mine.filter((r) => lg.slot[r.p.id] === 13);
    body.innerHTML = '<div class="tablewrap"><table id="is-table"><thead><tr>' + H("n", "Player", "l") + '<th class="l">Pos</th>' +
      H("ros", "ROS FP/G", "grp") + H("gl", "Games left", "", "Projected games: availability x his team's games left") +
      H("tot", "ROS points", "big", "Rest-of-season points = ROS FP/G x projected games left") +
      '<th class="l grp">Best free agent at his positions</th><th>FA ROS FP/G</th><th>FA ROS points</th>' +
      H("gain", "Gain if swapped", "big") + '<th class="l">Verdict</th></tr></thead><tbody>' +
      rows.map((r) => {
        const b = r.best;
        const verdict = r.kept ? '<span class="dim">keep list</span>'
          : r.gain > DROP_MARGIN * r.tot ? '<b class="pos-dn">Drop candidate</b>'
          : r.gain > 0 ? '<span title="Gain under 8% of his rest-of-season points: inside projection noise">close call</span>'
          : '<span class="dim">hold</span>';
        return `<tr data-id="${r.p.id}"><td class="l name">${esc(r.p.n)}${tags(r.p)}</td><td class="l dim">${esc(posOf(r.p).join(","))}</td>` +
          `<td class="grp">${fx(r.ros)}</td><td>${fx(r.gl, 0)}</td><td class="big">${fx(r.tot, 0)}</td>` +
          `<td class="l grp">${b ? `<span class="name" data-id="${b.p.id}">${esc(b.p.n)}</span> <span class="dim">${esc(b.p.tm)} · ${esc(posOf(b.p).join(","))}${lg.wv[b.p.id] ? " · WVR" : ""}</span>` : "-"}</td>` +
          `<td>${b ? fx(b.ros) : "-"}</td><td>${b ? fx(b.tot, 0) : "-"}</td>` +
          `<td class="big ${r.gain > DROP_MARGIN * r.tot && !r.kept ? "pos-dn" : ""}">${r.gain == null ? "-" : sg(r.gain, 0)}</td><td class="l">${verdict}</td></tr>`;
      }).join("") + "</tbody></table></div>" +
      (irs.length ? `<p class="note">On your IR slot (not counted): ${irs.map((r) => esc(r.p.n)).join(", ")}.</p>` : "") +
      '<h3>Best available free agents (rest of season)</h3><div class="tablewrap" style="max-height:22rem"><table><thead><tr><th class="l">Player</th><th class="l">Tm</th><th class="l">Pos</th>' +
      '<th>ROS FP/G</th><th>Games left</th><th>ROS points</th><th>Now FP/G</th><th>Luck/G</th><th>Own%</th></tr></thead><tbody>' +
      fa.slice(0, 15).map((f) => `<tr data-id="${f.p.id}"><td class="l name">${esc(f.p.n)}${tags(f.p)}${lg.wv[f.p.id] ? '<span class="tag wvr">WVR</span>' : ""}</td>` +
        `<td class="l dim">${esc(f.p.tm)}</td><td class="l dim">${esc(posOf(f.p).join(","))}</td><td>${fx(f.ros)}</td><td>${fx(f.gl, 0)}</td>` +
        `<td class="big">${fx(f.tot, 0)}</td><td>${fx(f.now)}</td><td class="${f.gap == null ? "" : -f.gap >= 1 ? "pos-dn" : -f.gap <= -1 ? "pos-up" : ""}">${f.gap == null ? "-" : sg(-f.gap)}</td>` +
        `<td class="dim">${f.p.own != null ? f.p.own.toFixed(0) : "-"}</td></tr>`).join("") + "</tbody></table></div>";
    const n = rows.filter((r) => r.gain > DROP_MARGIN * r.tot && !r.kept).length;
    $("is-count").textContent = `${n} drop candidate${n === 1 ? "" : "s"}`;
    $("is-lede").innerHTML = `Each of your players against the best free agent who shares a position with him, on <strong>rest-of-season points</strong> ` +
      `(projected FP/G × projected games left, so injuries and schedule count). In an ${L.teams}-team league almost every rostered player&rsquo;s ` +
      `games reach your lineup, so season points are a fair stand-in for lineup points; the week-by-week lineup math is the My week tab. ` +
      `Players on your keep list and your IR slot are never suggested.`;
  } else {
    const cards = lg.teams.map((t) => {
      const rs = all.filter((r) => lg.owner[r.p.id] === t.id).sort((a, b) => b.ros - a.ros);
      const tot = rs.reduce((a, r) => a + r.tot, 0);
      const lk = rs.reduce((a, r) => a + (r.gap != null ? -r.gap * r.gp : 0), 0);
      return {t, rs, tot, lk};
    }).sort((a, b) => b.tot - a.tot);
    body.innerHTML = '<div class="stand">' + cards.map((c, i) => `<div class="card${c.t.id === mt ? " mycard" : ""}">` +
      `<h4>#${i + 1}<b>${esc(c.t.name)}</b>${c.t.id === mt ? ' <span class="tag rk">YOU</span>' : ""}</h4>` +
      `<div class="srow sub"><span>ROS points ${fx(c.tot, 0)}</span><span class="v ${c.lk >= 20 ? "pos-dn" : c.lk <= -20 ? "pos-up" : ""}">luck so far ${sg(c.lk, 0)}</span></div>` +
      c.rs.map((r) => `<div class="srow"><span class="nm" data-id="${r.p.id}">${esc(r.p.n)}</span>` +
        `<span class="sub">${esc(r.p.tm)}${lg.slot[r.p.id] === 13 ? " · IR" : ""}${OUT_SET.includes(r.p.inj) ? " · out" : ""}</span>` +
        `<span class="v">${fx(r.ros)} <span class="sub">${r.now != null ? "now " + fx(r.now) : ""}</span></span></div>`).join("") + "</div>").join("") + "</div>";
    $("is-count").textContent = `${lg.teams.length} teams`;
    $("is-lede").innerHTML = `Every roster in the league, ranked by projected <strong>rest-of-season points</strong> (each player&rsquo;s ROS FP/G × projected games left, ` +
      `summed over the roster, before streaming). <strong>Luck so far</strong> = the current roster&rsquo;s actual minus luck-adjusted points this season: ` +
      `positive means their box scores have flattered them. Each player shows ROS FP/G, then actual FP/G so far.`;
  }
  $("is-note").innerHTML = IS.view === "rost" ? "" :
    `All fantasy points under <strong>${esc(L.name)}</strong> scoring. Luck items (&ldquo;ran cold on&rdquo;) are per game, measured under the default league scoring. ` +
    `Rosters are read live from ESPN; projections are from this morning&rsquo;s build (games through ${esc(META.last_game_day)}).`;
}
function bindInseason() {
  document.querySelectorAll("#is-view .chip").forEach((c) => c.addEventListener("click", () => {
    IS.view = c.dataset.v; IS.sort = null;
    document.querySelectorAll("#is-view .chip").forEach((x) => x.setAttribute("aria-pressed", String(x === c)));
    renderInseason();
  }));
  $("is-team").addEventListener("change", (e) => { IS.team = e.target.value; renderInseason(); });
  $("tab-insea").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (th) {
      const k = th.dataset.k;
      if (IS.sort === k) IS.dir = -IS.dir; else { IS.sort = k; IS.dir = ["n", "team", "pre_rank"].includes(k) ? 1 : -1; }
      renderInseason();
      return;
    }
    const n = e.target.closest("[data-id]");
    if (n && BYID[+n.dataset.id]) openPlayer(+n.dataset.id);
  });
  $("is-keep").addEventListener("input", (e) => {
    const lg = STORE.list[STORE.active];
    lg.keep = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
    L.keep = lg.keep;
    if (DRAFT.key === lg.key) DRAFT.keep = lg.keep;
    writeStore();
    clearTimeout(bindInseason.t);
    bindInseason.t = setTimeout(renderInseason, 400);
  });
}

// ================================================================ MY WEEK
// Each day's lineup is the exact max-weight assignment of the players who
// play that day to the league's starter slots (Hungarian algorithm; ported
// from the old Wire tab, where an independent scipy check reproduced it).
const WK = {week: null, team: null, mm: null, mmP: null};
const SLOT_ID = Object.fromEntries(Object.entries(ESPN_SLOT).map(([k, v]) => [v, +k]));
function assignMax(Wm) {                 // rows x cols, values >= 0
  const n = Wm.length, m = n ? Wm[0].length : 0, rc = new Array(n).fill(-1);
  if (!n || !m) return {total: 0, rc};
  const T = n > m, A = T ? m : n, B = T ? n : m, INF = 1e18;
  const cost = (i, j) => -(T ? Wm[j][i] : Wm[i][j]);
  const u = new Array(A + 1).fill(0), v = new Array(B + 1).fill(0), p = new Array(B + 1).fill(0), way = new Array(B + 1).fill(0);
  for (let i = 1; i <= A; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(B + 1).fill(INF), used = new Array(B + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= B; j++) if (!used[j]) {
        const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= B; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const jj = way[j0]; p[j0] = p[jj]; j0 = jj; } while (j0);
  }
  let total = 0;
  for (let j = 1; j <= B; j++) if (p[j]) {
    const a = p[j] - 1, b = j - 1, r = T ? b : a, c = T ? a : b;
    if (Wm[r][c] > 0) { rc[r] = c; total += Wm[r][c]; }
  }
  return {total, rc};
}
function eligFromPos(pos) {              // ESPN position names -> slot ids
  const s = new Set([11]);
  String(pos || "").split(/[,/]/).forEach((t) => {
    const k = {PG: 0, SG: 1, SF: 2, PF: 3, C: 4}[t.trim().toUpperCase()];
    if (k == null) return;
    s.add(k);
    if (k <= 1) { s.add(5); s.add(8); }
    if (k === 2 || k === 3) { s.add(6); s.add(8); s.add(10); }
    if (k === 1 || k === 2) s.add(7);
    if (k === 3 || k === 4) s.add(9);
    if (k === 4) s.add(10);
  });
  return [...s];
}
const todayET = () => new Intl.DateTimeFormat("en-CA", {timeZone: "America/New_York"}).format(new Date());
const outKey = (wk) => `fnba.v2.week.${L.key}.${wk}`;
function weekMarks(wk) {
  try { return JSON.parse(localStorage.getItem(outKey(wk)) || "{}") || {}; } catch (e) { return {}; }
}
function setWeekMark(wk, id, plays) {
  const m = weekMarks(wk);
  m[id] = plays ? 1 : 0;
  try { localStorage.setItem(outKey(wk), JSON.stringify(m)); } catch (e) { /* storage blocked */ }
}
function loadMatchups(lg) {
  if (WK.mm) return Promise.resolve(WK.mm);
  if (!WK.mmP) WK.mmP = fetch(espnBase() + L.id + "?view=mMatchupScore").then((r) => (r.ok ? r.json() : {schedule: []}))
    .catch(() => ({schedule: []})).then((j) => { WK.mm = j.schedule || []; return WK.mm; });
  return WK.mmP;
}
function loadReturns(lg) {
  const ids = Object.keys(lg.owner).map(Number).filter((id) =>
    (lg.slot[id] === 13 || OUT_SET.includes(lg.inj[id])) && !(id in lg.ret));
  if (!ids.length) return Promise.resolve();
  ids.forEach((id) => { lg.ret[id] = null; });
  const flt = JSON.stringify({players: {filterIds: {value: ids}, limit: ids.length + 5,
                                        sortPercOwned: {sortPriority: 1, sortAsc: false}}});
  return fetch(espnBase() + L.id + "?view=kona_playercard", {headers: {"x-fantasy-filter": flt}})
    .then((r) => (r.ok ? r.json() : {players: []})).catch(() => ({players: []}))
    .then((k) => (k.players || []).forEach((w) => {
      const pl = w.player || {}, d = (pl.injuryDetails || {}).expectedReturnDate;
      if (pl.id != null && d && d.length === 3)
        lg.ret[pl.id] = `${d[0]}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}`;
    }));
}
// a team's week: per player, per day -> game?, plays?, value, started?
function teamWeek(lg, teamId, days, wk, SLOTS, today) {
  const marks = weekMarks(wk);
  const B = META.b2b;
  const ps = Object.keys(lg.owner).map(Number).filter((id) => lg.owner[id] === teamId).map((id) => {
    const p = BYID[id];
    const inj = lg.inj[id], ret = lg.ret[id];
    const hurt = OUT_SET.includes(inj) || lg.slot[id] === 13;
    const plays = id in marks ? !!marks[id] : !hurt || !!ret;
    const elig = (lg.elig[id] && lg.elig[id].length ? lg.elig[id] : eligFromPos(p && p.pos)).filter((s) => SLOTS.includes(s));
    const r = {id, n: p ? p.n : lg.name[id] || "#" + id, p, inj, ret, hurt, plays, manual: id in marks, elig, days: [],
      starts: 0, games: 0, pts: 0, var: 0};
    const fp = p ? fpg(p.s, p.bp) : 0;
    const fpd = p ? fpgUnder(META.league, p.s, p.bp) || fp : 1;
    const scale = fpd > 0 ? fp / fpd : 1;
    const sd = p ? (p.sd || 0) * scale : 0;
    const teamDays = new Set(p ? (META.sched[p.tm] || []).map((g) => g[0]) : []);
    const psit = p && p.b2b ? p.b2b[2] : B.base;
    days.forEach((d) => {
      const g = p ? (META.sched[p.tm] || []).find((x) => x[0] === d) : null;
      let val = 0, avail = false;
      if (g && plays && !(hurt && !(id in marks) && ret && d < ret)) {
        const second = teamDays.has(addDays(d, -1));
        const play = second ? Math.max(0, 1 - Math.max(0, psit - B.other)) : 1;
        const mf = META.mf[g[1]];
        let adj = 0;
        if (mf) {
          const c = posCls(p.pos), b = META.mfb;
          adj = (b.pace * (mf.pace - 1) + b.dvp * ((mf[c] || 1) - 1) + b.fgp * ((mf.fgp || 1) - 1) + b.home * (g[2] ? 0.5 : -0.5)) * scale;
        }
        val = Math.max(0, play * (fp + adj));
        avail = true;
      }
      r.days.push({d, g, avail, val, sd2: sd * sd, st: false});
    });
    return r;
  });
  const out = {ps, days: days.map((d, i) => ({d, past: d < today, open: 0, started: 0, playing: 0, pts: 0}))};
  days.forEach((d, i) => {
    const av = ps.filter((r) => r.days[i].avail);
    const Wm = av.map((r) => SLOTS.map((s) => (r.elig.includes(s) ? Math.max(r.days[i].val, 0.01) : 0)));
    const res = assignMax(Wm);
    av.forEach((r, k) => {
      r.games++;
      if (res.rc[k] >= 0) {
        r.days[i].st = true; r.starts++;
        if (d >= today) { r.pts += r.days[i].val; r.var += r.days[i].sd2; }
      }
    });
    const D = out.days[i];
    D.playing = av.length; D.started = res.rc.filter((c) => c >= 0).length; D.open = SLOTS.length - D.started;
    D.pts = d >= today ? av.reduce((a, r, k) => a + (res.rc[k] >= 0 ? r.days[i].val : 0), 0) : 0;
  });
  out.rem = ps.reduce((a, r) => a + r.pts, 0);
  out.var = ps.reduce((a, r) => a + r.var, 0);
  return out;
}
const normCdf = (x) => {   // Abramowitz-Stegun
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};
function renderWeek() {
  const lg = LGRES[L.id];
  if (!lg) {
    $("wk-cards").innerHTML = "";
    $("wk-detail").innerHTML = L.platform === "espn" && /^\d+$/.test(L.id || "")
      ? '<p class="note">Loading your league from ESPN&hellip;</p>'
      : '<div class="msg info">My week reads rosters and matchups from a public ESPN league. Pull one on the League tab.</div>';
    return;
  }
  if (!WK.mm) {
    $("wk-detail").innerHTML = '<p class="note">Loading matchups&hellip;</p>';
    Promise.all([loadMatchups(lg), loadReturns(lg)]).then(renderWeek);
    return;
  }
  const today = todayET();
  const weeks = META.weeks.filter((w) => w[2] >= today).slice(0, 2);
  if (!weeks.length) { $("wk-detail").innerHTML = '<p class="note">No matchup weeks left this season.</p>'; return; }
  if (WK.week == null || !weeks.some((w) => w[0] === WK.week)) WK.week = weeks[0][0];
  $("wk-week").innerHTML = weeks.map(([w, s, e]) => `<option value="${w}"${w === WK.week ? " selected" : ""}>Week ${w} (${s.slice(5)} to ${e.slice(5)})${s <= today ? " · now" : ""}</option>`).join("");
  const [wk, ws, we] = META.weeks.find((w) => w[0] === WK.week);
  const days = [];
  for (let d = ws; d <= we; d = addDays(d, 1)) days.push(d);
  const SLOTS = [];
  Object.entries(L.slots).forEach(([nm, c]) => {
    const id = SLOT_ID[nm];
    if (id == null || nm === "BE" || nm === "IR") return;
    for (let q = 0; q < c; q++) SLOTS.push(id);
  });
  SLOTS.sort((a, b) => a - b);
  const TW = Object.fromEntries(lg.teams.map((t) => [t.id, teamWeek(lg, t.id, days, wk, SLOTS, today)]));
  const lim = L.adds;
  const addsLeft = (id) => (lim == null ? null : Math.max(0, lim - ((lg.tx[id] || {})[String(wk)] || 0)));
  const mt = myTeam();
  if (WK.team == null || !lg.byId[WK.team]) WK.team = mt != null ? mt : lg.teams[0].id;
  $("wk-team").innerHTML = lg.teams.map((t) => `<option value="${t.id}"${t.id === WK.team ? " selected" : ""}>${esc(t.name)}${t.id === mt ? " (you)" : ""}</option>`).join("");
  // ---- matchup cards
  const ms = WK.mm.filter((m) => m.matchupPeriodId === wk && m.home && m.away);
  const live = (side) => (side.totalPointsLive != null ? side.totalPointsLive : side.totalPoints) || 0;
  const cards = ms.map((m) => {
    const A = m.away, H = m.home, a = TW[A.teamId], h = TW[H.teamId];
    if (!a || !h) return "";
    const al = live(A), hl = live(H), ap = al + a.rem, hp = hl + h.rem;
    const sd = Math.sqrt(a.var + h.var);
    const pa = sd > 0 ? normCdf((ap - hp) / sd) : (ap > hp ? 1 : ap < hp ? 0 : 0.5);
    const isMine = A.teamId === mt || H.teamId === mt, sel = A.teamId === WK.team || H.teamId === WK.team;
    const side = (s, t, l, pr, p) => `<span class="tn${s.teamId === mt ? " mine" : ""}" title="${esc(lg.byId[s.teamId].name)}">${esc(lg.byId[s.teamId].name)}</span>` +
      `<span class="lv" title="Live score">${fx(l, 0)}</span><span class="pf" title="Projected final">${fx(pr, 0)}</span>`;
    const st = (t) => t.days.filter((D) => !D.past).reduce((x, D) => x + D.started, 0);
    return `<div class="card mcard${isMine ? " mycard" : ""}${sel ? " sel" : ""}" data-a="${A.teamId}" data-h="${H.teamId}">` +
      `<div class="mside"><span class="dim" style="font-size:.7rem">TEAM</span><span class="dim" style="font-size:.7rem">LIVE</span><span class="dim" style="font-size:.7rem">PROJ</span>` +
      side(A, a, al, ap, pa) + side(H, h, hl, hp, 1 - pa) + "</div>" +
      `<div class="wbar" title="Rough win chance"><span style="width:${(pa * 100).toFixed(0)}%"></span></div>` +
      `<div class="mfoot"><span>win ${Math.round(pa * 100)}% – ${Math.round((1 - pa) * 100)}%</span>` +
      `<span title="Starter games left this week">starts left ${st(a)} – ${st(h)}</span>` +
      (lim != null ? `<span title="Adds left this week">adds ${addsLeft(A.teamId)} – ${addsLeft(H.teamId)}</span>` : "") + "</div></div>";
  }).join("");
  $("wk-cards").innerHTML = cards || '<p class="note">No matchups found for this week (a bye week, or this league&rsquo;s matchup periods don&rsquo;t follow this calendar).</p>';
  // ---- team detail
  const T = TW[WK.team], tname = lg.byId[WK.team].name;
  const dn = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short"});
  const rows = T.ps.slice().sort((a, b) => b.pts - a.pts || b.games - a.games);
  const cell = (r, D, i) => {
    const x = r.days[i], past = D.past ? " past" : "";
    if (!x.g) return `<td class="dg${past}"></td>`;
    if (!x.avail) return `<td class="dg out${past}" title="Not playing">×</td>`;
    return x.st ? `<td class="dg st${past}" title="Starts: ${fx(x.val)} projected">●</td>`
      : `<td class="dg bn${past}" title="Plays but no starter slot left">○</td>`;
  };
  $("wk-detail").innerHTML = `<h2>${esc(tname)} &mdash; week ${wk}</h2>` +
    '<div class="tablewrap" style="max-height:none"><table><thead><tr><th class="l" title="Untick a player you know won\'t play this week">Plays</th><th class="l">Player</th><th class="l">Status</th>' +
    days.map((d, i) => `<th class="${T.days[i].past ? "past" : ""}">${dn(d)}<br><span class="dim">${d.slice(5)}</span></th>`).join("") +
    '<th class="grp" title="Games this week / games in a starter slot">Games / starts</th><th title="Projected points from his remaining starts">Proj left</th></tr></thead><tbody>' +
    rows.map((r) => `<tr class="${r.plays ? "" : "isout"}"><td class="l"><input type="checkbox" data-pid="${r.id}"${r.plays ? " checked" : ""} aria-label="${esc(r.n)} plays this week"></td>` +
      `<td class="l name" data-id="${r.id}">${esc(r.n)}${r.p ? "" : ' <span class="dim">(no projection)</span>'}</td>` +
      `<td class="l dim">${r.hurt ? (lg.slot[r.id] === 13 ? "IR" : esc(String(r.inj).replace("INJURY_RESERVE", "IR").replace("SUSPENSION", "SUSP"))) + (r.ret ? " · back " + r.ret.slice(5) : "") : r.inj === "DAY_TO_DAY" ? "DTD" : ""}${r.manual ? " · set by you" : ""}</td>` +
      T.days.map((D, i) => cell(r, D, i)).join("") +
      `<td class="grp">${r.games} / ${r.starts}</td><td class="big">${fx(r.pts, 0)}</td></tr>`).join("") +
    `<tr class="open"><td></td><td class="l" colspan="2">Open starter slots</td>${T.days.map((D) => `<td class="dg${D.past ? " past" : ""} ${D.open ? "pos-dn" : ""}">${D.open}</td>`).join("")}<td class="grp"></td><td>${fx(T.rem, 0)}</td></tr>` +
    "</tbody></table></div>" +
    '<p class="note">● starts &nbsp; ○ plays but every eligible slot is taken &nbsp; × not playing. Open slots are days you could stream a free agent (see the Waivers tab). ' +
    "Untick anyone you know is sitting; ticks are saved for this week in your browser.</p>";
  const myM = ms.find((m) => m.home.teamId === mt || m.away.teamId === mt);
  $("wk-count").textContent = `${ms.length} matchups`;
  $("wk-lede").innerHTML = `Every matchup in week ${wk}, scored under <strong>${esc(L.name)}</strong>. <strong>Proj</strong> = the live ESPN score plus the best possible lineup on each remaining day ` +
    `(${SLOTS.length} starter slots, filled by an exact assignment of who plays that day), at rest-of-season FP/G with the matchup and back-to-back adjustments from the Waivers tab. ` +
    `Players out or on IR count from ESPN&rsquo;s expected return date when it has one. Click a matchup to see either team below.` +
    (myM ? "" : "");
  $("wk-note").innerHTML = "Win chance is rough: it treats each remaining game as independent, with each player&rsquo;s game-to-game spread (the same one behind the Waivers ceiling). " +
    "While tonight&rsquo;s games are being played, players already in action count twice (in the live score and the projection) until the next morning&rsquo;s build. Rosters, injuries, live scores and adds are read from ESPN; projections are from this morning.";
}
function bindWeek() {
  $("wk-week").addEventListener("change", (e) => { WK.week = +e.target.value; renderWeek(); });
  $("wk-team").addEventListener("change", (e) => { WK.team = +e.target.value; renderWeek(); });
  $("wk-cards").addEventListener("click", (e) => {
    const c = e.target.closest(".mcard");
    if (!c) return;
    const a = +c.dataset.a, h = +c.dataset.h;
    WK.team = WK.team === a ? h : WK.team === h ? a : (h === myTeam() ? h : a);
    renderWeek();
    $("wk-detail").scrollIntoView({behavior: "smooth", block: "start"});
  });
  $("wk-detail").addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-pid]");
    if (!cb) return;
    setWeekMark(WK.week, +cb.dataset.pid, cb.checked);
    renderWeek();
  });
  $("wk-detail").addEventListener("click", (e) => {
    const n = e.target.closest(".name[data-id]");
    if (n && BYID[+n.dataset.id]) openPlayer(+n.dataset.id);
  });
}

// ================================================================ ROUTING
const TABS = ["league", "proj", "insea", "wire", "recap", "week", "trade", "how"];
function showTab(t) {
  if (!TABS.includes(t)) t = "proj";
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  TABS.forEach((k) => { $("tab-" + k).hidden = k !== t; });
  if (location.hash !== "#" + t) history.replaceState(null, "", "#" + t);
  if (t === "recap") renderRecap();
  if (t === "wire") renderWaivers();
  if (t === "insea") renderInseason();
  if (t === "week") renderWeek();
}
function renderAll() {
  renderProj();
  if (!$("tab-recap").hidden) renderRecap();
  if (!$("tab-wire").hidden) renderWaivers();
  if (!$("tab-insea").hidden) renderInseason();
  if (!$("tab-week").hidden) renderWeek();
}

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
    fillTeamPicker();
    renderLeagueForm();
    bindLeague();
    bindProj();
    bindRecap();
    bindWaivers();
    bindInseason();
    bindWeek();
    document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
    $("scrim").addEventListener("click", (e) => { if (e.target === $("scrim")) closePlayer(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePlayer(); });
    renderAll();
    showTab((location.hash || "#proj").slice(1));
    refreshLeagueData();
  })
  .catch((e) => {
    document.querySelector("main").innerHTML = '<div class="msg err">Could not load the data (' + esc(e.message) + ").</div>";
  });
})();
