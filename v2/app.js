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

let SL2ID = {};
let META, PLAYERS, BYID = {}, STATS, TEAMLEFT = {}, GAMES = null, GAMES_P = null;
let DATA_V = "";                     // cache-buster, set by the Refresh button
const NC = {cache: "no-cache"};      // revalidate data files: a daily build must not be hidden by the browser cache
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
// extra scoring rules (META.extras order): names for forms / columns, and how
// each platform names them
const X_LBL = {TF: "Technical fouls", FF: "Flagrant fouls", EJ: "Ejections", PF: "Personal fouls", DQ: "Fouled out (ESPN count)",
  P40: "40-point game", P50: "50-point game", A15: "15-assist game", R20: "20-rebound game"};
const X_COL = {TF: "Tech/g", FF: "Flag/g", EJ: "Ej/g", PF: "PF/g", DQ: "DQ/g", P40: "40+ pts", P50: "50+ pts", A15: "15+ ast", R20: "20+ reb"};
const X_MILE = new Set(["P40", "P50", "A15", "R20"]);
const ESPN_X = {7: "EJ", 8: "FF", 9: "PF", 10: "TF", 12: "DQ"};
const SL_X = {tf: "TF", ff: "FF", pf: "PF", bonus_pt_40p: "P40", bonus_pt_50p: "P50", bonus_ast_15p: "A15", bonus_reb_20p: "R20"};
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
  if (own && own.po_len == null) { own.po_len = META.league.po_len; own.adds_day = META.league.adds_day; }
  return s;
}
function writeStore() {
  try { localStorage.setItem(KEY, JSON.stringify(STORE)); return true; } catch (e) { return false; }
}
const rostered = (lg) => Object.entries(lg.slots).reduce((a, [k, v]) => a + (k === "IR" ? 0 : +v || 0), 0);
const starters = (lg) => Object.entries(lg.slots).reduce((a, [k, v]) => a + (k === "IR" || k === "BE" ? 0 : +v || 0), 0);

// fantasy points per game of a stat line under the ACTIVE league;
// bp = [double-double, triple-double, quadruple-double] rates
// the extra scoring rules (techs, flagrants, milestone bonuses...): META.extras
// order, weights in L.x. A line carries its extras as line.x (expected per game
// for projections, actual for a played game); fpg adds them under the active league.
const xfp = (xv) => {
  if (!xv || !L.x) return 0;
  let v = 0;
  (META.extras || []).forEach((k, i) => { v += (xv[i] || 0) * (L.x[k] || 0); });
  return v;
};
const withX = (arr, x) => { if (arr) arr.x = x; return arr; };
// a played game's actual extras: fouls from the box, milestones from its stats
function boxX(box, fouls) {
  const f = fouls || [0, 0, 0, 0, 0];
  return [...f, +(box[SI.PTS] >= 40), +(box[SI.PTS] >= 50), +(box[SI.AST] >= 15), +(box[SI.REB] >= 20)];
}
const rowX = (r) => { const C = GAMES.C; return boxX(STATS.map((k) => r[C[k]]), ["TF", "FF", "EJ", "PF", "DQ"].map((k) => (C[k] != null ? r[C[k]] || 0 : 0))); };
// fantasy points of one played game (games.json row), extras included
const fpgRow = (r) => { const C = GAMES.C; return fpg(withX(STATS.map((k) => r[C[k]]), rowX(r)), [r[C.dd], r[C.td], r[C.qd]]); };
function fpg(s, bp) {
  if (!s) return null;
  let v = s.x ? xfp(s.x) : 0;
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
  Object.assign(WK, {mm: null, mmP: null, pair: null, week: null});
  Object.assign(TR, {a: null, b: null}); TR.give.clear(); TR.get.clear();
  Object.assign(PT, {key: null, p: null, trades: null});
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
// After the day's first tip-off ESPN files every add, drop and IR move under the
// NEXT scoring period (one per calendar day from opening night), so its current
// roster no longer shows them: read the roster of the day moves now land in.
function espnLeague(lg) {
  if (!lg || lg.platform !== "espn" || !/^\d+$/.test(lg.id || "")) return Promise.resolve(null);
  if (!LGDATA[lg.id]) {
    const today = todayET();
    LGDATA[lg.id] = Promise.all([
      fetch(espnBase() + lg.id + "?view=mTeam&view=mRoster", {cache: "no-store"}).then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      tipPromise(today),
    ]).then(([j]) => {
      // the scoring period moves land in: today's, or tomorrow's once today has tipped
      // off (periods count calendar days from opening night). ESPN's own current
      // period can lag past midnight ET, so ask whenever it is behind.
      const first = Object.values(META.sched).reduce((m, gs) => (gs.length && gs[0][0] < m ? gs[0][0] : m), "9999");
      const want = dayLocked(today) ? addDays(today, 1) : today;
      const target = Math.round((Date.parse(want) - Date.parse(first)) / 864e5) + 1;
      const next = target > (j.scoringPeriodId || 0);
      if (!next) return [j, j, null, null];
      const get = (sp) => fetch(espnBase() + lg.id + "?view=mRoster&scoringPeriodId=" + sp, {cache: "no-store"})
        .then((r) => (r.ok ? r.json() : null)).catch(() => null).then((n) => (n && (n.teams || []).length ? n : null));
      // once today has tipped off, TODAY's lineup is the roster locked at tip-off:
      // a player dropped after the lock still plays for you tonight, one added
      // after it only counts from tomorrow. Keep that roster too (My week).
      const tp = target - 1, lockedDay = want !== today;
      return Promise.all([get(target), lockedDay ? (tp === j.scoringPeriodId ? j : get(tp)) : null])
        .then(([n, t]) => (n ? [j, n, target, lockedDay ? t : null] : [j, j, null, null]));
    }).then(([j, rj, period, tj]) => {
      const teams = (j.teams || []).map((t) => ({id: t.id, ab: t.abbrev || "",
        name: (t.name || [t.location, t.nickname].filter(Boolean).join(" ") || "Team " + t.id).trim()}));
      const owner = {}, slot = {}, name = {}, elig = {}, inj = {}, pro = {}, tx = {};
      (j.teams || []).forEach((t) => { tx[t.id] = ((t.transactionCounter || {}).matchupAcquisitionTotals) || {}; });
      (rj.teams || []).forEach((t) => {
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
      // today's locked roster (only after the first tip-off, and only when it differs)
      let locked = null;
      if (tj) {
        locked = {owner: {}, slot: {}, day: today};
        (tj.teams || []).forEach((t) => ((t.roster || {}).entries || []).forEach((e) => {
          locked.owner[e.playerId] = t.id; locked.slot[e.playerId] = e.lineupSlotId;
          const pl = (e.playerPoolEntry || {}).player;
          if (pl && !(e.playerId in name)) {          // dropped since: keep his details for today
            name[e.playerId] = pl.fullName; elig[e.playerId] = pl.eligibleSlots || [];
            inj[e.playerId] = pl.injuryStatus || null; pro[e.playerId] = pl.proTeamId;
          }
        }));
        const same = Object.keys(owner).length === Object.keys(locked.owner).length &&
          Object.keys(owner).every((id) => locked.owner[id] === owner[id]);
        if (same) locked = null;
      }
      const d = {teams, owner, slot, name, elig, inj, pro, tx, wv: {}, ret: {}, at: Date.now(), next: period, locked,
        byId: Object.fromEntries(teams.map((t) => [t.id, t]))};
      // second, optional call: which unrostered players are on waivers (not free agents)
      // ESPN answers 400 to this filter without a sort clause
      const flt = JSON.stringify({players: {filterStatus: {value: ["WAIVERS"]}, limit: 2000,
                                            sortPercOwned: {sortPriority: 1, sortAsc: false}}});
      return fetch(espnBase() + lg.id + "?view=kona_player_info", {headers: {"x-fantasy-filter": flt}, cache: "no-store"})
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
// choosing a team: save it, and give that team its default keep list if it
// has none yet (team 1 = the site owner's Lendeborg / VanVleet)
function setMyTeam(lg, v) {
  if (v == null) delete lg.my_team; else lg.my_team = v;
  const kb = (META.league.keep_by_team || {})[String(v)];
  if (v != null && kb && lg.id === META.league.id && !(lg.keep && lg.keep.length)) lg.keep = kb.slice();
  writeStore();
  L.my_team = lg.my_team; L.keep = lg.keep;
  if (DRAFT.key === lg.key) { DRAFT.my_team = lg.my_team; DRAFT.keep = lg.keep; }
}
function fillTeamPicker() {
  const tl = (STORE.list[STORE.active] || {}).tl;
  $("tmpick").hidden = !tl || !tl.length;
  $("pickteam").hidden = !tl || !tl.length || myTeam() != null;
  $("tmpick").classList.toggle("need", !!tl && myTeam() == null);
  if (!tl) return;
  const mt = myTeam();
  $("tmsel").innerHTML = (mt == null ? '<option value="">pick your team</option>' : "") +
    tl.map(([id, name]) => `<option value="${id}"${id === mt ? " selected" : ""}>${esc(name)}</option>`).join("");
}
// Sleeper league -> the same shape espnLeague() gives (owner / slot keyed by
// the site's player ids via players.json "sl"); rosters are today's
const SLB = "https://api.sleeper.app/v1/league/";
function sleeperLeague(lg) {
  if (!lg || lg.platform !== "sleeper" || !/^\d+$/.test(lg.id || "")) return Promise.resolve(null);
  if (!LGDATA[lg.id]) {
    const get = (u) => fetch(SLB + lg.id + u, {cache: "no-store"}).then((r) => (r.ok ? r.json() : null));
    LGDATA[lg.id] = Promise.all([get(""), get("/rosters"), get("/users")]).then(([info, rosters, users]) => {
      if (!info || !rosters) return null;
      if (!lg.x) {                        // saved before the extra rules were scored: read them now
        const n = sleeperToLeague(info, lg.id);
        lg.x = n.x; lg.unmod = n.unmod; writeStore();
        if (L.key === lg.key) { L.x = lg.x; L.unmod = lg.unmod; }
        if (DRAFT && DRAFT.key === lg.key) { DRAFT.x = lg.x; DRAFT.unmod = lg.unmod; renderLeagueForm(); }
      }
      const uname = Object.fromEntries((users || []).map((u) => [u.user_id, (u.metadata && u.metadata.team_name) || u.display_name || "Team"]));
      const teams = rosters.map((r) => ({id: r.roster_id, ab: "", name: uname[r.owner_id] || "Team " + r.roster_id}));
      const owner = {}, slot = {}, name = {}, unmapped = [];
      rosters.forEach((r) => {
        const ir = new Set(r.reserve || []);
        (r.players || []).forEach((sid) => {
          const id = SL2ID[sid];
          if (id == null) { unmapped.push(sid); return; }
          owner[id] = r.roster_id; slot[id] = ir.has(sid) ? 13 : 0; name[id] = BYID[id].n;
        });
      });
      const d = {teams, owner, slot, name, elig: {}, inj: {}, pro: {}, tx: {}, wv: {}, ret: {}, at: Date.now(), next: null,
        rpos: (info.roster_positions || []).filter((x) => x !== "BN"), unmapped, platform: "sleeper",
        byId: Object.fromEntries(teams.map((t) => [t.id, t]))};
      LGRES[lg.id] = d;
      return d;
    }).catch(() => null);
  }
  return LGDATA[lg.id];
}
const leagueData = (lg) => (lg && lg.platform === "sleeper" ? sleeperLeague(lg) : espnLeague(lg));
function refreshLeagueData() {
  const lg = STORE.list[STORE.active];
  return leagueData(lg).then((d) => {
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
  $("lg-polen").value = d.po_len ?? 1;
  const shown = ALL_SLOTS.filter((s) => BASE_SLOTS.includes(s) || (d.slots[s] || 0) > 0);
  $("lg-slots").innerHTML = shown.map((s) =>
    `<div class="ctl"><label for="sl-${s}">${s}</label><input id="sl-${s}" data-slot="${s}" type="number" min="0" max="15" value="${d.slots[s] || 0}"></div>`).join("");
  $("lg-scoring").innerHTML = STATS.map((s) =>
    `<div class="ctl"><label for="sc-${s}">${STAT_LBL[s]}</label><input id="sc-${s}" data-stat="${s}" type="number" step="0.5" value="${d.w[s] ?? 0}"></div>`).join("");
  $("lg-bonus").innerHTML = [["DD", "Double-double"], ["TD", "Triple-double"], ["QD", "Quad-double"]].map(([k, lbl]) =>
    `<div class="ctl"><label for="bo-${k}">${lbl}</label><input id="bo-${k}" data-bonus="${k}" type="number" step="0.5" value="${d.b[k] ?? 0}"></div>`).join("");
  $("lg-xtra").innerHTML = (META.extras || []).map((k) =>
    `<div class="ctl"><label for="xs-${k}" title="${esc(X_MILE.has(k) ? "Points for each " + X_LBL[k].toLowerCase() : "Points per " + X_LBL[k].toLowerCase().replace(/s$/, ""))}">${X_LBL[k]}</label><input id="xs-${k}" data-xtra="${k}" type="number" step="0.5" value="${(d.x || {})[k] ?? 0}"></div>`).join("");
  $("lg-cum").checked = !!d.cum;
  $("lg-unmod").innerHTML = (d.unmod && d.unmod.length)
    ? "This league also scores " + d.unmod.map(esc).join(", ") + " &mdash; the model does not project " +
      (d.unmod.length > 1 ? "those" : "that") + ", so it is left out of every number here."
    : "";
  rosterNote();
  $("lg-del").textContent = !STORE.list[d.key] ? "Discard this new league" : Object.keys(STORE.list).length > 1 ? "Delete this league" : "Reset to default";
  $("lg-state").textContent = STORE.list[d.key] ? (d.key === STORE.active ? "Active league" : "Saved") : "Not saved yet";
  $("lg-form-h").innerHTML = `League settings: ${esc(d.name || "New league")}`;
  renderLeagueList();
}
// every saved league stays on screen, whichever one the form below is editing
const PLAT_LBL = {espn: "ESPN", sleeper: "Sleeper", fantrax: "Fantrax", yahoo: "Yahoo", custom: "Entered by hand"};
function renderLeagueList() {
  const all = Object.values(STORE.list);
  if (DRAFT && !STORE.list[DRAFT.key]) all.push(DRAFT);
  $("lg-list").innerHTML = all.map((lg) => {
    const saved = !!STORE.list[lg.key], active = lg.key === STORE.active, editing = DRAFT && lg.key === DRAFT.key;
    const sc = STATS.filter((k) => lg.w && lg.w[k]).slice(0, 6).map((k) => `${STAT_LBL[k]} ${lg.w[k]}`).join(" · ");
    return `<div class="lgcard${active ? " on" : ""}${editing ? " ed" : ""}">` +
      `<div class="lgc-h"><strong>${esc(lg.name || "New league")}</strong>` +
      `<span class="lgc-plat">${PLAT_LBL[lg.platform] || "Entered by hand"}</span>` +
      (active ? '<span class="tag rk" style="margin:0">ACTIVE</span>' : "") + (!saved ? '<span class="tag dtd" style="margin:0">NOT SAVED</span>' : "") + "</div>" +
      `<div class="lgc-sub">${lg.teams || "?"} teams · ${starters(lg)} starters + ${(lg.slots && lg.slots.BE) || 0} bench` +
      (lg.type && lg.type !== "points" ? ` · ${TYPES[lg.type]}` : "") + (lg.mode ? ` · ${lg.mode === "lockin" ? "Lock-In" : "Game Pick"}` : "") + `</div>` +
      (sc ? `<div class="lgc-sc dim">${esc(sc)}${STATS.filter((k) => lg.w && lg.w[k]).length > 6 ? " · …" : ""}</div>` : "") +
      `<div class="lgc-act">` +
      (saved && !active ? `<button class="btn small primary" data-lguse="${esc(lg.key)}">Use this league</button>` : "") +
      (editing ? '<span class="dim lgc-ed">Editing below</span>' : `<button class="btn small" data-lgedit="${esc(lg.key)}">Edit</button>`) +
      "</div></div>";
  }).join("");
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
  d.po_len = Math.max(1, parseInt($("lg-polen").value, 10) || 1);
  // a hand-edited schedule overrides ESPN's matchup map
  if (d.mp && JSON.stringify(d.playoff_weeks) !== JSON.stringify(DRAFT.playoff_weeks)) d.mp = null;
  if (d.mp && d.po_len !== DRAFT.po_len) d.mp = null;
  document.querySelectorAll("#lg-slots input").forEach((el) => { d.slots[el.dataset.slot] = Math.max(0, parseInt(el.value, 10) || 0); });
  document.querySelectorAll("#lg-scoring input").forEach((el) => { d.w[el.dataset.stat] = parseFloat(el.value) || 0; });
  document.querySelectorAll("#lg-bonus input").forEach((el) => { d.b[el.dataset.bonus] = parseFloat(el.value) || 0; });
  d.x = {};
  document.querySelectorAll("#lg-xtra input").forEach((el) => { const v = parseFloat(el.value) || 0; if (v) d.x[el.dataset.xtra] = v; });
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
    const key = "espn-" + id;
    const d = espnToLeague(j, id, STORE.list[key] ? clone(STORE.list[key]) : clone(DRAFT));
    DRAFT = d;
    renderLeagueForm();
    lgMsg("ok", `Pulled <strong>${esc(d.name)}</strong>: ${d.teams} teams, ${rostered(d)} roster spots, scoring and bonuses filled in. Review, then <strong>Save league</strong>.`);
  }).catch((e) => {
    lgMsg("err", "Could not pull league " + esc(id) + " (" + esc(e.message) + "). Private leagues can't be read; make it viewable to the public in ESPN's league settings, or enter the rules by hand.");
  }).finally(() => { $("lg-pull").disabled = false; });
}
// ESPN mSettings -> a league object (scoring, slots, adds, playoffs)
function espnToLeague(j, id, d) {
    const s = j.settings || {};
    const key = "espn-" + id;
    if (!STORE.list[key]) { delete d.tl; delete d.my_team; d.keep = []; }
    d.key = key; d.id = id; d.platform = "espn"; d.type = d.type || "points";
    d.name = s.name || d.name || ("ESPN " + id);
    if (s.size) d.teams = s.size;
    const w = Object.fromEntries(STATS.map((k) => [k, 0])), b = {DD: 0, TD: 0, QD: 0}, unmod = [], x = {};
    ((s.scoringSettings || {}).scoringItems || []).forEach((it) => {
      const nm = ESPN_STAT[it.statId], pts = +it.points || 0;
      if (!pts) return;
      if (nm === "DREB") { w.REB += pts; w.OREB -= pts; }   // DREB = REB - OREB
      else if (nm in b) b[nm] = pts;
      else if (nm) w[nm] = pts;
      else if (ESPN_X[it.statId]) x[ESPN_X[it.statId]] = pts;
      else unmod.push((ESPN_UNMOD[it.statId] || "stat #" + it.statId) + " (" + (pts > 0 ? "+" : "") + pts + ")");
    });
    d.w = w; d.b = b; d.unmod = unmod; d.x = x;
    const ss = (s.scoringSettings || {});
    if (ss.scoringType && /CATEGOR|ROTO/i.test(ss.scoringType)) unmod.push("this is a categories league — the site scores points");
    const slots = {};
    Object.entries((s.rosterSettings || {}).lineupSlotCounts || {}).forEach(([k, v]) => {
      if (v && ESPN_SLOT[k]) slots[ESPN_SLOT[k]] = v;
    });
    if (Object.keys(slots).length) d.slots = slots;
    // adds: ESPN serves a per-SCORING-PERIOD (game day) limit, e.g. 4/7; a
    // matchup's limit scales with its game days (6 game days -> 3 adds)
    const acq = s.acquisitionSettings || {};
    let adds = acq.matchupAcquisitionLimit;
    d.adds_day = null;
    if (adds != null && adds > 0 && (acq.matchupLimitPerScoringPeriod || adds < 1)) { d.adds_day = adds; adds = Math.round(adds * 7); }
    d.adds = adds != null && adds >= 0 ? adds : d.adds;
    const sch = s.scheduleSettings || {};
    if (sch.matchupPeriodCount && sch.playoffTeamCount) {
      const start = sch.matchupPeriodCount + 1, len = sch.playoffMatchupPeriodLength || 1;
      d.playoff_weeks = [start, start + Math.ceil(Math.log2(sch.playoffTeamCount)) * len - 1];
      d.po_len = len;
    }
    // matchup period -> its fantasy weeks (playoff rounds can span 2+ weeks)
    d.mp = sch.matchupPeriods && Object.keys(sch.matchupPeriods).length ? sch.matchupPeriods : null;
    if (ss.scoringType && /CATEGOR|ROTO/i.test(ss.scoringType)) d.type = /ROTO/i.test(ss.scoringType) ? "roto" : "cats";
    return d;
}

// the in-season tabs read rosters from ESPN today; say so plainly for other platforms
const PLAT_NAME = {sleeper: "Sleeper", fantrax: "Fantrax", yahoo: "Yahoo"};
function rosterMsg(what) {
  const pn = PLAT_NAME[L.platform];
  if (L.platform === "sleeper") return '<p class="note">Loading your league from Sleeper&hellip;</p>';
  if (pn) return `<div class="msg info">${what} for ${pn} leagues is coming next: it needs your league&rsquo;s rosters` +
    (L.platform === "sleeper" && L.mode ? ` and ${L.mode === "lockin" ? "Lock-In" : "Game Pick"} scoring (one game per starter each week)` : "") +
    ". For now it works with public ESPN leagues. Projections, the Schedule and Team defence already use your league&rsquo;s scoring.</div>";
  return `<div class="msg info">${what} reads rosters from a public ESPN league. Add one with <button class="linkbtn" onclick="document.getElementById('addlg').click()">+ Add league</button>.</div>`;
}
// ============================================================ WELCOME POPUP
// First visit (and the header's "+ Add league"): where the league lives, what
// kind it is, its id -> read it live and say plainly what works for it.
const WEL = {plat: null, type: "points", res: null, busy: false};
const WEL_KEY = "fnba.v2.welcomed";
const PLATS = {
  espn: {name: "ESPN", hint: "The number after <code>leagueId=</code> in your ESPN league&rsquo;s web address. The league must be viewable to the public (ESPN league settings).", ph: "e.g. 242568268"},
  sleeper: {name: "Sleeper", hint: "The long number in <code>sleeper.com/leagues/&hellip;</code>. Paste the whole address if that&rsquo;s easier.", ph: "e.g. 1286125072255307776"},
  fantrax: {name: "Fantrax", hint: "The code after <code>/league/</code> in your Fantrax league&rsquo;s web address.", ph: "e.g. a1b2c3d4e5f6g7h8"},
  yahoo: {name: "Yahoo", hint: ""},
  other: {name: "Somewhere else", hint: ""},
};
const TYPES = {points: "Head-to-head points", cats: "Head-to-head categories", roto: "Rotisserie"};
function welId(plat, raw) {
  const v = String(raw || "").trim();
  if (plat === "espn") { const m = v.match(/leagueId=(\d+)/i) || v.match(/^(\d{3,12})$/); return m ? m[1] : null; }
  if (plat === "sleeper") { const m = v.match(/leagues?\/(\d{10,25})/) || v.match(/^(\d{10,25})$/); return m ? m[1] : null; }
  if (plat === "fantrax") { const m = v.match(/league\/([a-z0-9]{6,32})/i) || v.match(/^([a-z0-9]{6,32})$/i); return m ? m[1].toLowerCase() : null; }
  return null;
}
// Sleeper league -> a league object (scoring, slots, playoffs, Lock-In mode)
const SL_STAT = {pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK", to: "TOV", tpm: "FG3M",
  fgm: "FGM", fga: "FGA", ftm: "FTM", fta: "FTA", oreb: "OREB"};
const SL_UNMOD = {bonus_pt_40p: "40-point games", bonus_pt_50p: "50-point games", ff: "flagrant fouls", tf: "technical fouls",
  bonus_ast_15p: "15-assist games", bonus_reb_20p: "20-rebound games", tpa: "3-point attempts", pf: "personal fouls"};
function sleeperToLeague(j, id) {
  const d = clone(META.league), sc = j.scoring_settings || {}, st = j.settings || {};
  delete d.tl; delete d.my_team; d.keep = []; d.mp = null; d.adds_day = null;
  Object.assign(d, {key: "sleeper-" + id, id, platform: "sleeper", type: "points", name: j.name || "Sleeper " + id,
    teams: j.total_rosters || st.num_teams || d.teams, adds: null, season: j.season, status: j.status,
    mode: st.game_mode === 0 || st.game_mode == null ? "lockin" : "gamepick", mode_raw: st.game_mode ?? null, cum: true});
  const w = Object.fromEntries(STATS.map((k) => [k, 0])), b = {DD: 0, TD: 0, QD: 0}, unmod = [], x = {};
  Object.entries(sc).forEach(([k, v]) => {
    v = +v || 0; if (!v) return;
    if (SL_X[k]) x[SL_X[k]] = v;          // a 50-point game earns both the 40 and the 50 bonus (assumed)
    else if (SL_STAT[k] && SL_STAT[k] in w) w[SL_STAT[k]] += v;
    else if (k === "dreb") { w.REB += v; w.OREB -= v; }
    else if (k === "fgmi") { w.FGA += v; w.FGM -= v; }       // missed FG = attempts - makes
    else if (k === "ftmi") { w.FTA += v; w.FTM -= v; }
    else if (k === "dd") b.DD = v; else if (k === "td") b.TD = v; else if (k === "qd") b.QD = v;
    else unmod.push(`${SL_UNMOD[k] || k} (${v > 0 ? "+" : ""}${v})`);
  });
  d.w = w; d.b = b; d.unmod = unmod; d.x = x;
  const slots = {};
  (j.roster_positions || []).forEach((pos) => {
    const k = pos === "BN" ? "BE" : pos;
    if (ALL_SLOTS.includes(k)) slots[k] = (slots[k] || 0) + 1;
  });
  if (st.reserve_slots) slots.IR = st.reserve_slots;
  if (Object.keys(slots).length) d.slots = slots;
  if (st.playoff_week_start && st.playoff_teams) {
    const rounds = Math.ceil(Math.log2(st.playoff_teams));
    d.playoff_weeks = [st.playoff_week_start, st.playoff_week_start + rounds - 1]; d.po_len = 1;
  }
  return d;
}
function fantraxToLeague(j, id) {
  const d = clone(META.league);
  delete d.tl; delete d.my_team; d.keep = []; d.mp = null; d.adds_day = null; d.unmod = [];
  const teams = j.teamInfo ? Object.keys(j.teamInfo).length : Array.isArray(j.teams) ? j.teams.length : null;
  Object.assign(d, {key: "fantrax-" + id, id, platform: "fantrax", type: WEL.type,
    name: j.leagueName || j.name || (j.league && j.league.name) || "Fantrax " + id, teams: teams || d.teams});
  return d;
}
const scoreLine = (d) => STATS.filter((k) => d.w[k]).map((k) => `${STAT_LBL[k]} ${d.w[k]}`).join(" · ") +
  (d.b.DD || d.b.TD ? ` · double-double ${d.b.DD}, triple-double ${d.b.TD}` : "");
function welWorks(d) {
  const off = d.type !== "points";
  if (off) return `<p><strong>Heads up:</strong> this site scores <strong>points</strong> leagues. ${TYPES[d.type]} isn&rsquo;t supported yet, ` +
    "so the numbers won&rsquo;t match your league. Projections, the Schedule and Team defence are still useful.</p>";
  if (d.platform === "espn") return "<p><strong>Everything works:</strong> your scoring and roster slots, your teams and rosters, Recap, Waivers, My week and the Trade analyzer. Next, pick your team in &ldquo;You are&rdquo; at the top.</p>";
  if (d.platform === "sleeper") return `<p><strong>Works:</strong> your scoring and roster slots, your teams and rosters on every tab, and ` +
    (d.mode === "lockin" ? "<strong>Lock-In</strong> scoring: My week projects each starter&rsquo;s locked game, a <strong>Lock or pass?</strong> card tells you when to lock, and Waivers ranks free agents by their Lock-In value."
      : "rosters. Your league uses <strong>Game Pick</strong> (one game chosen in advance per starter); its weekly maths isn&rsquo;t built yet.") +
    ` Next, pick your team in &ldquo;You are&rdquo; at the top.</p>`;
  if (d.platform === "fantrax") return "<p><strong>Found it.</strong> Fantrax doesn&rsquo;t share a league&rsquo;s scoring publicly, so the default points scoring is in place: check it on the League tab. " +
    "Fantrax rosters on the in-season tabs are coming.</p>";
  return "";
}
function renderWelcome() {
  const P = WEL.plat ? PLATS[WEL.plat] : null;
  document.querySelectorAll("#wel-plat .chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.plat === WEL.plat)));
  document.querySelectorAll("#wel-type .chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === WEL.type)));
  const needsId = ["espn", "sleeper", "fantrax"].includes(WEL.plat);
  $("wel-idset").hidden = !needsId;
  if (needsId) { $("wel-hint").innerHTML = P.hint; $("wel-id").placeholder = P.ph; }
  $("wel-typeset").hidden = WEL.plat === "sleeper";       // Sleeper basketball is always points
  $("wel-check").hidden = !WEL.plat;
  $("wel-check").textContent = needsId ? "Check my league" : "Set up my rules by hand";
  $("wel-check").disabled = WEL.busy;
  $("wel-use").hidden = !(WEL.res && WEL.res.d);
  const r = WEL.res;
  $("wel-res").innerHTML = WEL.plat === "yahoo" && !r
    ? '<div class="msg info"><strong>Yahoo needs you to sign in with Yahoo</strong> (Yahoo doesn&rsquo;t let websites read leagues any other way). That sign-in is being set up. For now, choose <em>Set up my rules by hand</em> and enter your scoring on the League tab.</div>'
    : !r ? "" : r.err ? `<div class="msg err">${r.err}</div>`
    : `<div class="wel-ok"><div class="wel-ok-h">&#10003; Found <strong>${esc(r.d.name)}</strong></div>` +
      `<ul class="wel-facts"><li>${r.d.teams} teams · ${starters(r.d)} starters + ${r.d.slots.BE || 0} bench${r.d.slots.IR ? " + " + r.d.slots.IR + " IR" : ""}</li>` +
      (r.d.platform !== "fantrax" ? `<li>Scoring: ${esc(scoreLine(r.d))}</li>` : "") +
      (r.d.playoff_weeks ? `<li>Playoffs: weeks ${r.d.playoff_weeks[0]}&ndash;${r.d.playoff_weeks[1]}</li>` : "") +
      (r.d.unmod && r.d.unmod.length ? `<li class="dim">Not modelled: ${esc(r.d.unmod.join(", "))}</li>` : "") +
      (r.note ? `<li class="dim">${r.note}</li>` : "") + `</ul>${welWorks(r.d)}</div>`;
}
function welCheck() {
  if (WEL.plat === "yahoo" || WEL.plat === "other") {           // straight to the League tab, a blank custom league
    const d = clone(META.league);
    Object.assign(d, {key: "custom-" + Date.now(), id: "", name: WEL.plat === "yahoo" ? "My Yahoo league" : "My league",
      platform: WEL.plat === "yahoo" ? "yahoo" : "custom", type: WEL.type, unmod: [], keep: []});
    delete d.my_team; delete d.tl; d.mp = null;
    welDone();
    DRAFT = d; location.hash = "league"; renderLeagueForm();
    lgMsg("info", "Enter your league&rsquo;s scoring, roster slots and playoff weeks, then press <strong>Save league</strong>.");
    return;
  }
  const id = welId(WEL.plat, $("wel-id").value);
  if (!id) { WEL.res = {err: `That doesn&rsquo;t look like ${WEL.plat === "espn" ? "an" : "a"} ${PLATS[WEL.plat].name} league ID. ${PLATS[WEL.plat].hint}`}; renderWelcome(); return; }
  WEL.busy = true; WEL.res = null; renderWelcome();
  $("wel-res").innerHTML = `<p class="note">Reading ${PLATS[WEL.plat].name} league ${esc(id)}&hellip;</p>`;
  const sid = parseInt(META.season.slice(0, 4), 10);
  const job = WEL.plat === "espn"
    ? fetch(espnBase() + id + "?view=mSettings").then((r) => {
        if (r.status === 401 || r.status === 403) throw new Error("This ESPN league is private. In ESPN, open League &rarr; Settings and make it viewable to the public, then try again.");
        if (!r.ok) throw new Error(`ESPN didn&rsquo;t find league ${esc(id)} for the ${META.season} season (HTTP ${r.status}).`);
        return r.json();
      }).then((j) => { const d = espnToLeague(j, id, STORE.list["espn-" + id] ? clone(STORE.list["espn-" + id]) : clone(META.league)); if (d.type === "points") d.type = WEL.type; return {d}; })
    : WEL.plat === "sleeper"
    ? fetch("https://api.sleeper.app/v1/league/" + id).then((r) => r.json()).then((j) => {
        if (!j || !j.league_id) throw new Error(`Sleeper didn&rsquo;t find league ${esc(id)}. Check the number in your league&rsquo;s web address.`);
        if (j.sport && j.sport !== "nba") throw new Error(`That&rsquo;s a Sleeper ${esc(String(j.sport).toUpperCase())} league, not basketball.`);
        const d = sleeperToLeague(j, id);
        const note = String(j.season) !== String(sid) ? `This league is from the ${esc(j.season)} season; Sleeper gives each season a new league ID, so use this season&rsquo;s if you have it.`
          : j.status === "pre_draft" ? "This league hasn&rsquo;t drafted yet, so there are no rosters to read." : "";
        return {d, note};
      })
    : fetch("https://www.fantrax.com/fxea/general/getLeagueInfo?leagueId=" + encodeURIComponent(id)).then((r) => r.json()).then((j) => {
        if (!j || j.error) throw new Error(`Fantrax didn&rsquo;t find league ${esc(id)}${j && j.error && j.error.message ? " (" + esc(j.error.message) + ")" : ""}. Check the code in your league&rsquo;s web address.`);
        return {d: fantraxToLeague(j, id)};
      });
  job.then((res) => { WEL.res = res; })
    .catch((e) => { WEL.res = {err: e && e.message && !/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? e.message : `Couldn&rsquo;t reach ${PLATS[WEL.plat].name} just now. Check your connection and try again.`}; })
    .finally(() => { WEL.busy = false; renderWelcome(); });
}
function welDone() { lsSet(WEL_KEY, 1); if ($("welcome").open) $("welcome").close(); }
function welUse() {
  const d = WEL.res && WEL.res.d;
  if (!d) return;
  STORE.list[d.key] = d;
  writeStore();
  welDone();
  setActive(d.key);
}
function openWelcome() {
  WEL.res = null; WEL.busy = false;
  renderWelcome();
  const dlg = $("welcome");
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
}
function bindWelcome() {
  $("wel-plat").addEventListener("click", (e) => { const b = e.target.closest("[data-plat]"); if (!b) return; WEL.plat = b.dataset.plat; WEL.res = null; renderWelcome(); if (!$("wel-idset").hidden) $("wel-id").focus(); });
  $("wel-type").addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (!b) return; WEL.type = b.dataset.type; renderWelcome(); });
  $("wel-check").addEventListener("click", welCheck);
  $("wel-id").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); welCheck(); } });
  $("wel-use").addEventListener("click", welUse);
  $("wel-skip").addEventListener("click", welDone);
  $("wel-x").addEventListener("click", welDone);
  $("welcome").addEventListener("cancel", () => lsSet(WEL_KEY, 1));      // Esc
  $("addlg").addEventListener("click", openWelcome);
}
function bindLeague() {
  $("lgsel").addEventListener("change", (e) => setActive(e.target.value));
  $("tmsel").addEventListener("change", (e) => {
    const v = e.target.value === "" ? null : +e.target.value;
    setMyTeam(STORE.list[STORE.active], v);
    // views that defaulted to "someone" follow the new pick: your matchup, your trade side
    WK.pair = null; TR.a = null; TR.b = null; TR.give.clear(); TR.get.clear();
    fillTeamPicker();
    renderAll();
  });
  $("lg-pull").addEventListener("click", pullEspn);
  $("lg-espn").addEventListener("keydown", (e) => { if (e.key === "Enter") pullEspn(); });
  $("tab-league").addEventListener("input", (e) => {
    if (e.target.closest("#lg-slots") || e.target.id === "lg-teams") rosterNote();
    $("lg-state").textContent = "Unsaved changes";
  });
  $("lg-new").addEventListener("click", openWelcome);
  $("lg-list").addEventListener("click", (e) => {
    const u = e.target.closest("[data-lguse]"), ed = e.target.closest("[data-lgedit]");
    if (u) { setActive(u.dataset.lguse); lgMsg("ok", `Now using <strong>${esc(L.name)}</strong> everywhere on the site.`); }
    if (ed) {
      const k = ed.dataset.lgedit;
      DRAFT = clone(STORE.list[k] || DRAFT);
      renderLeagueForm(); lgMsg("", "");
      $("lg-form-h").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start"});
    }
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
    if (!STORE.list[DRAFT.key]) {                 // an unsaved new league: just drop the draft
      DRAFT = clone(L); renderLeagueForm(); lgMsg("ok", "New league discarded."); return;
    }
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
    const left = gamesLeftFor(p);
    const ros = fpg(p.s, p.bp), rosGp = (p.av || 0) * left;
    const pre = p.ps ? fpg(p.ps, p.pbp) : null;
    const sofar = p.td && p.gp ? fpg(p.td, p.tbp || [0, 0, 0]) : null;
    const adj = p.adj ? fpg(p.adj, p.abp) : null;
    const bi = boostInfo(p);
    return {p, ros, rosGp, rosTot: ros * rosGp + (bi ? bi.tot : 0), boost: bi, pre, preGp: p.pre_gp ?? null,
      preTot: pre != null && p.pre_gp ? pre * p.pre_gp : null,
      sofar, gp: p.gp || 0, sofarTot: sofar != null ? sofar * p.gp : null,
      adj, luck: sofar != null && adj != null ? sofar - adj : null};
  });
}
// Injury status: the OFFICIAL NBA report (data/injuries.json, refreshed hourly
// on game days) wins over ESPN's fantasy feed, which lags it. off(p) =
// [status, game date, consecutive Out reports]; one Out = that game only,
// 2+ in a row = out until a report clears him.
const OUT_SET = ["OUT", "INJURY_RESERVE", "SUSPENSION"];
let OFF = {players: {}, as_of: null};
const off = (p) => (p && OFF.players[p.id]) || null;
// Out on 2+ consecutive reports, or Out once while ESPN's expected return
// date is after that game -> a multi-game absence. A single Out with no
// later return date is that game only (rest, illness): Gobert 10-31.
const longOut = (p) => {
  const o = off(p);
  return !!o && o[0] === "Out" && (o[2] >= 2 || (!!RET[p.id] && !!o[1] && RET[p.id] > o[1] && RET[p.id] > nowDay()));
};
// The official report covers his team's next game and doesn't list him ->
// available, even if ESPN's fantasy feed still says OUT (Gobert, 11-02).
// injury_report.py withholds this when an unmatched report row on his team
// shares his surname (it may be him under another spelling).
const offCleared = (p) => {
  if (!p || off(p)) return false;
  const d = OFF.avail ? OFF.avail[p.id] : null;
  return !!d && d >= todayET();
};
// When the official report lists him, it decides; ESPN only fills the gaps.
const espnOut = (p, inj) => !off(p) && OUT_SET.includes(inj === undefined ? p.inj : inj) && !offCleared(p);
const outNow = (p) => espnOut(p) || longOut(p);
// Healthy but out of the rotation: no minutes in any of his team's last 5
// games (3+ played) and not just back from the injury report. His games
// don't count on Waivers / My week, and he can't inherit an absentee's minutes.
const teamPlayed = (tm) => { const l = META.last_game_day || ""; return (META.sched[tm] || []).filter((g) => g[0] <= l).length; };
// "Healthy" means BOTH sources agree: not on the official report at all and
// ESPN ACTIVE — a returning player (Claxton: out all season, Doubtful
// tonight) hasn't played either, but that is injury, not the coach's choice.
const benched = (p) => !!p && !isAbsent(p) && !off(p) && (!p.inj || p.inj === "ACTIVE") && !p.fresh &&
  teamPlayed(p.tm) >= 3 && !(OFF.cleared && OFF.cleared[p.id]);
// Game-day status -> chance he plays THAT game, measured on the official
// 5 PM reports 2023-26 (src/backtest/status_play.py): Doubtful 1%,
// Questionable 50% (41% coming back from a layoff), Probable 93% (83%).
const returning = (p) => !!p && !p.fresh && teamPlayed(p.tm) >= 3;
function statusPlay(p, d) {
  const o = off(p), S = META.status_play;
  if (!o || !S || o[1] !== d || !S.play[o[0]]) return 1;
  return S.play[o[0]][returning(p) ? 1 : 0];
}
const statusPlayTip = (p, d) => {
  const o = off(p), sp = statusPlay(p, d);
  return sp < 1 ? `${o[0]} on the official report: players listed ${o[0].toLowerCase()} play ${Math.round(sp * 100)}% of the time` +
    `${returning(p) ? " (coming back from a layoff)" : ""}, so this game counts ${Math.round(sp * 100)}%` : "";
};
// First two games back from 5+ missed games: 83% / 92% of his usual minutes
// (1,527 returns 2019-26). Returns date -> minutes factor for his upcoming games.
function rampFor(p) {
  const S = META.status_play;
  if (!S || !returning(p)) return () => 1;
  const last = META.last_game_day || "", back = isAbsent(p) ? absWindow(p).ret : "";
  const up = (META.sched[p.tm] || []).map((g) => g[0])
    .filter((d) => d > last && d >= back && !outOn(p, d) && statusPlay(p, d) >= 0.5);
  return (d) => { const i = up.indexOf(d); return i >= 0 && i < S.ramp.length ? S.ramp[i] : 1; };
}
const benchTip = (p) => `Not in the rotation: no minutes in any of ${p.tm}'s last ${Math.min(5, teamPlayed(p.tm))} games while healthy` +
  `${p.gp ? ` (${p.gp} games played this season)` : " (hasn't played this season)"}.\nHis games don't count here until he plays.`;
const outOn = (p, d) => { const o = off(p); return !!o && o[0] === "Out" && o[1] === d; };
function offTitle(o, p) {
  const day = o[1] ? new Date(o[1] + "T12:00:00").toLocaleDateString(undefined, {weekday: "short", month: "short", day: "numeric"}) : "his next game";
  const what = {Out: "Out", Doubtful: "Doubtful: probably won't play", Questionable: "Questionable: game-time decision", Probable: "Probable: expected to play"}[o[0]];
  const L2 = [`Official NBA injury report · ${(OFF.as_of || "").slice(11)}`, `${what} for ${day}`];
  if (o[0] === "Out" && (o[2] >= 2 || (p && longOut(p)))) {
    L2.push(o[2] >= 2 ? `Listed out on his team's last ${o[2]} reports, so he counts as out until a report clears him`
      : "Listed out once so far, but ESPN expects him back only after this game");
    if (p) { const w = absWindow(p); L2.push(`Back about ${new Date(w.ret + "T12:00:00").toLocaleDateString(undefined, {month: "short", day: "numeric"})} (${w.src})`); }
  } else if (o[0] === "Out") L2.push("One game only (e.g. rest): his other games still count");
  return L2.join("\n");
}
function espnTip(p) {
  const st = {OUT: "Out", INJURY_RESERVE: "Injured reserve", SUSPENSION: "Suspended", DAY_TO_DAY: "Day-to-day"}[p.inj] || p.inj;
  const L2 = [`ESPN status: ${st}`];
  if (p.inj !== "DAY_TO_DAY" && isAbsent(p)) { const w = absWindow(p); L2.push(`Back about ${new Date(w.ret + "T12:00:00").toLocaleDateString(undefined, {month: "short", day: "numeric"})} (${w.src})`); }
  else if (p.inj === "DAY_TO_DAY") L2.push("Not on the official report yet, or not listed for today's game");
  return L2.join("\n");
}
// ========================================================= INJURY BOOSTS
// When a rotation player is out, his minutes go to healthy teammates. Model
// tested in src/backtest/injury_opportunity.py (7,669 past absences, every
// parameter identical in all 10 leave-one-season-out folds):
//   key absentee = out + played in his team's last 5 + 24+ minutes
//   w_i   = (1 + b * same position group) * max(1, 38 - his minutes)^d
//   +min_i = s * absentee's minutes * w_i / sum(w)     (s = .6, b = 1, d = .5)
//   a lone backup centre (starting C out, one other C) gets at least +4.8
// Each teammate keeps his own per-minute rate. The boost lasts until the
// absentee's return: the visitor's weeks-out > ESPN's expected return date >
// the historical mean absence for that body part (minus games already missed).
// The same window removes the absentee's own games.
const BK = {out: "fnba.v2.manualout", wk: "fnba.v2.outwk"};
let BC = null;                              // computed boosts, rebuilt on any change
const RET = {}, RTYPE = {};                 // ESPN expected return date / body part
function lsGet(k, d) { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
const manualOut = () => lsGet(BK.out, []);
const outWeeks = () => lsGet(BK.wk, {});
const isAbsent = (p) => !!p && (outNow(p) || manualOut().includes(p.id));
function boostDirty() { BC = null; }
const nowDay = () => { const t = todayET(), l = META.last_game_day ? addDays(META.last_game_day, 1) : t; return t > l ? t : l; };
function absWindow(p) {
  const today = nowDay(), wk = outWeeks()[p.id];
  if (wk != null && wk !== "" && !isNaN(+wk)) return {ret: addDays(today, Math.round(+wk * 7)), src: `your ${+wk} wk`};
  if (RET[p.id] && RET[p.id] > today) return {ret: RET[p.id], src: "ESPN return date"};
  const fb = META.inj_fallback || {}, ty = RTYPE[p.id];
  const key = ty ? String(ty).toLowerCase().replace(/[^a-z]/g, "") : null;
  // rest / personal days aren't injuries (and are left out of the fallback
  // table): with no ESPN date, expect him back for his team's next game
  const fut0 = (META.sched[p.tm] || []).map((g) => g[0]).filter((d) => d >= today);
  if (key === "rest" || key === "personal" || key === "notinjuryrelated")
    return {ret: fut0[0] || today, src: `${String(ty).toLowerCase()}: back next game`};
  const mean = key && fb[key] != null ? fb[key] : (fb._all || 6);
  const left = Math.max(1, Math.round(mean - (p.missed || 0)));
  const fut = (META.sched[p.tm] || []).map((g) => g[0]).filter((d) => d >= today);
  return {ret: fut[left] || addDays(today, 60), src: `typical ${ty ? String(ty).toLowerCase() + " " : ""}absence (~${Math.round(mean)} games)`};
}
let RET_P = null;
function loadReturns2() {
  // also one-game official Outs: ESPN's return date decides if it is longer
  const ids = PLAYERS.filter((p) => isAbsent(p) || (off(p) && off(p)[0] === "Out")).map((p) => p.id).filter((id) => !(id in RET));
  if (!ids.length) return Promise.resolve();
  ids.forEach((id) => { RET[id] = null; });
  const flt = JSON.stringify({players: {filterIds: {value: ids}, limit: ids.length + 5,
                                        sortPercOwned: {sortPriority: 1, sortAsc: false}}});
  // league-scoped endpoint (any public league can read any player's card)
  return fetch(espnBase() + META.league.id + "?view=kona_playercard", {headers: {"x-fantasy-filter": flt}})
    .then((r) => (r.ok ? r.json() : {players: []})).catch(() => ({players: []}))
    .then((k) => {
      (k.players || []).forEach((w) => {
        const pl = w.player || {}, det = pl.injuryDetails || {}, d = det.expectedReturnDate;
        if (pl.id == null) return;
        if (det.type) RTYPE[pl.id] = det.type;
        if (d && d.length === 3) RET[pl.id] = `${d[0]}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}`;
      });
      boostDirty();
    });
}
const posGroups = (pos) => {
  const s = {};
  String(pos || "").split(/[,/]/).forEach((t) => {
    t = t.trim().toUpperCase();
    if (t === "PG" || t === "SG" || t === "G") s.G = 1;
    else if (t === "SF" || t === "PF" || t === "F") s.F = 1;
    else if (t === "C") s.C = 1;
  });
  return s;
};
function computeBoosts() {
  if (BC) return BC;
  const P = META.opp, by = {}, abs = {}, skip = {};
  if (!P) return (BC = {by, abs, skip});
  const byTeam = {};
  PLAYERS.forEach((p) => { (byTeam[p.tm] = byTeam[p.tm] || []).push(p); });
  // rotation players listed out somewhere who hand out NO boost, and why
  PLAYERS.forEach((p) => {
    const o = off(p), espn = OUT_SET.includes(p.inj), mK = Math.max(p.rec || 0, p.mpg || 0);
    if (!(isAbsent(p) || espn || (o && o[0] === "Out")) || mK < 15) return;
    let why = null;
    if (!isAbsent(p)) why = o && o[0] === "Out" ? "one" : offCleared(p) ? "cleared" : "status";
    else if (!p.fresh) why = "stale";
    else if (mK < P.key_min) why = "minutes";
    if (why) skip[p.id] = {p, why, mK};
  });
  Object.entries(byTeam).forEach(([tm, roster]) => {
    const keys = roster.filter((p) => isAbsent(p) && p.fresh && Math.max(p.rec || 0, p.mpg || 0) >= P.key_min);
    if (!keys.length) return;
    const mates = roster.filter((p) => !isAbsent(p) && !benched(p) && ((p.gp || 0) >= 1 || (p.mpg || 0) >= 15) && p.mpg > 0);
    const last = META.last_game_day || "";
    keys.forEach((k) => {
      // no remaining team game before his return -> nothing to hand out
      const win = absWindow(k);
      if (!(META.sched[k.tm] || []).some((g) => g[0] > last && g[0] < win.ret)) {
        skip[k.id] = {p: k, why: "back", mK: Math.max(k.rec || 0, k.mpg || 0), ret: win.ret};
        return;
      }
      const kg = posGroups(k.pos), center = !!kg.C && !kg.G;
      const b = center ? P.b_center : P.b_gf, mK = Math.max(k.rec || 0, k.mpg || 0);
      const ws = mates.map((p) => {
        const g = posGroups(p.pos), same = Object.keys(kg).some((x) => g[x]) ? 1 : 0;
        return (1 + b * same) * Math.pow(Math.max(1, 38 - (p.mpg || 0)), P.d);
      });
      const tot = ws.reduce((a, x) => a + x, 0);
      if (tot <= 0) return;
      const cm = mates.filter((p) => posGroups(p.pos).C);
      const lone = center && cm.length === 1 ? cm[0].id : null;
      // usage bump: teammates' per-minute FP rises with the absentee's usage
      const U = META.usage, ks = k.s || [];
      const uK = k.mpg > 0 ? ((ks[SI.FGA] || 0) + 0.44 * (ks[SI.FTA] || 0) + (ks[SI.TOV] || 0)) / k.mpg : 0;
      abs[k.id] = {p: k, min: mK, uK, win, mates: []};
      mates.forEach((p, i) => {
        let d = P.s * mK * ws[i] / tot;
        if (p.id === lone) d = Math.max(d, P.lone_c);
        const g = posGroups(p.pos), same = Object.keys(kg).some((x) => g[x]) ? 1 : 0;
        const rb = U ? Math.max(0, U.c0 + U.c_use * (uK / U.uk_ref - 1) + U.c_same * same) : 0;
        const o = by[p.id] = by[p.id] || {parts: [], lone: false, sc: null};
        if (o.sc == null) { const fd = fpgUnder(META.league, p.s, p.bp); o.sc = fd > 0 ? fpg(p.s, p.bp) / fd : 1; }
        o.parts.push({k: k.id, d, rb});
        if (p.id === lone) o.lone = true;
        abs[k.id].mates.push({p, d, rb, fp: d * perMin(p) + rb * o.sc * ((p.mpg || 0) + d)});
      });
      abs[k.id].mates.sort((a, b2) => b2.fp - a.fp);
    });
  });
  return (BC = {by, abs, skip});
}
// extra minutes / fantasy points for player p on date d
function boostMin(p, d) {
  const B = computeBoosts(), o = B.by[p.id];
  if (!o) return 0;
  return o.parts.reduce((a, pt) => a + (d < B.abs[pt.k].win.ret ? pt.d : 0), 0);
}
const perMin = (p) => (p.mpg > 0 ? fpg(p.s, p.bp) / p.mpg : 0);
function boostFP(p, d) {
  const B = computeBoosts(), o = B.by[p.id];
  if (!o) return 0;
  let dm = 0, rb = 0;
  o.parts.forEach((pt) => { if (d < B.abs[pt.k].win.ret) { dm += pt.d; rb += pt.rb; } });
  return dm * perMin(p) + rb * o.sc * ((p.mpg || 0) + dm);
}
// remaining team games he is expected to play (an absentee's start at his return)
function gamesLeftFor(p) {
  const last = META.last_game_day || "";
  const from = isAbsent(p) ? absWindow(p).ret : "";
  return (META.sched[p.tm] || []).filter((g) => g[0] > last && g[0] >= from).length;
}
// season-long boost: sum over his remaining games while any absentee is out
function boostInfo(p) {
  const B = computeBoosts(), o = B.by[p.id];
  if (!o) return null;
  const last = META.last_game_day || "";
  let tot = 0, n = 0, thru = "";
  (META.sched[p.tm] || []).forEach((g) => {
    if (g[0] <= last) return;
    const f = boostFP(p, g[0]);
    if (f > 0) { tot += f; n++; }
  });
  o.parts.forEach((pt) => { const r = B.abs[pt.k].win.ret; if (r > thru) thru = r; });
  const names = o.parts.map((pt) => B.abs[pt.k].p.n);
  const now = o.parts.reduce((a, pt) => a + pt.d, 0), rb = o.parts.reduce((a, pt) => a + pt.rb, 0);
  const use = rb * o.sc * ((p.mpg || 0) + now);
  const parts = o.parts.map((pt) => {
    const a = B.abs[pt.k];
    return {name: a.p.n, uK: a.uK, min: pt.d, ret: a.win.ret, src: a.win.src,
            fpMin: pt.d * perMin(p), fpUse: pt.rb * o.sc * ((p.mpg || 0) + now)};
  });
  return {tot: tot * (p.av || 0), games: n, min: now, use, fpg: now * perMin(p) + use, thru, names, lone: o.lone,
          parts, perMin: perMin(p)};
}
const niceDay = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short", month: "short", day: "numeric"}) : "");
function boostTip(b) {
  const L2 = [`Injury boost: +${b.fpg.toFixed(1)} FP per game`];
  b.parts.forEach((x) => {
    L2.push(`${x.name} is out (usage ${x.uK.toFixed(2)} per min) — back about ${niceDay(x.ret)} (${x.src})`);
    L2.push(`   +${x.min.toFixed(1)} min × his ${b.perMin.toFixed(2)} FP per min = +${x.fpMin.toFixed(1)}`);
    if (x.fpUse > 0.05) L2.push(`   usage bump while ${surname(x.name)} sits = +${x.fpUse.toFixed(1)}`);
  });
  if (b.lone) L2.push("Lone backup centre: at least +4.8 minutes");
  L2.push(`${b.games} games affected ≈ +${b.tot.toFixed(0)} rest-of-season points`);
  return L2.join("\n");
}

const b2b0 = (p) => (!p.b2b ? "0 of 0" : p.b2b.length > 3
  ? `${p.b2b[3]} of ${p.b2b[4]} this season, ${p.b2b[0] - p.b2b[3]} of ${p.b2b[1] - p.b2b[4]} last season` : `${p.b2b[0]} of ${p.b2b[1]}`);
const BUI = {open: {"wv-boosts": true, "is-boosts": true}};
function renderBoostPanel(cid) {
  const el = $(cid);
  if (!el) return;
  const B = computeBoosts();
  const ab = Object.values(B.abs).sort((a, b) => b.min - a.min);
  const wks = outWeeks(), mo = manualOut();
  const rows = ab.map((a) => {
    const p = a.p;
    const top = a.mates.slice(0, 4).map((m) => `<span class="name" data-id="${m.p.id}">${esc(m.p.n)}</span> <span class="pos-up" title="+${m.d.toFixed(1)} min, +${(m.fp - m.d * perMin(m.p)).toFixed(1)} FP/G from usage (under your scoring)">+${m.fp.toFixed(1)}</span>`).join(", ");
    return `<tr><td class="l"><span class="name" data-id="${p.id}">${esc(p.n)}</span>${tags(p)}${mo.includes(p.id) && !outNow(p) ? ' <span class="dim">(marked by you)</span>' : ""}</td>` +
      `<td class="l dim">${esc(p.tm)}</td><td>${a.min.toFixed(0)}</td><td class="${a.uK > 0.6 ? "pos-up" : "dim"}">${a.uK.toFixed(2)}</td>` +
      `<td class="l">${a.win.ret.slice(5)} <span class="dim" style="font-size:.76rem">${esc(a.win.src)}</span></td>` +
      `<td><input type="number" min="0" max="30" step="1" data-wk="${p.id}" value="${wks[p.id] ?? ""}" placeholder="wks" style="width:4.2rem" aria-label="Weeks ${esc(p.n)} is out"></td>` +
      `<td class="l" style="white-space:normal;min-width:14rem">${top || '<span class="dim">no healthy teammates with a role</span>'}</td></tr>`;
  }).join("");
  const manualOnly = mo.filter((id) => BYID[id] && !B.abs[id]);
  // listed-out rotation players (24+ min) who hand out no minutes, grouped by reason
  const WHY = {
    stale: "Out 5+ straight games: the model only moves minutes for a fresh absence (he played in one of his team&rsquo;s last 5). After that his teammates&rsquo; own minutes since he went out are taken as their role",
    back: "Expected back before his team&rsquo;s next game",
    one: "Listed Out for one game only (rest or a short knock): his other games count as normal",
    cleared: "Not on the official report for his team&rsquo;s next game, so treated as available (ESPN may still say out)",
    status: "Not counted as out (official report: questionable / probable, or ESPN only day-to-day)"};
  const sk = Object.values(B.skip || {}).filter((x) => x.mK >= (META.opp || {}).key_min);
  const grp = {};
  sk.forEach((x) => { (grp[x.why] = grp[x.why] || []).push(x); });
  const left = Object.keys(WHY).filter((k) => grp[k]).map((k) => `<li><b>${WHY[k]}:</b> ` +
    grp[k].sort((a, b) => b.mK - a.mK).map((x) => `<span class="name" data-id="${x.p.id}">${esc(x.p.n)}</span> <span class="dim">${esc(x.p.tm)}${x.p.missed ? ", missed " + x.p.missed : ""}${x.ret ? ", back " + x.ret.slice(5) : ""}</span>`).join(" · ") + "</li>").join("");
  el.innerHTML = `<details class="card"${BUI.open[cid] ? " open" : ""} data-bp="${cid}" style="margin:1rem 0">` +
    `<summary><strong>Injury boosts</strong> <span class="dim">&mdash; ${ab.length} rotation player${ab.length === 1 ? "" : "s"} out, their minutes go to teammates</span></summary>` +
    `<p class="note">When a player who has been playing 24+ minutes is out, about 60% of his minutes go to healthy teammates, more to the same position and to players with more room to grow (tested on 7,669 past absences: the top beneficiary gained +3.3 minutes against +3.7 predicted; a lone backup centre gains at least +4.8). ` +
    `If he was a high-usage player, teammates&rsquo; per-minute production also rises, more at his position (top-usage absentees: +0.46 FP per 30 minutes, same position +0.62, 9 of 10 seasons; small, added on your call). ` +
    `Each teammate keeps his own per-minute production, and the boost runs until the return date. That date is your weeks-out if you type one, else ESPN&rsquo;s expected return, else the typical absence for that injury. ` +
    `The injured player&rsquo;s own games before that date are taken off his rest-of-season value. Boosts feed every projection on the site.</p>` +
    (rows ? '<div class="tablewrap" style="max-height:26rem"><table><thead><tr><th class="l">Out</th><th class="l">Tm</th><th title="Minutes he had been playing">Min</th><th title="His usage per minute (shots + 0.44 free-throw trips + turnovers) against a typical key player&rsquo;s 0.53">Usage</th>' +
      '<th class="l">Back about</th><th title="Override: weeks he will be out">Weeks out</th><th class="l">Biggest gains (+FP per game: minutes + usage)</th></tr></thead><tbody>' + rows + "</tbody></table></div>"
      : '<p class="note">No rotation players are out right now.</p>') +
    (left ? `<details class="bp-left"><summary class="dim">Left out: ${sk.length} rotation player${sk.length === 1 ? "" : "s"} listed out who hand out no minutes, and why</summary><ul>${left}</ul></details>` : "") +
    `<div class="controls" style="margin-top:.7rem"><div class="ctl"><label for="${cid}-add">Mark a player out (news ESPN hasn&rsquo;t caught up with)</label>` +
    `<input id="${cid}-add" list="${cid}-dl" type="search" placeholder="player name" autocomplete="off" style="min-width:14rem"></div>` +
    `<button class="btn" data-addout="${cid}">Mark out</button>` +
    (manualOnly.length ? `<span class="note">Also marked out: ${manualOnly.map((id) => `${esc(BYID[id].n)} <button class="x" style="width:1.4rem;height:1.4rem;font-size:.8rem" data-unout="${id}" aria-label="Unmark">×</button>`).join(" ")}</span>` : "") +
    (mo.length ? ` <button class="btn" data-clearout="1">Clear my marks (${mo.length})</button>` : "") +
    `</div><datalist id="${cid}-dl">${PLAYERS.filter((p) => (p.mpg || 0) >= 15).map((p) => `<option value="${esc(p.n)}">${esc(p.tm)}</option>`).join("")}</datalist></details>`;
}
function bindBoostPanel(cid) {
  const el = $(cid);
  el.addEventListener("toggle", (e) => { if (e.target.dataset.bp) BUI.open[cid] = e.target.open; }, true);
  el.addEventListener("change", (e) => {
    const i = e.target.closest("input[data-wk]");
    if (!i) return;
    const m = outWeeks();
    if (i.value === "") delete m[i.dataset.wk]; else m[i.dataset.wk] = +i.value;
    lsSet(BK.wk, m); boostDirty(); renderAll();
  });
  el.addEventListener("click", (e) => {
    const add = e.target.closest("[data-addout]"), un = e.target.closest("[data-unout]"), clr = e.target.closest("[data-clearout]");
    if (add) {
      const v = normName($(cid + "-add").value);
      const p = PLAYERS.find((x) => normName(x.n) === v);
      if (!p) return;
      const mo = manualOut();
      if (!mo.includes(p.id)) lsSet(BK.out, mo.concat([p.id]));
      boostDirty(); loadReturns2().then(renderAll); renderAll();
    } else if (un) {
      const id = +un.dataset.unout;
      lsSet(BK.out, manualOut().filter((x) => x !== id));
      const m = outWeeks(); delete m[id]; lsSet(BK.wk, m);
      boostDirty(); renderAll();
    } else if (clr) {
      lsSet(BK.out, []); boostDirty(); renderAll();
    } else {
      const n = e.target.closest(".name[data-id]");
      if (n && BYID[+n.dataset.id]) { e.stopPropagation(); openPlayer(+n.dataset.id); }
    }
  });
}

function tags(p) {
  let t = "";
  const o = off(p);
  if (o) {
    const lbl = {Out: "OUT", Doubtful: "DOUBT", Questionable: "Q", Probable: "PROB"}[o[0]];
    const cls = {Out: "inj", Doubtful: "doubt", Questionable: "dtd", Probable: "prob"}[o[0]];
    t += `<span class="tag ${cls}" title="${esc(offTitle(o, p))}">${lbl}</span>`;
  } else if (espnOut(p))
    t += `<span class="tag inj" title="${esc(espnTip(p))}">${p.inj === "INJURY_RESERVE" ? "IR" : p.inj === "SUSPENSION" ? "SUSP" : "OUT"}</span>`;
  else if (p.inj === "DAY_TO_DAY" && !offCleared(p)) t += `<span class="tag dtd" title="${esc(espnTip(p))}">DTD</span>`;
  if (benched(p)) t += `<span class="tag dnp" title="${esc(benchTip(p))}">DNP</span>`;
  if (p.rook) t += '<span class="tag rk">RK</span>';
  return t;
}
function pct(m, a) { return m != null && a ? (100 * m / a).toFixed(1) : "-"; }

// ---- ours vs Sleeper (Rotowire): both saved before tip-off, graded on games played
function renderScorecard() {
  const box = $("score-box");
  if (!box) return;
  const S = META.scorecard || {n: 0};
  const head = `<summary><strong>Projection scorecard</strong> &mdash; ours vs Sleeper&rsquo;s (Rotowire), game by game <span class="dim">` +
    (S.n ? `${S.n} games graded` : "grading starts with the next games") + "</span></summary>";
  if (!S.n) {
    box.innerHTML = head + `<p class="note">Each morning, before tip-off, the site saves Sleeper&rsquo;s projection for every upcoming game alongside ours. ` +
      `Once the games are played, both are graded against the box score, stat by stat. Sleeper&rsquo;s earlier projections can&rsquo;t be graded fairly: ` +
      `they were edited after the games were played (checked Nov 7, every game of weeks 1&ndash;3), so the scorecard counts only projections saved in advance. ` +
      `Sleeper&rsquo;s numbers are a benchmark here; none of our projections use them.</p>`;
    return;
  }
  const row = (k, o, t) => `<tr><td class="l">${STAT_LBL[k] || k}</td><td>${o.toFixed(2)}</td><td>${t.toFixed(2)}</td>` +
    `<td class="l ${o < t ? "pos-up" : o > t ? "pos-dn" : "dim"}">${o < t ? "ours" : o > t ? "Sleeper" : "tie"}</td></tr>`;
  const fpRow = (lbl, v) => `<tr><td class="l">${lbl}</td><td>${v[0].toFixed(2)}</td><td>${v[1].toFixed(2)}</td>` +
    `<td class="l ${v[0] < v[1] ? "pos-up" : "pos-dn"}">${v[0] < v[1] ? "ours" : "Sleeper"} <span class="dim">(ours closer in ${Math.round(v[2] * 100)}% of games)</span></td></tr>`;
  const wins = S.stats.filter(([, o, t]) => o < t).length;
  box.innerHTML = head + `<p class="note">Average miss per game (lower is better) on <strong>${S.n}</strong> player-games played from ${S.from} to ${S.to}. ` +
    `Both projections were saved the morning before each game. Ours is closer on <strong>${wins} of ${S.stats.length}</strong> stats.</p>` +
    `<div class="tablewrap" style="max-height:none"><table><thead><tr><th class="l">Stat</th><th>Ours</th><th>Sleeper</th><th class="l">Closer</th></tr></thead><tbody>` +
    fpRow("Fantasy points, this site&rsquo;s default scoring", S.fp.league) + fpRow("Fantasy points, Sleeper&rsquo;s default scoring", S.fp.sleeper) +
    S.stats.map(([k, o, t]) => row(k, o, t)).join("") + "</tbody></table></div>" +
    `<p class="note">Games where a player didn&rsquo;t play are left out: both projections assume he plays. Sleeper&rsquo;s numbers are a benchmark; none of our projections use them.</p>`;
}
function renderProj() {
  renderScorecard();
  const XS = (META.extras || []).filter((k) => L.x && L.x[k]);
  const XI = Object.fromEntries((META.extras || []).map((k, i) => [k, i]));
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
    // only the extra rules this league scores (they are already inside FP/G and the total)
    XS.map((k, i) => `<th class="${i ? "" : "grp"}" title="${esc((X_MILE.has(k) ? "Chance of a " + X_LBL[k].toLowerCase() + " in a game he plays" : X_LBL[k] + " per game") + ` (your league: ${sg(L.x[k], 1)} each). Already counted in FP/G and the total.`)}">${X_COL[k]}</th>`).join("") +
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
      XS.map((k, i) => { const v = s && s.x ? s.x[XI[k]] : null;
        return `<td class="${i ? "" : "grp"}">${v == null ? "-" : X_MILE.has(k) ? (v * 100).toFixed(v >= 0.1 ? 0 : 1) + "%" : v.toFixed(2)}</td>`; }).join("") +
      `<td class="grp">${fx(r.sofar)}</td><td>${fx(r.adj)}</td>` +
      `<td class="${r.luck == null ? "" : r.luck >= 1 ? "pos-dn" : r.luck <= -1 ? "pos-up" : ""}">${sg(r.luck)}</td>` +
      `<td class="grp dim">${p.pre_rank ?? "-"}</td><td class="dim">${p.espn != null ? Math.round(p.espn) : "-"}</td>` +
      `<td class="dim">${p.own != null ? p.own.toFixed(0) : "-"}</td></tr>`);
    if (plain && r.rank === cut)
      rows.push(`<tr class="cutlbl"><td colspan="${23 + XS.length}">Waiver line — ${L.teams} teams × ${rostered(L)} roster spots = ${cut} rostered players</td></tr>`);
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
  if (!GAMES_P) GAMES_P = fetch("data/games.json" + DATA_V, NC).then((r) => r.json()).then((j) => {
    const C = {};
    j.cols.forEach((c, i) => { C[c] = i; });
    const byP = {}, byG = {};
    j.rows.forEach((r) => {
      (byP[r[C.id]] = byP[r[C.id]] || []).push(r);
      (byG[r[C.g]] = byG[r[C.g]] || {})[r[C.id]] = r;
    });
    j.rows.forEach((r) => { if (r[C.adj]) withX(r[C.adj], (BYID[r[C.id]] || {}).xr); });
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
    `<div class="dhead">${headshot(p.id, "dh-hs")}<div><h1>${esc(p.n)}${tags(p)}</h1>` +
    `<div class="dsub">${teamLogo(p.tm)}${esc(TEAM_NAMES[p.tm] || p.tm)} · ${esc(p.pos || "")}${p.age ? " · age " + Math.floor(p.age) : ""}` +
    `${p.own != null ? " · " + p.own.toFixed(0) + "% rostered" : ""}${off(p) ? " · " + esc(offTitle(off(p), p).split("\n").slice(1, 2).join("")) : offCleared(p) && p.inj && p.inj !== "ACTIVE" ? " · official report: available (ESPN still says " + esc(p.inj) + ")" : p.inj && p.inj !== "ACTIVE" ? " · ESPN: " + esc(p.inj) : ""}${benched(p) ? " · not in the rotation" : ""}</div></div>` +
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
      const box = withX(STATS.map((k) => r[C[k]]), rowX(r));
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
  if (!RECAP_P) RECAP_P = fetch("data/recap.json" + DATA_V, NC).then((r) => (r.ok ? r.json() : null))
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
      row.box = withX(STATS.map((k) => r[C[k]]), rowX(r)); row.min = r[C.min]; row.fg3a = r[C.FG3A];
      row.fp = fpg(row.box, [r[C.dd], r[C.td], r[C.qd]]);
      row.adj = r[C.adj] ? fpg(r[C.adj], r[C.abp]) : null;
      row.sh = r[C.sh];
    } else if (f && dnp == null) {
      row.min = f[0]; row.box = f.slice(1, 1 + STATS.length); row.fg3a = f[1 + STATS.length]; withX(row.box, boxX(row.box));
      row.fp = fpg(row.box, multi(row.box));
      if (RECAP.lv && RECAP.lv[gid]) row.adj = adjLine(BYID[id], row.min, row.box);
    }
    if (row.fp != null && row.adj != null) row.lk = row.fp - row.adj;
    (out[tm] = out[tm] || []).push(row);
  });
  return out;
}
const lkCls = (v, t = 3) => (v == null ? "" : v >= t ? "pos-dn" : v <= -t ? "pos-up" : "");
// luck-adjusted FP for one box line, the build's adj_line: his frozen per-minute
// rates at the minutes he played, his real shot attempts (at his own make rates)
// and his real assists. p.lp = [mpg, c, c3, per-minute rates in STATS order, dd, td, qd].
function adjLine(p, M, box) {
  const q = p && p.lp;
  if (!q || !(q[0] > 0) || M == null) return null;
  const [mpg, c, c3] = q, bp = q.slice(3 + STATS.length);
  const s = q.slice(3, 3 + STATS.length).map((x) => x * M);
  const dA = box[SI.FGA] - s[SI.FGA];
  s[SI.FGA] = box[SI.FGA]; s[SI.FGM] += c * dA; s[SI.FG3M] += c3 * dA; s[SI.PTS] += (2 * c + c3) * dA;
  s[SI.AST] = box[SI.AST];
  return fpg(withX(s, p.xr), bp.map((b) => b * M / mpg));
}

// ---- LIVE NIGHTS: a game shows up here as soon as ESPN calls it final, not at
// the next site build (GitHub runs scheduled builds hours late). Same ESPN site
// API as src/ingest/espn_box.py (CORS open); results go into RECAP in the
// recap.json shapes, box lines as fallback lines (RECAP.lv marks them live, so
// they get the luck split from p.lp). A day is re-checked at most every 5 min.
const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/";
const ETRI = {GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS"};
let LIVE_AT = {};
async function espnSite(path, q) {
  // ESPN's CDN can cache an empty body for one exact URL -> vary the query string
  for (const extra of ["", "&lang=en&region=us", "&region=us"]) {
    try {
      const r = await fetch(ESPN_SITE + path + "?" + q + extra, {cache: "no-store"});
      if (!r.ok) continue;
      const j = await r.json();
      if (j && Object.keys(j).length) return j;
    } catch (e) { /* try the next variant */ }
  }
  return null;
}
function liveDays() {
  const today = todayET(), lo = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const sched = {}, have = {};
  Object.entries(META.sched).forEach(([t, gs]) => gs.forEach((g) => {
    if (g[0] <= today && g[0] >= lo) (sched[g[0]] = sched[g[0]] || new Set()).add([t, g[1]].sort().join("-"));
  }));
  RECAP.games.forEach((g) => { have[g[1]] = (have[g[1]] || 0) + 1; });
  return Object.keys(sched).filter((d) => sched[d].size > (have[d] || 0) && !(Date.now() - (LIVE_AT[d] || 0) < 3e5));
}
async function liveDay(d) {
  LIVE_AT[d] = Date.now();
  const sb = await espnSite("scoreboard", "dates=" + d.replace(/-/g, ""));
  if (!sb) return 0;
  const known = new Set(RECAP.games.map((g) => g[0]));
  let added = 0;
  for (const e of sb.events || []) {
    const gid = +e.id, st = e.status.type, c = e.competitions[0];
    if (!st.completed || known.has(gid)) continue;
    const side = {};
    c.competitors.forEach((t) => { side[t.homeAway] = t; });
    if (!side.home || !side.away) continue;
    const sm = await espnSite("summary", "event=" + gid);
    const teams = (sm && sm.boxscore && sm.boxscore.players) || [];
    if (!teams.length) continue;                      // box not posted yet: next check
    const T = (t) => ETRI[t.team.abbreviation] || t.team.abbreviation;
    const q = (t) => (t.linescores || []).map((x) => Math.round(x.value || 0)).join(",");
    RECAP.games.push([gid, d, T(side.away), T(side.home), +side.away.score, +side.home.score,
                      q(side.away), q(side.home), st.shortDetail || st.name, +(e.status.period || 0)]);
    RECAP.logos[T(side.away)] = side.away.team.logo; RECAP.logos[T(side.home)] = side.home.team.logo;
    const box = RECAP.box[gid] = [];
    (RECAP.lv = RECAP.lv || {})[gid] = 1;
    teams.forEach((tm) => {
      const abb = T(tm);
      (tm.statistics || []).forEach((blk) => (blk.athletes || []).forEach((a) => {
        const s = {}; (blk.names || []).forEach((n, i) => { s[n] = (a.stats || [])[i]; });
        const pid = +a.athlete.id, dnp = !!a.didNotPlay || !(a.stats && a.stats.length);
        const n = (k) => (/^[+-]?\d+$/.test(s[k] || "") ? parseInt(s[k], 10) : null);
        const sp = (k) => String(s[k] || "0-0").split("-").map((x) => parseInt(x, 10) || 0);
        box.push([pid, abb, a.starter ? 1 : 0, dnp ? (a.reason || null) : null, n("+/-")]);
        if (!BYID[pid]) RECAP.nm[pid] = a.athlete.displayName;
        if (dnp) return;
        const [fgm, fga] = sp("FG"), [f3m, f3a] = sp("3PT"), [ftm, fta] = sp("FT");
        const v = {PTS: n("PTS"), FGM: fgm, FGA: fga, FTM: ftm, FTA: fta, FG3M: f3m, REB: n("REB"),
                   OREB: n("OREB"), AST: n("AST"), STL: n("STL"), BLK: n("BLK"), TOV: n("TO")};
        RECAP.fb[gid + ":" + pid] = [n("MIN")].concat(STATS.map((k) => v[k] || 0), [f3a]);
      }));
    });
    added++;
  }
  return added;
}
let LIVE_P = null;
function liveRecap() {
  const days = liveDays();
  if (!days.length || LIVE_P) return;
  LIVE_P = Promise.all(days.map(liveDay)).then((n) => {
    LIVE_P = null;
    if (n.some((x) => x) && !$("tab-recap").hidden) {
      const latest = RECAP.games.map((g) => g[1]).sort().pop();
      if (RC.day && RC.day < latest && RC.auto) RC.day = latest;   // follow tonight unless a day was picked
      renderRecap();
    }
  }).catch(() => { LIVE_P = null; });
}

// that night's fantasy lineups from ESPN (owner 11-14: "only the points that counted; played never above 10"):
// the league feed for the day's scoring period lists every roster with its lineup slot (12 bench, 13 IR)
const RCL = {};
function recapLineups(day) {
  if (L.platform !== "espn" || !/^\d+$/.test(L.id || "")) return null;
  const k = L.id + "|" + day, x = RCL[k];
  const stale = x && !(x instanceof Promise) && day === todayET() && Date.now() - (x.at || 0) > 300e3;
  if (x && !(x instanceof Promise) && !stale) return x.ok ? x : null;
  if (!x || stale) RCL[k] = fetch(espnBase() + L.id + "?view=mMatchupScore&view=mScoreboard&scoringPeriodId=" + espnPeriod(day), {cache: "no-store"})
    .then((r) => (r.ok ? r.json() : null)).then((j) => {
      const out = {owner: {}, slot: {}, ok: false, at: Date.now()};
      ((j && j.schedule) || []).forEach((m) => ["home", "away"].forEach((s2) => {
        const sd = m[s2]; if (!sd || !sd.rosterForCurrentScoringPeriod) return;
        out.ok = true;
        sd.rosterForCurrentScoringPeriod.entries.forEach((e) => { out.owner[e.playerId] = sd.teamId; out.slot[e.playerId] = e.lineupSlotId; });
      }));
      RCL[k] = out;
      if (out.ok && !$("tab-recap").hidden && RC.day === day) renderRecap();
    }).catch(() => { RCL[k] = {ok: false, at: Date.now()}; });
  return x && !(x instanceof Promise) && x.ok ? x : null;
}
function renderRecap() {
  if (!RECAP || !GAMES) {
    $("rc-games").innerHTML = '<p class="note">Loading games&hellip;</p>';
    Promise.all([loadRecap(), loadGames()]).then(([rc]) => {
      if (rc) renderRecap();
      else $("rc-games").innerHTML = '<div class="msg err">The recap data is not built yet.</div>';
    });
    return;
  }
  liveRecap();
  const days = [...new Set(RECAP.games.map((g) => g[1]))].sort().reverse();
  if (!days.length) { $("rc-games").innerHTML = '<p class="note">No finished games yet.</p>'; return; }
  if (!RC.day || !days.includes(RC.day)) { RC.day = days[0]; RC.auto = true; }
  const di = days.indexOf(RC.day);
  const dlabel = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short", month: "short", day: "numeric"});
  // two linked day pickers (top of the page and above the games)
  const dopts = days.map((d) => `<option value="${d}"${d === RC.day ? " selected" : ""}>${dlabel(d)}</option>`).join("");
  document.querySelectorAll(".rc-daysel").forEach((el) => { el.innerHTML = dopts; });
  document.querySelectorAll(".rc-prev").forEach((b) => { b.disabled = di >= days.length - 1; });
  document.querySelectorAll(".rc-next").forEach((b) => { b.disabled = di <= 0; });

  const lg = LGRES[L.id], mt = myTeam();
  // whose player he was that night and whether he was in a starting slot (ESPN's lineup for that day;
  // today's rosters until it loads or for leagues ESPN can't serve)
  const DL = lg ? recapLineups(RC.day) : null;
  const ownOf = (id) => (DL ? DL.owner[id] : lg ? lg.owner[id] : undefined);
  const counted = (id) => (DL ? DL.slot[id] !== 12 && DL.slot[id] !== 13 : true);
  const fan = (id) => (lg && ownOf(id) != null ? lg.byId[ownOf(id)] : null);
  const games = RECAP.games.filter((g) => g[1] === RC.day);
  if (RC.g && !games.some((g) => g[0] === RC.g)) RC.g = null;
  const lines = {}, all = [];
  games.forEach((g) => {
    lines[g[0]] = gameLines(g[0]);
    Object.values(lines[g[0]]).forEach((rows) => rows.forEach((r) => { if (r.fp != null) all.push(r); }));
  });
  // games scheduled that day but not final when the site was built
  const sched = new Set();
  Object.entries(META.sched).forEach(([t, gs]) => gs.forEach((g) => { if (g[0] === RC.day) sched.add([t, g[1]].sort().join("-")); }));
  const missing = Math.max(0, sched.size - games.length);
  $("rc-count").innerHTML = `${games.length} game${games.length === 1 ? "" : "s"} · ${all.length} players` +
    (missing ? ` · <span class="pos-dn">${missing} more not final yet (each one appears here once ESPN calls it final; reopen Recap or press Refresh)</span>` : "") +
    (games.some((g) => RECAP.lv && RECAP.lv[g[0]]) ? ` · <span class="dim" title="Fetched from ESPN in your browser; the next site build replaces it with the full data">live from ESPN</span>` : "");
  $("rc-lede").innerHTML = `Every game of the night, scored under <strong>${esc(L.name)}</strong>. Click a game for both box scores. ` +
    `<strong>Luck</strong> = fantasy points minus luck-adjusted points (his own per-minute rates at the minutes he played, plus his real shots and assists): ` +
    `<span class="pos-dn">orange</span> means the box score flatters him, <span class="pos-up">green</span> means he played better than it looks.`;

  // ---- the night in fantasy: KPIs, league scoreboard, your team, lists
  const srow = (r, v, own = true) => `<div class="srow"><span class="nm" data-id="${r.id}">${esc(pname(r.id))}</span>` +
    `<span class="sub">${esc(r.tm)}${own && fan(r.id) ? " · " + esc(fan(r.id).ab) : ""}</span><span class="v">${v}</span></div>`;
  const wl = all.filter((r) => r.lk != null);
  const NL = 10;                                            // owner 11-14: ten per list
  const byFp = all.slice().sort((a, b) => b.fp - a.fp).slice(0, NL);
  const hot = wl.slice().sort((a, b) => b.lk - a.lk).filter((r) => r.lk > 0).slice(0, NL);
  const cold = wl.slice().sort((a, b) => a.lk - b.lk).filter((r) => r.lk < 0).slice(0, NL);
  const faPop = lg ? all.filter((r) => ownOf(r.id) == null).sort((a, b) => b.fp - a.fp).slice(0, NL) : [];
  const minUp = all.filter((r) => BYID[r.id] && BYID[r.id].pmpg && r.min != null)
    .map((r) => Object.assign({}, r, {dm: r.min - BYID[r.id].pmpg})).filter((r) => r.dm >= 6).sort((a, b) => b.dm - a.dm).slice(0, NL);
  // quiet nights: rostered players who got real minutes (20+) and the fewest fantasy points
  const quiet = lg ? all.filter((r) => ownOf(r.id) != null && (r.min || 0) >= 20).sort((a, b) => a.fp - b.fp).slice(0, NL) : [];
  let board = "", mineCard = "";
  if (lg) {
    const T = lg.teams.map((t) => {
      const rs = all.filter((r) => ownOf(r.id) === t.id && counted(r.id)), bn = all.filter((r) => ownOf(r.id) === t.id && !counted(r.id));
      return {t, n: rs.length, fp: rs.reduce((a, r) => a + r.fp, 0), lk: rs.reduce((a, r) => a + (r.lk || 0), 0),
              bn: bn.reduce((a, r) => a + r.fp, 0), nb: bn.length, top: rs.slice().sort((a, b) => b.fp - a.fp)[0]};
    }).sort((a, b) => b.fp - a.fp);
    const fa = all.filter((r) => ownOf(r.id) == null);
    board = `<div class="card nf-board"><h4>League scoreboard <span class="dim" style="font-weight:500;text-transform:none;letter-spacing:0">(${DL ? "starters only, as each team set its lineup that night" : "today&rsquo;s rosters, loading that night&rsquo;s lineups&hellip;"})</span></h4>` +
      '<table class="mini"><thead><tr><th class="l">Fantasy team</th><th title="Starters who played">Played</th><th title="Points from starters only: what counted">FP</th><th title="Fantasy points minus luck-adjusted points (starters)">Luck</th>' +
      (DL ? '<th title="Points scored by players on the bench (or IR): did not count">Bench</th>' : "") + '<th class="l">Best</th></tr></thead><tbody>' +
      T.map((x, i) => `<tr class="${x.t.id === mt ? "mine" : ""}"><td class="l">${i + 1}. ${esc(x.t.name)}</td><td>${x.n}</td><td class="big">${fx(x.fp, 0)}</td>` +
        `<td class="${lkCls(x.lk, 10)}">${sg(x.lk, 0)}</td>${DL ? `<td class="dim" title="${x.nb} bench player${x.nb === 1 ? "" : "s"} played">${x.nb ? fx(x.bn, 0) : "–"}</td>` : ""}<td class="l">${x.top ? `<span class="nm" data-id="${x.top.id}">${esc(surname(pname(x.top.id)))}</span> <span class="dim">${fx(x.top.fp, 0)}</span>` : ""}</td></tr>`).join("") +
      `<tr class="dimrow"><td class="l">Free agents</td><td>${fa.length}</td><td>${fx(fa.reduce((a, r) => a + r.fp, 0), 0)}</td><td></td>${DL ? "<td></td>" : ""}<td class="l">${faPop[0] ? esc(surname(pname(faPop[0].id))) + ' <span class="dim">' + fx(faPop[0].fp, 0) + "</span>" : ""}</td></tr>` +
      "</tbody></table></div>";
    if (mt != null && lg.byId[mt]) {
      const mine = all.filter((r) => ownOf(r.id) === mt).sort((a, b) => counted(b.id) - counted(a.id) || b.fp - a.fp);
      const st = mine.filter((r) => counted(r.id));
      const tot = st.reduce((a, r) => a + r.fp, 0), tl = st.reduce((a, r) => a + (r.lk || 0), 0);
      mineCard = `<div class="card"><h4>Your team<b>${esc(lg.byId[mt].name)}</b></h4>` +
        (mine.length ? mine.map((r) => (counted(r.id) ? srow(r, `${fx(r.fp)} <span class="${lkCls(r.lk)}">(${sg(r.lk)})</span>`, false)
            : srow(r, `<span class="dim">${fx(r.fp)} · bench</span>`, false).replace('class="srow"', 'class="srow bnrow"'))).join("") +
          `<div class="srow" style="border-top:1px solid var(--rule);margin-top:.2rem;padding-top:.25rem"><b>${st.length} started${mine.length > st.length ? ` · ${mine.length - st.length} on the bench` : ""}</b>` +
          `<span class="v"><b>${fx(tot)}</b> <span class="${lkCls(tl, 8)}">(${sg(tl)} luck)</span></span></div>`
          : '<p class="note" style="margin:0">None of your players played.</p>') +
        `<p class="note" style="margin:.3rem 0 0;font-size:.74rem">${DL ? "Your lineup that night; the total counts starters only (bench points shown dimmed)." : "Everyone on your roster today, started or benched (loading that night&rsquo;s lineup)."}</p></div>`;
    }
  }
  // ---- the lists: rank, headshot, team logo, whose player, the number, a bar for its size
  const own = (id) => {
    if (!lg) return "";
    const o = ownOf(id);
    if (o == null) return '<span class="ow fa" title="Free agent">FA</span>';
    if (o === mt) return '<span class="ow me" title="Your player">YOU</span>';
    return `<span class="ow" title="${esc((lg.byId[o] || {}).name || "")}">${esc((lg.byId[o] || {}).ab || "")}</span>`;
  };
  const lrow = (r, i, val, sub, frac, tone) => `<div class="lr${lg && ownOf(r.id) === mt ? " mine" : ""}">` +
    `<i class="lr-bar ${tone || ""}" style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></i>` +
    `<span class="lr-k">${i + 1}</span><span class="lr-who"><span class="nm" data-id="${r.id}">${esc(pname(r.id))}</span>` +
    `<span class="lr-m"><span class="sub">${esc(r.tm)}</span>${own(r.id)}${r.min != null ? `<span class="lr-min">${r.min} min</span>` : ""}</span></span>` +
    `<span class="lr-v">${val}${sub ? `<small>${sub}</small>` : ""}</span></div>`;
  const mx = (rows, f) => Math.max(1e-9, ...rows.map((r) => Math.abs(f(r))));
  const list = (cls, title, hint, rows, fn, empty = "-") => `<div class="card nf-l ${cls}"><h4><i class="nf-dot"></i>${title}<span class="nf-hint">${hint}</span></h4>` +
    (rows.map(fn).join("") || `<p class="note" style="margin:0">${empty}</p>`) + "</div>";
  const lkTxt = (r) => (r.lk != null ? `<span class="${lkCls(r.lk)}">${sg(r.lk)} luck</span>` : "");
  $("rc-sthead").textContent = dlabel(RC.day);
  const mF = mx(byFp, (r) => r.fp), mH = mx(hot, (r) => r.lk), mC = mx(cold, (r) => r.lk), mA = mx(faPop, (r) => r.fp), mM = mx(minUp, (r) => r.dm);
  $("rc-stand").innerHTML =
    (board || mineCard ? `<div class="nf-top">${board}${mineCard}</div>` : "") +
    '<div class="stand nf-lists">' +
    list("t-top", "Top fantasy scores", "the night&rsquo;s best", byFp, (r, i) => lrow(r, i, fx(r.fp), lkTxt(r), r.fp / mF, "acc")) +
    list("t-hot", "Ran hot", "the box score flatters him: fade", hot, (r, i) => lrow(r, i, `<span class="pos-dn">${sg(r.lk)}</span>`, `${fx(r.fp)} fp`, r.lk / mH, "hot")) +
    list("t-cold", "Ran cold", "better than it looks: buy", cold, (r, i) => lrow(r, i, `<span class="pos-up">${sg(r.lk)}</span>`, `${fx(r.fp)} fp`, -r.lk / mC, "cold")) +
    (lg ? list("t-fa", "Free agents who popped", "on nobody&rsquo;s roster", faPop, (r, i) => lrow(r, i, fx(r.fp), lkTxt(r), r.fp / mA, "good"), "No free agents played") : "") +
    list("t-min", "Minutes up", "vs his usual minutes", minUp, (r, i) => lrow(r, i, `<span class="pos-up">+${r.dm.toFixed(0)} min</span>`, `${fx(r.fp)} fp`, r.dm / mM, "good"), "Nobody played 6+ minutes over his norm") +
    (lg ? list("t-quiet", "Quiet nights", "rostered, 20+ minutes, fewest points", quiet, (r, i) => lrow(r, i, fx(r.fp), lkTxt(r), 0, "dim"), "-") : "") +
    "</div>";

  // ---- game cards
  const logo = (t) => RECAP.logos[t] ? `<img src="${esc(RECAP.logos[t])}" alt="" loading="lazy">` : "";
  $("rc-games").innerHTML = games.map((g) => {
    const [gid, , aw, hm, ap, hp, , , status] = g;
    const rows = Object.values(lines[gid]).flat().filter((r) => r.fp != null);
    const top = rows.slice().sort((a, b) => b.fp - a.fp)[0];
    const mineN = mt != null && lg ? rows.filter((r) => ownOf(r.id) === mt).length : 0;
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
    return `<tr class="${mine ? "mine" : f ? "theirs" : ""}"><td class="l name" data-id="${r.id}">${esc(pname(r.id))}${BYID[r.id] ? tags(BYID[r.id]) : ""}</td>` +
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
  // the league-wide recap folds like the streaming planner; open or closed is remembered in this browser
  const fold = $("rc-fold");
  if (fold) {
    if (lsGet("fnba.v2.rcfold", 1) === 0) fold.open = false;
    fold.addEventListener("toggle", () => lsSet("fnba.v2.rcfold", fold.open ? 1 : 0));
  }
  document.querySelectorAll(".rc-daysel").forEach((el) => el.addEventListener("change", (e) => { RC.day = e.target.value; RC.g = null; RC.auto = false; renderRecap(); }));
  const step = (d) => {
    const days = [...new Set(RECAP.games.map((g) => g[1]))].sort().reverse();
    const i = days.indexOf(RC.day) + d;
    if (i >= 0 && i < days.length) { RC.day = days[i]; RC.g = null; RC.auto = i === 0; renderRecap(); }
  };
  document.querySelectorAll(".rc-prev").forEach((b) => b.addEventListener("click", () => step(1)));
  document.querySelectorAll(".rc-next").forEach((b) => b.addEventListener("click", () => step(-1)));
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
const WV = {days: null, match: "all", rank: "proj", pos: "", avail: true, sort: null, dir: -1};
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
// ---- defence vs position: each team ranked by fantasy points it allows per game
// to guards / forwards / centres (META.mf, season to date, teams with 5+ games).
// 1 = allows the fewest (toughest), N = the most (easiest), as ESPN's football
// matchup ranks. Owner's colours: the 15 easiest green, the 10 toughest red.
const DVP_GREEN = 15, DVP_RED = 10;
const WK_MCH = 2.0;                       // My week: mark a game only when the matchup is worth 2+ FP either way (~1 in 4 games)
const CLS_NAME = {G: "guards", F: "forwards", C: "centres"};
let DVP = null;
function dvpRanks() {
  if (DVP && DVP.mf === META.mf) return DVP;
  DVP = {mf: META.mf, n: 0};
  const T = Object.keys(META.mf || {});
  ["G", "F", "C"].forEach((c) => {
    DVP[c] = {};
    T.filter((t) => META.mf[t][c] != null).sort((a, b) => META.mf[a][c] - META.mf[b][c])
      .forEach((t, i) => { DVP[c][t] = i + 1; });
  });
  DVP.n = T.length;
  return DVP;
}
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
function dvpCls(rank) {
  const R = dvpRanks();
  return rank > R.n - DVP_GREEN ? "dvp-g" : rank <= DVP_RED ? "dvp-r" : "dvp-n";
}
function dvpBadge(opp, c) {
  const R = dvpRanks(), k = (R[c] || {})[opp];
  if (!k) return "";
  return `<span class="dvp ${dvpCls(k)}">${ordinal(k)}</span>`;
}
function dvpTip(opp, c) {
  const R = dvpRanks(), k = (R[c] || {})[opp], f = (META.mf[opp] || {})[c];
  if (!k) return `${opp}: fewer than 5 games, no rank yet`;
  return `${opp} vs ${CLS_NAME[c]}: ${ordinal(k)} of ${R.n} (1st = allows the fewest fantasy points)\n` +
    `allows ${Math.round(f * 100)}% of the league-average FP to ${CLS_NAME[c]}, over ${META.mf[opp].n} games`;
}
// ---- the day picker (owner, 2026-11-13: "select a day or several days, and only
// players whose team plays those days show up"). Days offered: today through the
// end of NEXT matchup week. "Plays every day picked" (default) keeps players whose
// team plays on all of them; "Any of them" keeps a game on any; the projection
// always adds up the games on the picked days.
// the first day offered: today, or tomorrow once today's first game has tipped off
// (no more moves count today, so the list opens on tomorrow's games)
const wvDay0 = () => { const t = todayET(), d = t > META.asof ? t : META.asof; return d === t && dayLocked(t) ? addDays(t, 1) : d; };
function wvWeeks() {
  const d0 = wvDay0(), W = META.weeks || [];
  const k = W.findIndex((w) => w[1] <= d0 && d0 <= w[2]);
  const cur = k >= 0 ? W[k] : null, nxt = k >= 0 ? W[k + 1] : W.find((w) => w[1] > d0);
  return {cur, nxt};
}
function dayOptions() {
  const d0 = wvDay0(), {cur, nxt} = wvWeeks();
  const end = nxt ? nxt[2] : cur ? cur[2] : addDays(d0, 13);
  const out = [];
  for (let d = d0; d <= end && out.length < 15; d = addDays(d, 1)) out.push(d);
  return out;
}
const nbaGamesOn = (d) => Object.values(META.sched || {}).reduce((a, g) => a + g.filter((x) => x[0] === d).length, 0) / 2;
function windowDays() {
  const opts = dayOptions(), ok = new Set(opts);
  let ds = (WV.days || []).filter((d) => ok.has(d));
  if (!ds.length) ds = [opts[0]];
  WV.days = ds.slice().sort();
  return WV.days;
}
function quickDays(q) {
  const d0 = wvDay0(), {cur, nxt} = wvWeeks(), out = [];
  const wk = q === "rw" ? cur : q === "nw" ? nxt : null;
  if (!wk) return [d0];
  for (let d = q === "rw" ? d0 : wk[1]; d <= wk[2]; d = addDays(d, 1)) out.push(d);
  return out;
}
const dShort = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short"});
function listWords(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
function windowLabel() {
  const days = windowDays(), t = todayET();
  const nm = (d) => (d === t ? "today" : d === addDays(t, 1) ? "tomorrow" : dShort(d) + " " + d.slice(5).replace("-", "/").replace(/^0/, ""));
  if (days.length === 1) return "on " + nm(days[0]);
  const all = WV.match === "all";
  if (days.length > 3) return `on ${all ? "every one" : "any"} of ${days.length} days (${nm(days[0])} to ${nm(days[days.length - 1])})`;
  return (all ? "on every one of " : "on any of ") + listWords(days.map(nm));
}
function renderDayChips() {
  const box = $("wv-days");
  if (!box) return;
  const opts = dayOptions(), sel = new Set(windowDays()), t = todayET(), {nxt} = wvWeeks();
  box.innerHTML = opts.map((d) => {
    const n = nbaGamesOn(d), shut = d === t && dayLocked(t);
    return (nxt && d === nxt[1] ? '<span class="wv-wk">next week</span>' : "") +
      `<button class="chip dchip${n ? "" : " none"}${shut ? " shut" : ""}" data-d="${d}" aria-pressed="${sel.has(d)}" title="${esc(niceDay(d) + `: ${n} NBA game${n === 1 ? "" : "s"}` + (shut ? "\nToday's pickups closed at the first tip-off: anyone you add now plays from tomorrow" : ""))}">` +
      `<b>${d === t ? "Today" : dShort(d)}</b><small>${d.slice(5).replace("-", "/")} · ${n}g</small></button>`;
  }).join("");
  document.querySelectorAll("#wv-match .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.m === WV.match)));
  $("wv-match").hidden = sel.size < 2;
}
function streamRows() {
  const days = new Set(windowDays());
  const lg = LGRES[L.id];
  const own = new Set(b2bList().split("\n").map(normName).filter(Boolean));
  const B = META.b2b, CZ = META.ceiling.z;
  const out = [];
  const skipped = [];
  PLAYERS.forEach((p) => {
    if (isAbsent(p)) return;
    const rostered = lg && lg.owner[p.id] != null;
    if (WV.avail && rostered) return;
    if (benched(p)) { if (fpg(p.s, p.bp) > 20) skipped.push(p); return; }
    if (WV.pos && !String(p.pos || "").split(/[,/ ]+/).includes(WV.pos)) return;
    const sch = (META.sched[p.tm] || []).filter((g) => days.has(g[0]) && !outOn(p, g[0]));
    if (!sch.length) return;
    if (WV.match === "all" && new Set(sch.map((g) => g[0])).size < days.size) return;   // must play every picked day
    const fp = fpg(p.s, p.bp);
    if (fp == null || fp <= 0) return;
    const fpd = fpgUnder(META.league, p.s, p.bp) || fp;
    const scale = fpd > 0 ? fp / fpd : 1;
    const sd = (p.sd || 0) * scale;
    const teamDays = new Set((META.sched[p.tm] || []).map((g) => g[0]));
    const listed = own.has(normName(p.n));
    const psit = listed ? 1 : p.b2b ? p.b2b[2] : B.base;
    let proj = 0, ceil = null;
    const ramp = rampFor(p);
    const games = sch.map(([d, opp, home]) => {
      const second = teamDays.has(addDays(d, -1));
      const sp = statusPlay(p, d), rf = ramp(d);
      const play = (second ? Math.max(0, 1 - Math.max(0, psit - B.other)) : 1) * sp;
      const mf = META.mf[opp];
      let adj = 0, tip = "";
      if (mf) {
        const c = posCls(p.pos), b = META.mfb;
        adj = (b.pace * (mf.pace - 1) + b.dvp * ((mf[c] || 1) - 1) + b.fgp * ((mf.fgp || 1) - 1) +
               b.home * (home ? 0.5 : -0.5)) * scale;
        const cw = {G: "guards", F: "forwards", C: "centres"}[c];
        tip = `Matchup ${sg(adj)} FP vs an average game:\n` +
          `   ${opp} pace: ${(mf.pace * 100).toFixed(0)}% of league\n` +
          `   FP ${opp} allows to ${cw}: ${((mf[c] || 1) * 100).toFixed(0)}% of league\n` +
          `   FG% ${opp} allows: ${((mf.fgp || 1) * 100).toFixed(0)}% of league\n` +
          `   ${home ? "home (+0.5)" : "away (−0.5)"} · ${mf.n} ${opp} games so far`;
      }
      const bst = boostFP(p, d), v = (fp + bst) * rf + adj;
      proj += play * v;
      if (play >= 0.5) ceil = Math.max(ceil ?? -1e9, v + CZ * sd * rf);
      return {d, opp, home, second, play, sp, rf, adj, bst, tip, val: play * v, v};
    });
    // Lock-In: one game per starter per Mon-Sun week -> his expected locked score
    // for each week in the window (games are extra chances, not extra points)
    if (L.mode === "lockin") {
      const byWk = {};
      games.forEach((g) => { const dt = new Date(g.d + "T12:00:00Z"), mon = addDays(g.d, -((dt.getUTCDay() + 6) % 7));
        (byWk[mon] = byWk[mon] || []).push({play: g.play, v: g.v, sd: sd * g.rf}); });
      proj = Object.values(byWk).reduce((a, gs) => a + lockV(gs), 0);
    }
    const now = p.td && p.gp ? fpg(p.td, p.tbp || [0, 0, 0]) : null;
    const adjFp = p.adj ? fpg(p.adj, p.abp) : null;
    const bg = games.filter((g) => g.bst > 0.05);
    const inj = bg.length ? bg.reduce((a, g) => a + g.bst * g.play, 0) : null;   // FP the injury boost adds in this window
    const sv = games.map((g) => slpFP(p.id, g.d)).filter((v) => v != null);
    out.push({p, fp, games, proj, ceil, now, adjFp, slp: sv.length ? sv.reduce((a, v) => a + v, 0) / sv.length : null, slpN: sv.length, boost: boostInfo(p), inj, injN: bg.length, injPg: bg.length ? bg.reduce((a, g) => a + g.bst, 0) / bg.length : 0,
      luck: now != null && adjFp != null ? now - adjFp : null,
      psit, listed, risk: listed || psit >= B.flag, ng: games.length,
      st: rostered ? (lg.byId[lg.owner[p.id]] || {}).ab : lg ? (lg.wv[p.id] ? "WVR" : "FA") : null});
  });
  out.skipped = skipped;
  return out;
}
function renderWaivers(only) {
  // only = "list": a filter or sort changed, the streaming planner stays as it is
  if (only !== "list") {
    renderBoostPanel("wv-boosts");
    SP.key = null;
    renderPlanner();
  }
  renderDayChips();
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
    '<th class="l grp gcolh" title="Each game: opponent, its defence rank vs his position (1 = toughest, 30 = easiest), and the matchup adjustment in FP (position defence, pace, FG% allowed, home court)">Games<br><span class="th-sub">defence rank &middot; matchup FP</span></th>' +
    H("inj", 'Injury /<br>team effect', "l grp injh", "Extra fantasy points from teammates being out (their minutes and usage passed on), added up over this window. Blank = no teammate out") +
    H("fp", "ROS FP/G", "grp", "Rest-of-season FP/G (the tested in-season blend)") +
    H("now", "Now FP/G", "", "Actual FP/G this season") +
    H("adjFp", "Luck-adj", "", "FP/G with luck removed: his own per-minute rates at the minutes he played, plus his real shot attempts and assists") +
    H("luck", "Luck/G", "", "Actual minus luck-adjusted, per game. Positive = the box score flatters him") +
    H("psit", "B2B sit", "grp", "Chance he sits the second night of a back-to-back (rest sits from the game logs, shrunk toward the league's 11%)") +
    H("own", "Own%", "", "Rostered % across ESPN leagues") + "</tr>";
  const body = list.map((r, i) => {
    const p = r.p;
    const chipTip = (g) => [`${niceDay(g.d)} ${g.home ? "vs" : "@"} ${g.opp} — projected ${g.val.toFixed(1)} FP`,
      g.tip,
      g.bst > 0.05 ? `Injury boost that night: +${g.bst.toFixed(1)} FP (${r.boost ? r.boost.names.join(", ") : "teammate"} out)` : "",
      g.sp < 1 ? statusPlayTip(r.p, g.d) : "",
      g.rf < 1 ? `Back from a layoff: about ${Math.round(g.rf * 100)}% of his usual minutes in this game (first two games back)` : "",
      g.second ? `2nd night of a back-to-back: ${Math.round(r.psit * 100)}% chance he sits` + (r.p.b2b ? ` (sat ${b2b0(r.p)} second nights; this season counts 4x last)` : "") +
        `, so this game counts ${Math.round(g.play / (g.sp || 1) * 100)}%` : ""].filter(Boolean).join("\n");
    const pc = posCls(p.pos);
    const gs = r.games.map((g) => `<span class="gch${g.second ? " b2" : ""}${g.sp < 0.6 ? " st" : ""}" title="${esc(dvpTip(g.opp, pc) + "\n" + chipTip(g))}">` +
      `${days.length > 1 ? dname(g.d) + " " : ""}${g.home ? "vs" : "@"} ${esc(g.opp)}${dvpBadge(g.opp, pc)}` +
      `<span class="m ${g.adj >= 1 ? "pos-up" : g.adj <= -1 ? "pos-dn" : "dim"}">${g.tip ? sg(g.adj) : ""}</span>` +
      "</span>").join("");
    const b2 = r.p.b2b;
    return `<tr data-id="${p.id}"><td class="dim">${i + 1}</td>` +
      `<td class="l name">${esc(p.n)}${tags(p)}${r.risk ? `<span class="tag b2b" title="${esc(r.listed ? "On your list: doesn't play the 2nd night of back-to-backs, so those games count 0" : `Often rests the 2nd night of back-to-backs\nSat ${b2b0(r.p)} second nights (last season + this)\nChance he sits a 2nd night: ${Math.round(r.psit * 100)}% (league 11%)`)}">B2B</span>` : ""}</td>` +
      `<td class="l dim">${esc(p.tm)}</td><td class="l dim">${esc(p.pos || "")}</td>` +
      (lg ? `<td class="l">${r.st === "WVR" ? '<span class="tag wvr" style="margin:0">WVR</span>' : esc(r.st || "")}</td>` : "") +
      `<td class="grp big">${fx(r.proj)}</td><td>${fx(r.ceil)}</td>` +
      `<td class="l grp gcol">${gs}</td>` +
      (r.inj ? `<td class="l grp injcol" title="${esc(boostTip(r.boost) + (r.injN < r.ng ? `\nBoosted in ${r.injN} of his ${r.ng} games in this window (the rest come after a return)` : ""))}">` +
        `<b class="pos-up">+${r.inj.toFixed(1)}</b>${r.ng > 1 ? `<span class="dim inj-pg">${r.injPg.toFixed(1)}/g${r.injN < r.ng ? ` · ${r.injN} of ${r.ng} games` : ""}</span>` : ""}` +
        `<span class="sub">${esc(r.boost.parts.map((x) => surname(x.name)).join(", "))} out</span></td>` : `<td class="grp injcol"></td>`) +
      `<td class="grp">${fx(r.fp)}${r.slp != null ? `<span class="sub slp" title="Sleeper&rsquo;s projection (Rotowire) for these ${r.slpN} game${r.slpN > 1 ? "s" : ""}, per game, under your scoring. A benchmark: our numbers never use it">Sleeper ${fx(r.slp)}</span>` : ""}</td><td>${fx(r.now)}</td><td>${fx(r.adjFp)}</td>` +
      `<td class="${r.luck == null ? "" : r.luck >= 1 ? "pos-dn" : r.luck <= -1 ? "pos-up" : ""}">${sg(r.luck)}</td>` +
      `<td class="grp ${r.risk ? "" : "dim"}" title="${b2 ? `Sat ${b2[0]} of ${b2[1]} second nights (last season + this)` : "No second nights on record"}">${r.listed ? "your list" : Math.round(r.psit * 100) + "%"}</td>` +
      `<td class="dim">${p.own != null ? p.own.toFixed(0) : "-"}</td></tr>`;
  }).join("");
  $("wv-table").querySelector("tbody").innerHTML = body ||
    `<tr><td class="l dim" colspan="15">No ${WV.avail ? "available " : ""}players have a game ${esc(windowLabel())}.</td></tr>`;
  const wl = windowLabel();
  $("wv-count").textContent = `${list.length} of ${rows.length} with a game ${wl}`;
  const tdy = todayET(), shut = dayLocked(tdy);
  $("wv-lede").innerHTML = (shut ? `<b>Today&rsquo;s pickups are closed</b> (first tip-off${tipClock(tdy) ? " " + esc(tipClock(tdy)) : ""}), so the list starts with tomorrow&rsquo;s games: anyone you add now plays from tomorrow. ` : "") +
    (!days.length ? "No fantasy week left in the schedule for this window. " : `Pickups with a game ${wl}, scored under <strong>${esc(L.name)}</strong>${days.length > 1 ? " (the projection adds up their games on those days)" : ""}. ` +
    (lg ? `Available = not on any roster in your league${Object.keys(lg.wv).length ? "; WVR = on waivers (a claim, not an instant add)" : ""}. `
      : (L.platform === "espn" ? "Loading your league&rsquo;s rosters&hellip; " : (L.platform === "sleeper" ? "Loading your Sleeper league&hellip; " : PLAT_NAME[L.platform] ? `${PLAT_NAME[L.platform]} rosters aren&rsquo;t read yet, so everyone is listed; ESPN&rsquo;s rostered % is your guide. ` : "This league isn&rsquo;t a public ESPN league, so everyone is listed; ESPN&rsquo;s rostered % is your guide. "))) +
    `Players out are left off, using the <strong>official NBA injury report</strong>${OFF.as_of ? ` (as of ${esc(OFF.as_of)})` : ""} first and ESPN&rsquo;s status otherwise: ` +
    `a player listed out on his team&rsquo;s last two or more reports is dropped entirely, a one-night Out removes just that game, and Doubtful / Questionable are tagged. ` +
    `Rank by <strong>Ceiling</strong> when you need a big night more than a safe one.`);
  const sk = (rows.skipped || []).sort((a, b) => fpg(b.s, b.bp) - fpg(a.s, a.bp));
  $("wv-note").innerHTML = (sk.length ? `<strong>Left off — not in the rotation</strong> (healthy, but no minutes in any of their team&rsquo;s last 5 games; they come back the day they play): ` +
    sk.slice(0, 12).map((p) => `<span class="name" data-id="${p.id}">${esc(p.n)}</span> <span class="dim">${esc(p.tm)}</span>`).join(", ") + (sk.length > 12 ? ` and ${sk.length - 12} more` : "") + ".<br><br>" : "") +
    "Matchup chips: the one-game adjustment tested on 16 seasons (opponent pace, fantasy points it allows to the player's position, " +
    "FG% it allows, home court), worth about ±2–3 points at the extremes. A dashed chip is the second night of a back-to-back. " +
    "Injury statuses and the matchup numbers are from this morning&rsquo;s build; rosters and waivers are read live from ESPN.";
  // ---- the sitters list
  const sit = PLAYERS.filter((p) => p.b2b && p.b2b[2] >= META.b2b.flag).sort((a, b) => b.b2b[2] - a.b2b[2]);
  $("wv-b2bsum").textContent = `— ${sit.length} players flagged`;
  $("wv-b2btab").innerHTML = '<div class="tablewrap" style="max-height:24rem;margin-top:.7rem"><table><thead><tr><th class="l">Player</th><th class="l">Tm</th>' +
    '<th title="Rest sits on second nights / second-night chances (bracketed by games played)">Sat</th><th>Sit chance</th>' + (lg ? '<th class="l">Status</th>' : "") + "</tr></thead><tbody>" +
    sit.map((p) => `<tr data-id="${p.id}"><td class="l name">${esc(p.n)}</td><td class="l dim">${esc(p.tm)}</td><td>${b2b0(p)}</td>` +
      `<td>${Math.round(p.b2b[2] * 100)}%</td>${lg ? `<td class="l dim">${lg.owner[p.id] != null ? esc((lg.byId[lg.owner[p.id]] || {}).ab) : lg.wv[p.id] ? "WVR" : "FA"}</td>` : ""}</tr>`).join("") +
    "</tbody></table></div>";
}
function bindWaivers() {
  const chipset = (id, attr, fn) => document.querySelectorAll(`#${id} .chip`).forEach((c) => c.addEventListener("click", () => {
    fn(c.dataset[attr]);
    document.querySelectorAll(`#${id} .chip`).forEach((x) => x.setAttribute("aria-pressed", String(x === c)));
    renderWaivers("list");
  }));
  $("wv-days").addEventListener("click", (e) => {
    const c = e.target.closest(".dchip");
    if (!c) return;
    const s = new Set(windowDays()), d = c.dataset.d;
    if (s.has(d)) { if (s.size > 1) s.delete(d); } else s.add(d);
    WV.days = [...s];
    renderWaivers("list");
  });
  chipset("wv-match", "m", (v) => { WV.match = v; });
  document.querySelectorAll("#wv-quick .chip").forEach((c) => c.addEventListener("click", () => {
    WV.days = quickDays(c.dataset.q);
    WV.match = c.dataset.q === "0" ? "all" : "any";     // a whole week: nobody plays every night
    renderWaivers("list");
  }));
  chipset("wv-rank", "r", (v) => { WV.rank = v; WV.sort = null; });
  chipset("wv-pos", "p", (v) => { WV.pos = v; });
  chipset("wv-who", "a", (v) => { WV.avail = v === "1"; });
  $("wv-table").querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (!th) return;
    const k = th.dataset.k;
    if (WV.sort === k) WV.dir = -WV.dir;
    else { WV.sort = k; WV.dir = k === "n" ? 1 : -1; }
    renderWaivers("list");
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

// ====================================================== STREAMING PLANNER
// Owner, 2026-11-03: "pick how many players I'm willing to drop and have the
// waiver tool choose who to pick up on which days to get the most games."
// The rest of the current matchup period is scored like My week: each day the
// players on the roster that day go into the starter slots by the exact
// assignment (positions respected), valued at the Waivers per-game formula.
// Each roster spot you'll give up (a player you said can go, or an open
// spot) gets the best SEQUENCE of free agents across the remaining days, found
// exactly by dynamic programming over (day, adds used, who holds the spot), for
// every number of adds; a small knapsack then splits the adds left this
// matchup (and the drops you allow) across spots, and the spots are re-solved
// against each other until the total stops improving. (A one-move-at-a-time
// greedy missed pairs that only pay together: Thu-Fri streamer, then a
// Sat-Sun one.) Free agents only: a waiver claim doesn't clear in time.
// ---- pickup lock: once the day's first NBA game tips off, ESPN no longer lets
// an add play that day. Tip times come from ESPN's live scoreboard (the
// published schedule has dates only); a game already under way also locks it.
const LOCK = {};                          // ET date -> {tip: ms|null, live: bool} | "pending"
const TIPP = {};
function tipPromise(d) { loadTip(d); return TIPP[d] || Promise.resolve(); }
function loadTip(d) {
  if (LOCK[d]) return;
  LOCK[d] = "pending";
  TIPP[d] = espnSite("scoreboard", "dates=" + d.replace(/-/g, "")).then((sb) => {
    const ev = (sb && sb.events) || [];
    const tips = ev.map((e) => Date.parse(e.date)).filter((t) => !isNaN(t));
    LOCK[d] = {tip: tips.length ? Math.min(...tips) : null, live: ev.some((e) => ((e.status || {}).type || {}).state !== "pre"), ok: !!sb};
    const t = LOCK[d].tip;
    if (t && t > Date.now()) setTimeout(() => {      // tip-off: moves now land on tomorrow's roster
      Object.keys(LGDATA).forEach((k) => delete LGDATA[k]);
      refreshLeagueData();
    }, t - Date.now() + 1000);
    if (!$("tab-wire").hidden) renderWaivers();
  });
}
function dayLocked(d) {
  const x = LOCK[d];
  if (!x) { loadTip(d); return false; }
  return x !== "pending" && (x.live || (x.tip != null && Date.now() >= x.tip));
}
const tipClock = (d) => { const x = LOCK[d]; return x && x.tip ? new Date(x.tip).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit", timeZoneName: "short"}) : ""; };
const SP = {n: Math.max(0, Math.min(3, +(lsGet("fnba.v2.spn", 2)))), wk: "cur", noMove: new Set(), pick: null, key: null, plan: null, dropOpen: false, sel: null, choice: {}};
const spPickKey = () => `fnba.v2.droppick.${L.key || L.id}.${myTeam()}`;
function spSaved() { const v = lsGet(spPickKey(), null); return Array.isArray(v) ? v : null; }
const SP_PTW = 1 / 200;                   // "Most games": one projected point = 1/200 of a start
const SP_POOL = 40;                       // free agents considered: the best 40 over the window + 6 per day
function planStream() {
  const lg = LGRES[L.id], mt = myTeam();
  if (L.mode === "lockin") return {err: "The streaming planner is for leagues where every game counts. In Lock-In only one game per starter counts each week, so extra games are extra chances, not extra points: the Waivers list below already ranks free agents by their Lock-In value."};
  if (!lg) return {err: L.platform === "espn" ? "Loading your league from ESPN…" : PLAT_NAME[L.platform] ? `The streaming planner for ${PLAT_NAME[L.platform]} leagues is coming next; it works with public ESPN leagues today.` : "The planner needs a public ESPN league (+ Add league at the top)."};
  if (mt == null) return {err: "Pick your team in “You are” at the top."};
  const today = todayET();
  const MPS = matchupPeriods(), ci = MPS.findIndex((p) => p.start <= today && today <= p.end);
  const CUR = ci >= 0 ? MPS[ci] : null, NXT = ci >= 0 ? MPS[ci + 1] : MPS.find((p) => p.start > today);
  // adds made after the day's first tip-off only count from tomorrow (ESPN locks the day)
  const d0 = dayLocked(today) ? addDays(today, 1) : today;
  // "This one" = rest of this matchup; "Next one" = next matchup Mon-Sun; "Both" = the two together
  const PERS = (SP.wk === "next" ? [NXT] : SP.wk === "both" ? [CUR && d0 <= CUR.end ? CUR : null, NXT] : [CUR]).filter(Boolean);
  if (!PERS.length) return {err: SP.wk === "cur" ? "No matchup is in progress." : "No next matchup in the schedule."};
  const SLOTS = starterSlots();
  const days = [], per = [], caps = [], parts = [];
  PERS.forEach((PR, k) => {
    const ds = [];
    for (let d = PR.start > d0 ? PR.start : d0; d <= PR.end; d = addDays(d, 1)) ds.push(d);
    const used = (lg.tx[mt] || {})[String(PR.id)] || 0;
    caps.push(PR.adds == null ? 7 : Math.max(0, PR.adds - used));
    parts.push({PR, T: teamWeek(lg, mt, ds, PR.id, SLOTS, today), n: ds.length, used});
    ds.forEach((d) => { days.push(d); per.push(k); });
  });
  if (!days.length) return {err: "This matchup ends today."};
  const nd = days.length;
  const PER = {start: PERS[0].start, end: PERS[PERS.length - 1].end, id: PERS[0].id};
  const addsLeft = caps.reduce((a, c) => a + c, 0), used = parts[0].used;
  // a move can be made on a day you allow, in a matchup with adds left
  const canMove = days.map((d, i) => !SP.noMove.has(d) && caps[per[i]] > 0);
  // the roster across the plan's days: each matchup's own week (lineup marks, injuries), joined
  const rows = new Map();
  let off = 0;
  parts.forEach(({T, n}) => {
    T.ps.forEach((r) => {
      if (!rows.has(r.id)) rows.set(r.id, Object.assign({}, r, {days: Array.from({length: nd}, (_, i) => ({d: days[i], g: null, avail: false, val: 0, play: 0}))}));
      r.days.forEach((x, i) => { rows.get(r.id).days[off + i] = x; });
    });
    off += n;
  });
  const T = {ps: [...rows.values()]};
  const cap = Object.entries(L.slots).filter(([k]) => k !== "IR").reduce((a, [, c]) => a + c, 0);
  const free = Math.max(0, cap - T.ps.filter((r) => lg.slot[r.id] !== 13).length);
  // expected starts, each projected point worth 1/200 of a start (a whole start beats
  // any realistic points gain, but 15 points outweighs a 2% rest risk — at 1e-4 the
  // planner picked a 2%-safer player 15 points worse). Owner 2026-11-13: always aim
  // for games (the "Most points" aim was removed).
  const W = (x) => (!x.avail ? 0 : x.play + x.val * SP_PTW);
  const keep = keepSet();
  // who may go: the visitor's ticks, else the n lowest rest-of-season points
  const cands = T.ps.filter((r) => r.p && lg.slot[r.id] !== 13 && !keep.has(normName(r.n)))
    .map((r) => ({r, tot: seasonLine(r.p).tot})).sort((a, b) => a.tot - b.tot);
  // your own ticks are remembered in this browser (per league + team); players no
  // longer on the roster drop out of the list, and with none left it's the default
  const sv = spSaved(), mine = sv ? new Set(sv.filter((id) => cands.some((c) => c.r.id === id))) : null;
  const pick = mine && mine.size ? mine : new Set(cands.slice(0, SP.n).map((c) => c.r.id));
  const mem = T.ps.map((r) => ({id: r.id, n: r.n, p: r.p, elig: r.elig, dv: r.days, w: r.days.map(W),
    from: 0, to: nd, orig: true, ok: pick.has(r.id)}));
  const all = PLAYERS.filter((p) => lg.owner[p.id] == null && !lg.wv[p.id] && p.s && !isAbsent(p) && !benched(p))
    .map((p) => {
      const dv = dayVals(p, days, false, (d, sp) => !outOn(p, d) && sp >= 0.05);
      return {id: p.id, n: p.n, p, elig: eligFromPos(p.pos).filter((s) => SLOTS.includes(s)), dv, w: dv.map(W), orig: false};
    })
    .filter((f) => f.w.some((v) => v > 0));
  // the best over the window plus the best on each single day (a Thursday-only
  // pickup can matter more than a three-game one)
  const sum = (f) => f.w.reduce((x, y) => x + y, 0) + f.dv.reduce((x, y) => x + y.val, 0) * 1e-4;
  const pick_ = new Set(all.slice().sort((a, b) => sum(b) - sum(a)).slice(0, SP_POOL).map((f) => f.id));
  days.forEach((_, i) => all.filter((f) => f.w[i] > 0).sort((a, b) => b.dv[i].val - a.dv[i].val).slice(0, 6).forEach((f) => pick_.add(f.id)));
  const pool = all.filter((f) => pick_.has(f.id));
  // day i's best lineup for the members on the roster that day (memoised)
  const memo = days.map(() => new Map());
  const dayBest = (i, ms) => {
    const on = ms.filter((m) => m.from <= i && i < m.to && m.w[i] > 0);
    const k = on.map((m) => m.id).sort().join(",");
    let v = memo[i].get(k);
    if (v == null) { v = assignMax(on.map((m) => SLOTS.map((s) => (m.elig.includes(s) ? m.w[i] : 0)))).total; memo[i].set(k, v); }
    return v;
  };
  const total = (ms, t0 = 0) => { let s = 0; for (let i = t0; i < nd; i++) s += dayBest(i, ms); return s; };
  const base = total(mem);
  const COST = 0.3;                                 // an add must earn at least 0.3 expected starts
  // solve for every drop count up to the one chosen and keep the best: allowing a
  // drop must never make the plan worse (the re-solve can settle in a local best)
  // CP = adds allowed in each matchup period of the plan ([this] or [this, next]),
  // TOT = adds allowed in all; a move can only be made on a day you allow (canMove)
  const solve = (maxDrops, pl, CP, TOT, cost = COST, cm = canMove) => {
    const spots = Array.from({length: free}, () => ({o: null, seq: []})).concat(mem.filter((m) => m.ok).map((o) => ({o, seq: []})));
    const fixed = mem.filter((m) => !m.ok);
    const segs = (sp) => {                         // who holds this spot on which days
      const out = [];
      if (sp.o) out.push(Object.assign({}, sp.o, {from: 0, to: sp.seq.length ? sp.seq[0].t : nd}));
      sp.seq.forEach((x, k) => out.push(Object.assign({}, x.m, {from: x.t, to: k + 1 < sp.seq.length ? sp.seq[k + 1].t : nd})));
      return out;
    };
    const roster = (but) => fixed.concat(...spots.filter((sp) => sp !== but).map(segs));
    // best schedule for one spot at each count of adds per period (state j = a0 x (c1 + 1) + a1),
    // the rest of the roster as it stands
    const curve = (sp, C2) => {
      const oth = roster(sp), taken = new Set(oth.map((m) => m.id));
      const C = [sp.o].concat(pl.filter((f) => !taken.has(f.id)));
      const mv = C.map((c) => days.map((_, i) => (c ? dayBest(i, oth.concat(Object.assign({}, c, {from: 0, to: nd}))) - dayBest(i, oth) : 0)));
      const n1 = (C2[1] || 0) + 1, NS = (C2[0] + 1) * n1, NC = C.length, NEG = -1e18;
      const prevOf = (j, p) => (p === 0 ? (j >= n1 ? j - n1 : -1) : (j % n1 >= 1 ? j - 1 : -1));
      let dp = Array.from({length: NS}, () => new Array(NC).fill(NEG));
      dp[0][0] = 0;                                // day 0 starts with the original holder (or nobody)
      const back = [];
      for (let i = 0; i < nd; i++) {
        const nx = Array.from({length: NS}, () => new Array(NC).fill(NEG)), bk = Array.from({length: NS}, () => new Array(NC));
        for (let j = 0; j < NS; j++) {
          const pj = cm[i] ? prevOf(j, per[i]) : -1;
          let b1 = -1, b2 = -1;                    // two best holders one add earlier (to switch from)
          if (pj >= 0) dp[pj].forEach((v, c) => { if (b1 < 0 || v > dp[pj][b1]) { b2 = b1; b1 = c; } else if (b2 < 0 || v > dp[pj][b2]) b2 = c; });
          for (let c = 0; c < NC; c++) {
            let v = dp[j][c], from = [j, c];
            if (c > 0 && pj >= 0) {                // add free agent c today (the original can't come back)
              const pc = b1 !== c ? b1 : b2;
              // ties go to the switch: the pickup lands on the LAST day it costs nothing,
              // so you keep your player (and the news) as long as possible
              if (pc >= 0 && dp[pj][pc] >= v) { v = dp[pj][pc]; from = [pj, pc]; }
            }
            if (v <= NEG / 2) continue;
            nx[j][c] = v + mv[c][i]; bk[j][c] = from;
          }
        }
        back.push(bk); dp = nx;
      }
      const stay = mv[0].reduce((x, y) => x + y, 0);
      return Array.from({length: NS}, (_, j) => {
        let c = dp[j].indexOf(Math.max(...dp[j]));
        if (dp[j][c] <= NEG / 2) return null;
        const hold = new Array(nd);
        let jj = j;
        for (let i = nd - 1; i >= 0; i--) { hold[i] = c; [jj, c] = back[i][jj][c]; }
        const seq = [];
        hold.forEach((h, i) => { if (h > 0 && (i === 0 || hold[i - 1] !== h)) seq.push({m: C[h], t: i}); });
        return {gain: dp[j][hold[nd - 1]] - stay, seq, adds: seq.length, a: [Math.floor(j / n1), j % n1]};
      });
    };
    let cur = total(roster(null));
    for (let round = 0; round < 4; round++) {
      const cv = spots.map((sp) => curve(sp, CP));
      // split the adds (per period, in all) and the drops you allow across spots: knapsack
      let best = new Map([["0,0,0", {v: 0, pick: []}]]);
      spots.forEach((sp, k) => {
        const nx = new Map();
        best.forEach((st, key) => {
          const [a0, a1, d] = key.split(",").map(Number);
          cv[k].forEach((o, j) => {
            if (!o || (j > 0 && !o.adds)) return;
            const b0 = a0 + o.a[0], b1 = a1 + o.a[1], d2 = d + (o.adds && sp.o ? 1 : 0);
            if (b0 > CP[0] || b1 > (CP[1] || 0) || b0 + b1 > TOT || d2 > maxDrops) return;
            const v = st.v + (o.adds ? o.gain - cost * o.adds : 0), k2 = b0 + "," + b1 + "," + d2;
            if (!nx.has(k2) || nx.get(k2).v < v - 1e-9) nx.set(k2, {v, pick: st.pick.concat([o.adds ? o.a : null])});
          });
        });
        best = nx;
      });
      const top = [...best.values()].sort((x, y) => y.v - x.v)[0];
      const keepSeq = spots.map((sp) => sp.seq);
      // the curves above each assumed the other spots unchanged, so two spots can
      // want the same player: clear them and re-solve one at a time with the adds
      // the knapsack gave each, every spot seeing the ones already set
      const gk = (k) => { const a = top.pick[k]; return a ? (cv[k][a[0] * ((CP[1] || 0) + 1) + a[1]] || {gain: 0}).gain : 0; };
      spots.forEach((sp) => { sp.seq = []; });
      spots.map((sp, k) => k).sort((x, y) => gk(y) - gk(x))
        .forEach((k) => {
          const a = top.pick[k];
          if (!a) return;
          const c = curve(spots[k], [a[0], a[1]]).filter(Boolean).sort((x, y) => (y.gain - cost * y.adds) - (x.gain - cost * x.adds))[0];
          spots[k].seq = c && c.adds && c.gain - cost * c.adds > 0 ? c.seq : [];
        });
      const now = total(roster(null));
      if (now <= cur + 1e-6) { spots.forEach((sp, k) => { sp.seq = keepSeq[k]; }); break; }
      cur = now;
    }
    const fin = roster(null);
    return {spots, fin, obj: total(fin) - cost * spots.reduce((x, sp) => x + sp.seq.length, 0)};
  };
  // final lineups: who starts each day
  const lineup = (ms) => days.map((_, i) => {
    const on = ms.filter((m) => m.from <= i && i < m.to && m.w[i] > 0);
    const res = assignMax(on.map((m) => SLOTS.map((s) => (m.elig.includes(s) ? m.w[i] : 0))));
    const st = on.filter((_, k) => res.rc[k] >= 0);
    return {starts: st.length, pts: st.reduce((a, m) => a + m.dv[i].val, 0), games: st.reduce((a, m) => a + m.dv[i].play, 0), ids: new Set(st.map((m) => m.id))};
  });
  const tally = (Ls) => ({starts: Ls.reduce((a, x) => a + x.starts, 0), pts: Ls.reduce((a, x) => a + x.pts, 0), games: Ls.reduce((a, x) => a + x.games, 0)});
  const before = lineup(mem), b0 = tally(before);
  const byId = new Map(all.map((f) => [f.id, f]));
  // a plan = the roster it ends with (fin) + its moves; each move's holder h is in fin
  const finish = (fin, moves) => {
    const after = lineup(fin), a0 = tally(after);
    moves.forEach((mv) => {
      const h = mv.h;
      mv.starts = days.map((_, i) => i >= h.from && i < h.to && after[i].ids.has(h.id));
      mv.pts = days.reduce((x, _, i) => x + (mv.starts[i] ? h.dv[i].val : 0), 0);
    });
    // roster spots: each chain of moves (add, then swaps of that pickup) is one spot, numbered by its first day
    const roots = moves.filter((m) => m.prev < 0).sort((x, y) => x.t - y.t);
    moves.forEach((m) => { let r = m; while (r.prev >= 0) r = moves[r.prev]; m.spot = roots.indexOf(r) + 1; });
    return {moves, fin, after, a0, nSpots: roots.length, dSt: a0.starts - b0.starts, dPts: a0.pts - b0.pts, dG: a0.games - b0.games,
      obj: total(fin) - base - COST * moves.length};
  };
  const fromSol = (sol) => {
    const moves = [];
    sol.spots.forEach((sp) => sp.seq.forEach((x, k) => moves.push({t: x.t, f: x.m, o: k ? null : sp.o, pf: k ? sp.seq[k - 1].m.id : null})));
    moves.sort((x, y) => x.t - y.t);
    moves.forEach((mv) => {
      mv.h = sol.fin.find((m) => m.id === mv.f.id && !m.orig);
      mv.prev = mv.pf == null ? -1 : moves.findIndex((m) => m.f.id === mv.pf);
    });
    return finish(sol.fin, moves);
  };
  // ---- STEP 1: strategies, told by days and games only (owner, 2026-11-13). Owner 11-14: "I'll almost
  // always use 3-4 adds, maybe 5+ in a long week" -> one card per number of adds from 3 up to all you
  // have left (fewer only when fewer are left), each the most starts that many adds can buy (any add
  // worth 0.05+ expected starts is taken), plus the same number of adds on other days
  const CP = [caps[0], caps[1] || 0], SC = 0.05;
  const bestFor = (A, cm) => {
    let sol = solve(0, pool, CP, A, SC, cm);
    for (let k = 1; k <= SP.n; k++) { const s2 = solve(k, pool, CP, A, SC, cm); if (s2.obj > sol.obj + 1e-9) sol = s2; }
    return Object.assign(fromSol(sol), {A});
  };
  const shape = (Q) => Q.moves.map((m) => m.starts.map(Number).join("") + ":" + m.prev).join("|");
  const list = [], seen = new Set();
  let stuck = null;                                   // more adds than this gain nothing with these drops
  const push = (Q, extra) => {
    if (!Q.moves.length || (Q.dSt <= 0 && Q.dPts <= 0)) return false;
    const k = shape(Q);
    if (seen.has(k)) return false;
    seen.add(k); Q.sig = k; Object.assign(Q, extra || {}); list.push(Q);
    return true;
  };
  if (canMove.some(Boolean) && addsLeft > 0) {
    let prevN = 0, prevSt = -1;
    for (let A = addsLeft >= 3 ? 3 : 1; A <= addsLeft; A++) {
      const Q = bestFor(A, canMove);
      if (Q.moves.length <= prevN) { stuck = stuck || {A, used: prevN}; break; }
      if (prevSt >= 0 && Q.dSt <= prevSt && !stuck) stuck = {A, used: prevN, pts: true};   // the extra add only buys points
      prevN = Q.moves.length; prevSt = Q.dSt;
      push(Q);
    }
    // other days: the plan with the most adds, with one of its move days ruled out
    const big = list[list.length - 1];
    if (big) {
      const alts = [...new Set(big.moves.map((m) => m.t))].map((t) => { const cm = canMove.slice(); cm[t] = false; return bestFor(big.moves.length, cm); })
        .sort((x, y) => y.obj - x.obj);
      let n = 0;
      for (const Q of alts) { if (n >= 2) break; if (push(Q, {alt: true})) n++; }
    }
  }
  const top = list.reduce((a, Q) => (!a || Q.obj > a.obj ? Q : a), null);
  if (top) top.best = true;
  // ---- STEP 2: the players for a chosen strategy's moves
  // every free agent who could hold that move's spot for the same days, the rest
  // of the plan as it stands, ranked by the plan's total (games or points)
  // owner 11-14: top 3 (plus your own pick if it isn't one), or the best on one NBA team (team = tricode)
  const options = (Q, k, team) => {
    const mv = Q.moves[k], h = mv.h, inPlan = new Set(Q.fin.filter((m) => m !== h).map((m) => m.id)), tot0 = total(Q.fin);
    const sc = (team ? all.filter((c) => c.p.tm === team) : pool.concat(pool.some((c) => c.id === mv.f.id) ? [] : [byId.get(mv.f.id)].filter(Boolean)))
      .filter((c) => !inPlan.has(c.id) && c.w.slice(h.from, h.to).some((v) => v > 0))
      .map((c) => { const nh = Object.assign({}, c, {from: h.from, to: h.to}); const ms = Q.fin.map((m) => (m === h ? nh : m)); return {c, ms, v: total(ms) - tot0}; })
      .sort((x, y) => y.v - x.v);
    const top = sc.slice(0, 3);
    if (!team) { const me = sc.find((x) => x.c.id === mv.f.id); if (me && !top.includes(me)) top.push(me); }
    return top
      .map((x) => { const L2 = lineup(x.ms), t = tally(L2);
        const st = days.map((_, i) => i >= h.from && i < h.to && L2[i].ids.has(x.c.id));
        return {c: x.c, st, n: st.filter(Boolean).length, pts: days.reduce((a, _, i) => a + (st[i] ? x.c.dv[i].val : 0), 0),
          dSt: t.starts - Q.a0.starts, dPts: t.pts - Q.a0.pts, dG: t.games - Q.a0.games}; });
  };
  // NBA teams whose schedule fits a move: they play on every night the pickup starts, and have a free agent who'd
  // start for you then (best first: more of the move's nights covered, then the best free agent's value)
  const teamsFor = (Q, k) => {
    const mv = Q.moves[k], h = mv.h, need = days.map((_, i) => i).filter((i) => mv.starts[i]);
    const inPlan = new Set(Q.fin.map((m) => m.id)), by = {};
    all.forEach((c) => {
      if (inPlan.has(c.id) || !need.every((i) => c.dv[i].avail)) return;
      const v = c.w.slice(h.from, h.to).reduce((a, x) => a + x, 0);
      const t = (by[c.p.tm] = by[c.p.tm] || {tm: c.p.tm, n: 0, best: null, v: -1, g: c.dv.slice(h.from, h.to).filter((x) => x.avail).length});
      t.n++; if (v > t.v) { t.v = v; t.best = c; }
    });
    return Object.values(by).sort((x, y) => y.g - x.g || y.v - x.v).slice(0, 8);
  };
  // a strategy with your own picks swapped in (ch: move index -> player id)
  const choose = (Q, ch) => {
    if (!ch || !Object.keys(ch).length) return Q;
    let fin = Q.fin.slice();
    const moves = Q.moves.map((m) => Object.assign({}, m));
    moves.forEach((mv, k) => {
      const c = byId.get(ch[k]);
      if (!c || c.id === mv.f.id || fin.some((m) => m.id === c.id)) return;
      const nh = Object.assign({}, c, {from: mv.h.from, to: mv.h.to});
      fin = fin.map((m) => (m === mv.h ? nh : m));
      mv.h = nh; mv.f = c;
    });
    return Object.assign(finish(fin, moves), {sig: Q.sig, best: Q.best, alt: Q.alt, A: Q.A});
  };
  return {days, PER, PERS, per, caps, canMove, stuck, addsLeft, used, free, pool, cands, pick, slots: SLOTS.length, mem, SLOTS, before, b0, strats: list, options, choose, teamsFor};
}
const ESPN_AB = Object.fromEntries(Object.entries(ETRI).map(([k, v]) => [v, k.toLowerCase()]));
const headshot = (id, cls = "sp-hs") => `<img class="${cls}" src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=96&h=70&scale=crop" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
const teamLogo = (tm) => `<img class="sp-logo" src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/${ESPN_AB[tm] || String(tm).toLowerCase()}.png&h=40&w=40" alt="" loading="lazy" onerror="this.style.display='none'">`;
const SP_HUES = ["var(--accent)", "var(--good)", "var(--gold)", "var(--org)", "var(--warn)", "var(--red)"];
function renderPlanner() {
  const box = $("sp-out");
  if (!box) return;
  // Lock-In: the planner's controls don't apply; show only why
  const li = L.mode === "lockin";
  document.querySelectorAll("#sp-box > .controls, #sp-lock").forEach((el) => { el.hidden = li; });
  const lg = LGRES[L.id];
  if (lg && !lg._spRet) { lg._spRet = 1; loadReturns(lg).then(() => { SP.key = null; renderPlanner(); }); }
  const locked = dayLocked(todayET());
  const key = JSON.stringify([L.id, myTeam(), SP.n, SP.wk, [...SP.noMove].sort(), spSaved(), DATA_V, lg ? lg.at : 0, locked, Object.keys(OFF.players || {}).length]);
  document.querySelectorAll("#sp-n .chip").forEach((c) => c.setAttribute("aria-pressed", String(+c.dataset.n === SP.n)));
  const lockNote = $("sp-lock");
  if (lockNote && SP.wk === "next") lockNote.innerHTML = (lg ? `Next matchup, from your roster as of ${new Date(lg.at).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"})}; injuries and matchups as they look today.` : "");
  else if (lockNote) {
    const t = tipClock(todayET());
    lockNote.innerHTML = (locked ? `<b>Today&rsquo;s pickups are closed</b> — the first game tipped off${t ? " at " + esc(t) : ""}, so the plan starts tomorrow. `
      : t ? `Today&rsquo;s pickups close at the first tip-off, <b>${esc(t)}</b>; after that the plan moves to tomorrow. ` : "") +
      (lg ? `Rosters${lg.next ? " (incl. adds and drops made after tip-off)" : ""} and adds used as of ${new Date(lg.at).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"})} — press <b>Refresh</b> after you make a move.` : "");
  }
  if (key !== SP.key) {
    SP.key = key; SP.plan = planStream();
    if (!SP.plan.err && !SP.plan.strats.some((Q) => Q.sig === SP.sel)) { SP.sel = null; SP.choice = {}; }
  }
  const P = SP.plan;
  const md0 = $("sp-mdays");
  if (P.err) { box.innerHTML = `<p class="note">${esc(P.err)}</p>`; $("sp-sum").textContent = ""; if (md0) md0.innerHTML = ""; return; }
  const nd = P.days.length;
  // the days you can make a move: tap to rule one out (today drops off after the first tip-off)
  if (md0) md0.innerHTML = P.days.map((d, i) => {
    const capOut = P.caps[P.per[i]] <= 0, on = !SP.noMove.has(d) && !capOut;
    return (i && P.per[i] !== P.per[i - 1] ? '<span class="wv-wk">next week</span>' : "") +
      `<button class="chip dchip${capOut ? " shut" : ""}" data-md="${d}" aria-pressed="${on}"${capOut ? " disabled" : ""} title="${esc(capOut ? "No adds left in this matchup" : on ? niceDay(d) + ": the planner may add or drop this day. Tap to rule it out" : niceDay(d) + ": ruled out. Tap to allow moves this day")}">` +
      `<b>${d === todayET() ? "Today" : new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short"})}</b><small>${d.slice(5).replace("-", "/")}</small></button>`;
  }).join("");
  const dn = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short"});
  const md = (d) => d.slice(5).replace("-", "/");
  const last = (n) => String(n).split(" ").slice(1).join(" ") || n;
  const gameDay = (i) => nbaGamesOn(P.days[i]) > 0;
  const top = P.strats.find((Q) => Q.best);
  $("sp-sum").textContent = (SP.wk === "next" ? "next matchup" : SP.wk === "both" && P.PERS.length > 1 ? "this matchup + next" : "rest of this matchup") + (top ? ` · best: ${sg(top.dSt, 0)} starts, ${sg(top.dPts, 0)} pts` : " · no move worth making");
  // the whole matchup week stays on screen: days already played (or locked) are greyed
  const past = [], tdy = todayET();
  for (let d = P.PER.start; d < P.days[0]; d = addDays(d, 1)) past.push(d);
  const np = past.length;
  const pastLbl = (d) => (d === tdy ? (dayLocked(tdy) ? "locked" : "skipped") : "done");
  const dropOf = (Q, mv) => (mv.prev >= 0 ? Q.moves[mv.prev].h : mv.o);
  const two = P.PERS.length > 1;                    // two weeks on screen: day names repeat, so add the date
  const dnd = (d) => (two ? dn(d) + " " + +d.slice(8) : dn(d));
  const dayList = (mv) => P.days.filter((_, i) => mv.starts[i]).map(dnd);
  // ---- your nights: open starter slots and NBA games, the raw material of a plan
  const nights = `<div class="sp-nights" style="--nd:${np + nd}">` +
    past.map((d) => `<div class="sp-nt past"><b>${dn(d)}</b><span>${md(d)}</span><em>${pastLbl(d)}</em></div>`).join("") +
    P.days.map((d, i) => {
      const open = P.slots - P.before[i].starts, g = nbaGamesOn(d);
      return `<button type="button" class="sp-nt${g ? "" : " dim"}${open > 0 && g ? " open" : ""}${i && P.per[i] !== P.per[i - 1] ? " wk2" : ""}" data-night="${d}" title="${esc(`${niceDay(d)}: ${g} NBA game${g === 1 ? "" : "s"}; ${P.before[i].starts} of your ${P.slots} starter slots filled, ${open} open.\nClick to list free agents who play this night`)}">` +
        `<b>${dn(d)}</b><span>${md(d)}</span><em>${g ? (open > 0 ? `${open} open` : "full") : "no games"}</em><small>${g} games</small></button>`;
    }).join("") + "</div>";
  // ---- STEP 1: strategy cards, days and games only
  // one row per roster spot: who holds it which nights (dot = start, ring = plays with no slot, outlined = move day)
  const hue = (n) => SP_HUES[(n - 1) % SP_HUES.length];
  const strip = (Q) => `<span class="sp-strip" style="--nd:${nd}">` +
    P.days.map((d, i) => `<i class="h${i && P.per[i] !== P.per[i - 1] ? " wk2" : ""}">${dn(d).slice(0, 2)}</i>`).join("") +
    Array.from({length: Q.nSpots}, (_, s0) => P.days.map((_, i) => {
      const mv = Q.moves.find((m) => m.spot === s0 + 1 && i >= m.h.from && i < m.h.to);
      if (!mv) return "<i></i>";
      const c = mv.starts[i] ? "st" : mv.h.dv[i].avail ? "bn" : "no";
      return `<i class="${c}${i === mv.t ? " ad" : ""}" style="--c:${hue(s0 + 1)}"></i>`;
    }).join("")).join("") + "</span>";
  const spotLines = (Q) => Array.from({length: Q.nSpots}, (_, s0) => {
    const ch = Q.moves.filter((m) => m.spot === s0 + 1).sort((x, y) => x.t - y.t), o = ch[0].o;
    return `<span class="sp-sl"><i style="--c:${hue(s0 + 1)}"></i><b>Spot ${s0 + 1}</b><em>${o ? "replaces " + esc(last(o.n)) : "an open roster spot"}</em></span>` +
      '<span class="sp-ch">' + ch.map((mv, j) => { const ds = dayList(mv);
        return `<span><b>${dnd(P.days[mv.t])}</b> ${j ? "swap" : "add"} · ${ds.length} start${ds.length === 1 ? "" : "s"}${ds.length ? ` <small>(${ds.join(" ")})</small>` : ""}</span>`; }).join("") + "</span>";
  }).join("");
  const card = (Q) => {
    const on = Q.sig === SP.sel, n = Q.moves.length;
    const all = n >= P.addsLeft;
    return `<button type="button" class="sp-opt sp-st${on ? " on" : ""}" data-st="${esc(Q.sig)}" aria-pressed="${on}">` +
      `<span class="sp-ol">${n} add${n > 1 ? "s" : ""} · ${Q.nSpots} spot${Q.nSpots > 1 ? "s" : ""}${Q.best ? ' <span class="sp-tag">best</span>' : ""}` +
      (all ? ' <span class="sp-tag mx" title="Uses every add you have left">every add</span>' : "") +
      (Q.alt ? ` <span class="sp-tag mx" title="The same number of adds, with one of the best plan&rsquo;s move days ruled out">other days</span>` : "") + "</span>" +
      `<span class="sp-ov"><b class="${Q.dSt > 0 ? "pos-up" : ""}">${sg(Q.dSt, 0)}</b> starts · <b class="${Q.dPts > 0 ? "pos-up" : ""}">${sg(Q.dPts, 0)}</b> pts</span>` +
      strip(Q) + spotLines(Q) + "</button>";
  };
  const stuckNote = P.stuck ? `<p class="note sp-stuck">A ${ordinal(P.stuck.A)} add ${P.stuck.pts ? "gains no extra start (points only)" : "gains nothing"} with ${SP.n} spot${SP.n === 1 ? "" : "s"} to stream` +
    (SP.n < 3 ? `: each extra player you allow to go opens another roster spot to stream through (<b>Spots to stream</b> above).` : ".") + "</p>" : "";
  const step1 = '<h3 class="sp-step"><span>1</span> Pick a strategy <em>— which days to add, by games alone</em></h3>' + nights +
    (P.strats.length ? `<div class="sp-opts">${P.strats.map(card).join("")}</div>` + stuckNote
      : `<p class="msg info">No pickup adds a start with ${SP.n ? "these drops" : "no drops"}${!P.addsLeft ? (P.PERS.length > 1 ? " (no adds left in either matchup)" : " (no adds left this matchup)") : !P.canMove.some(Boolean) ? " (no day left to make a move)" : ""}.</p>`);
  // ---- STEP 2: players for the chosen strategy
  let step2 = "";
  const S0 = P.strats.find((Q) => Q.sig === SP.sel);
  if (S0) {
    const Q = P.choose(S0, SP.choice);
    const kpi = (lbl, from, to, d, note) => `<div class="sp-kpi"><span>${lbl}</span><b>${from}${to != null ? ` <i>→</i> ${to}` : ""}</b>` +
      `<em class="${d > 0 ? "pos-up" : d < 0 ? "pos-dn" : "dim"}">${note}</em></div>`;
    const kpis = '<div class="sp-kpis">' +
      kpi("Starts left", P.b0.starts, Q.a0.starts, Q.dSt, Q.dSt ? sg(Q.dSt, 0) + " starts" : "no change") +
      kpi("Points", fx(P.b0.pts, 0), fx(Q.a0.pts, 0), Q.dPts, Q.dPts ? sg(Q.dPts, 0) + " pts" : "no change") +
      kpi("Adds", `${Q.moves.length}`, null, 0, P.caps.length > 1 ? `of ${P.caps[0]} left this week + ${P.caps[1]} next` : `of ${P.addsLeft} left`) + "</div>";
    // timeline: each roster spot that changes hands, day by day
    const rows = [];
    Q.moves.filter((m) => m.prev < 0).forEach((m0) => {
      const chain = [m0];
      for (let nx; (nx = Q.moves.find((m) => m.prev >= 0 && Q.moves[m.prev] === chain[chain.length - 1]));) chain.push(nx);
      rows.push({o: m0.o, t0: m0.t, chain});
    });
    const marks = (m, from, to, starts) => `<span class="sp-mk" style="grid-template-columns:repeat(${to - from},1fr)">` +
      Array.from({length: to - from}, (_, k) => { const i = from + k, x = m.dv[i];
        return !x.avail ? '<i class="no"></i>' : starts(i) ? `<i class="st" title="${esc(dn(P.days[i]) + ": starts — " + fx(x.val, 0) + " pts projected")}"></i>`
          : `<i class="bn" title="${esc(dn(P.days[i]) + ": plays, but no open slot")}"></i>`; }).join("") + "</span>";
    const tl = `<div class="sp-tl" style="--nd:${np + nd}">` +
      '<div class="sp-tlh"></div>' + past.map((d) => `<div class="sp-tlh past">${dn(d)}<span>${md(d)}</span><em>${pastLbl(d)}</em></div>`).join("") +
      P.days.map((d, i) => `<div class="sp-tlh${gameDay(i) ? "" : " dim"}${i && P.per[i] !== P.per[i - 1] ? " wk2" : ""}">${dn(d)}<span>${md(d)}</span>${i && P.per[i] !== P.per[i - 1] ? "<em>next wk</em>" : ""}</div>`).join("") +
      rows.sort((x, y) => x.chain[0].spot - y.chain[0].spot).map((r) => `<div class="sp-tll" title="${esc(r.o ? "Roster spot now held by " + r.o.n : "An open roster spot")}">Spot ${r.chain[0].spot}<small>${r.o ? esc(last(r.o.n)) : "open"}</small></div>` +
        (np ? `<div class="sp-seg past" style="grid-column:2/${2 + np}"></div>` : "") +
        (r.o && r.t0 > 0 ? `<div class="sp-seg keep" style="grid-column:${2 + np}/${2 + np + r.t0}">${headshot(r.o.id, "sp-av")}<span class="sp-sn">${esc(last(r.o.n))}</span>` +
          marks(r.o, 0, r.t0, (i) => Q.after[i].ids.has(r.o.id)) + "</div>" : "") +
        (!r.o && r.t0 > 0 ? `<div class="sp-seg empty" style="grid-column:${2 + np}/${2 + np + r.t0}"></div>` : "") +
        r.chain.map((m) => { const h = m.h, c = hue(m.spot);
          return `<div class="sp-seg add" style="grid-column:${2 + np + h.from}/${2 + np + h.to};--c:${c}" title="${esc(m.f.n + " · " + m.f.p.tm)}">${headshot(m.f.id, "sp-av")}` +
            `<span class="sp-sn">${esc(last(m.f.n))}</span>` + marks(h, h.from, h.to, (i) => m.starts[i]) + "</div>"; }).join("")).join("") +
      '<div class="sp-tll" title="Starter slots filled each night">Slots</div>' + past.map((d) => `<div class="sp-pc past">${pastLbl(d)}</div>`).join("") + P.days.map((d, i) => {
        if (!gameDay(i)) return '<div class="sp-pc dim">no games</div>';
        const b = P.before[i].starts, a = Q.after[i].starts;
        const pips = Array.from({length: P.slots}, (_, k) => `<i class="${k < Math.min(a, b) ? "f" : k < a ? "n" : k < b ? "l" : ""}"></i>`).join("");
        return `<div class="sp-pc" title="${esc(`${dn(d)}: ${b} of ${P.slots} starter slots filled now, ${a} with this plan`)}"><span class="sp-pips">${pips}</span>` +
          `<span class="sp-pn">${a !== b ? `${b}<i>→</i><b class="${a > b ? "pos-up" : "pos-dn"}">${a}</b>` : `${a}`}<small>/${P.slots}</small></span></div>`;
      }).join("") + "</div>";
    // one card per move: the free agents who fit those days; click one to use him
    // teams that also fit this move; click one to list its free agents for the same days
    const teamRow = (mv, k, row) => {
      const ts = P.teamsFor(Q, k), sel = (SP.team || {})[k], ds = dayList(mv);
      if (!ts.length) return "";
      const chips = ts.map((t) => `<button type="button" class="sp-tmc" data-tmv="${k}" data-tm="${t.tm}" aria-pressed="${sel === t.tm}" title="${esc(`${TEAM_NAMES[t.tm] || t.tm}: plays ${ds.join(", ")}` +
        `${t.g > ds.length ? ` (${t.g} games in this window)` : ""}; ${t.n} free agent${t.n === 1 ? "" : "s"} who'd start then, best ${t.best.n}`)}">${teamLogo(t.tm)}<b>${t.tm}</b><small>${t.n}</small></button>`).join("");
      const list = sel ? P.options(Q, k, sel) : [];
      return `<div class="sp-tms"><span class="lbl" title="NBA teams that play every night this pickup starts (${esc(ds.join(", "))}); the number is how many of their free agents would start for you then">Also fits</span>${chips}</div>` +
        (sel ? `<div class="sp-pks sp-tmpk">${list.length ? list.map(row).join("") : '<p class="note">No free agent on this team fits.</p>'}</div>` : "");
    };
    const pickCard = (mv, k) => {
      const h = mv.h, o = dropOf(Q, mv), opts = P.options(Q, k);
      const lost = mv.prev < 0 && o && o.orig ? P.days.map((d, i) => (i >= mv.t && o.dv[i].avail && P.before[i].ids.has(o.id) ? dn(d) : null)).filter(Boolean) : [];
      const pos = Q.moves.filter((m) => m.spot === mv.spot && m.t <= mv.t).length, nIn = Q.moves.filter((m) => m.spot === mv.spot).length;
      const out = o == null ? '<span class="dim">goes into an open roster spot</span>'
        : `${mv.prev >= 0 ? `replaces your ${dnd(P.days[Q.moves[mv.prev].t])} pickup` : "drop"} ${headshot(o.id, "sp-av sm")}<span class="name" data-id="${o.id}">${esc(o.n)}</span>` +
          (lost.length ? ` <span class="dim" title="Starts he gives up">−${lost.join(", ")}</span>` : "");
      const best0 = opts.length ? opts[0] : null;
      const row = (x) => {
        const on = x.c.id === mv.f.id;
        const gs = P.days.map((d, i) => (i >= h.from && i < h.to && x.c.dv[i].g ? `<span class="sp-g${x.st[i] ? " st" : ""}">${dn(d)} ${x.c.dv[i].g[2] ? "vs" : "@"} ${esc(x.c.dv[i].g[1])}</span>` : "")).join("");
        const risk = best0 && x.n === best0.n && x.dG < best0.dG - 0.02;
        const d = !best0 || x === best0 ? "" : x.dSt - best0.dSt ? `${sg(x.dSt - best0.dSt, 0)} st` : Math.abs(x.dPts - best0.dPts) < 0.5 ? (risk ? "rest risk" : "even") : `${sg(x.dPts - best0.dPts, 0)} pts${risk ? " · rest risk" : ""}`;
        return `<button type="button" class="sp-pk${on ? " on" : ""}" data-mv="${k}" data-pk="${x.c.id}" aria-pressed="${on}" title="${esc(`${x.c.n} (${x.c.p.tm}): ${x.n} start${x.n === 1 ? "" : "s"}, ${fx(x.pts, 0)} pts in this plan` + (risk ? "\nSame starts, but he may rest a back-to-back night" : ""))}">` +
          `${headshot(x.c.id, "sp-av")}<span class="sp-pw"><span class="sp-pn2">${esc(x.c.n)} ${tags(x.c.p)}</span><span class="sp-tm">${teamLogo(x.c.p.tm)}${esc(x.c.p.tm)} · ${esc(x.c.p.pos || "")}</span><span class="sp-gs">${gs}</span></span>` +
          `<span class="sp-pv"><b>${x.n}</b><span>start${x.n === 1 ? "" : "s"}</span><em>${fx(x.pts, 0)} pts</em>${d ? `<i class="${/^-|−/.test(d) || d.includes("risk") ? "pos-dn" : "dim"}">${d}</i>` : (on ? "" : "")}</span></button>`;
      };
      return `<div class="sp-mv" style="--c:${hue(mv.spot)}"><div class="sp-when"><b>${dn(P.days[mv.t])}</b><span>${md(P.days[mv.t])}</span></div>` +
        `<div class="sp-body"><div class="sp-spot"><b>Spot ${mv.spot}</b> · pickup ${pos} of ${nIn}</div>` +
        `<div class="sp-need">${mv.prev >= 0 ? "Swap in" : "Add"} someone who plays <b>${esc(dayList(mv).join(", ") || "—")}</b></div>` +
        `<div class="sp-out">${out}</div><div class="sp-pks">${opts.map(row).join("")}</div>` + teamRow(mv, k, row) + "</div></div>";
    };
    step2 = '<h3 class="sp-step"><span>2</span> Pick the players <em>— best first; click another to use him instead</em></h3>' + kpis + tl +
      '<div class="sp-legend"><span><i class="sp-k st"></i> starts</span><span><i class="sp-k bn"></i> plays, no slot</span>' +
      '<span><i class="sp-k n"></i> slot filled by the plan</span><span><i class="sp-k f"></i> already filled</span></div>' +
      `<div class="sp-moves">${Q.moves.map((mv, k) => [mv, k]).sort((x, y) => x[0].spot - y[0].spot || x[0].t - y[0].t).map(([mv, k]) => pickCard(mv, k)).join("")}</div>` +
      (Object.keys(SP.choice || {}).length ? '<p class="note"><button type="button" class="linkbtn" data-spclr>Back to the best players</button></p>' : "");
  } else if (P.strats.length) {
    step2 = '<p class="note sp-hint">Pick a strategy above to see who to add.</p>';
  }
  // who can be dropped: a clear button above the strategies (it's an input to them)
  const tickedNames = P.cands.filter((c) => P.pick.has(c.r.id)).map((c) => surname(c.r.n));
  const dropbox = `<details class="sp-dropbox"${SP.dropOpen ? " open" : ""}><summary class="sp-dsum">` +
    `<span class="sp-dl">Who can be dropped</span><span class="sp-dv">${tickedNames.length ? esc(tickedNames.join(", ")) : "nobody ticked"}</span>` +
    `<span class="sp-dc">${spSaved() ? "your choice" : "default"} · change</span></summary>` +
    '<div class="sp-drops">' + P.cands.map((c) => `<label class="sp-dp${P.pick.has(c.r.id) ? " on" : ""}"><input type="checkbox" data-spd="${c.r.id}"${P.pick.has(c.r.id) ? " checked" : ""}>` +
      `<span class="sp-dn" title="${esc(c.r.n)}">${esc(c.r.n)}</span><span class="sp-dt" title="rest-of-season points">${fx(c.tot, 0)} pts</span></label>`).join("") + "</div>" +
    `<p class="note">Default: your ${SP.n} lowest by rest-of-season points, keep list excluded. Tick more to let the planner choose. ` +
    `Your ticks are remembered in this browser.${spSaved() ? ' <button type="button" class="linkbtn" data-sprst>Back to the default</button>' : ""}</p></details>`;
  box.innerHTML = dropbox + step1 + step2;
}
function bindPlanner() {
  const chips = (id, attr, fn) => document.querySelectorAll(`#${id} .chip`).forEach((c) => c.addEventListener("click", () => {
    fn(c.dataset[attr]);
    document.querySelectorAll(`#${id} .chip`).forEach((x) => x.setAttribute("aria-pressed", String(x === c)));
    renderPlanner();
  }));
  chips("sp-n", "n", (v) => { SP.n = +v; lsSet("fnba.v2.spn", SP.n); });
  $("sp-mdays").addEventListener("click", (e) => {
    const c = e.target.closest("[data-md]");
    if (!c || c.disabled) return;
    const d = c.dataset.md;
    if (SP.noMove.has(d)) SP.noMove.delete(d); else SP.noMove.add(d);
    renderPlanner();
  });
  chips("sp-wk", "w", (v) => { SP.wk = v; SP.sel = null; SP.choice = {}; });
  $("sp-out").addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-spd]");
    if (!cb) return;
    const s = new Set([...SP.plan.pick]);
    if (cb.checked) s.add(+cb.dataset.spd); else s.delete(+cb.dataset.spd);
    lsSet(spPickKey(), [...s]);
    SP.dropOpen = true;
    renderPlanner();
  });
  $("sp-out").addEventListener("toggle", (e) => {
    if (e.target.classList && e.target.classList.contains("sp-dropbox")) SP.dropOpen = e.target.open;
  }, true);
  $("sp-out").addEventListener("click", (e) => {
    if (e.target.closest("[data-sprst]")) { lsSet(spPickKey(), null); SP.dropOpen = true; renderPlanner(); return; }
    const st = e.target.closest("[data-st]");
    if (st) { SP.sel = SP.sel === st.dataset.st ? null : st.dataset.st; SP.choice = {}; SP.team = {}; renderPlanner(); return; }
    const tmc = e.target.closest("[data-tm]");
    if (tmc) { const k = tmc.dataset.tmv; SP.team = Object.assign({}, SP.team); SP.team[k] = SP.team[k] === tmc.dataset.tm ? null : tmc.dataset.tm; renderPlanner(); return; }
    const pk = e.target.closest("[data-pk]");
    if (pk && !e.target.closest(".name[data-id]")) { SP.choice = Object.assign({}, SP.choice, {[pk.dataset.mv]: +pk.dataset.pk}); renderPlanner(); return; }
    if (e.target.closest("[data-spclr]")) { SP.choice = {}; SP.team = {}; renderPlanner(); return; }
    const nt = e.target.closest("[data-night]");
    if (nt) { WV.days = [nt.dataset.night]; WV.match = "all"; renderWaivers("list"); const t = $("wv-days"); if (t) t.scrollIntoView({behavior: "smooth", block: "start"}); return; }
    const n = e.target.closest(".name[data-id]");
    if (n && BYID[+n.dataset.id]) openPlayer(+n.dataset.id);
  });
}

// ============================================================== IN-SEASON
const IS = {view: "buy", team: "", sort: null, dir: -1};
const DROP_MARGIN = 0.08;   // a swap must gain 8%+ of the player's ROS points to be called
// per-player season view under the ACTIVE league: now, luck-adjusted, ROS
function seasonLine(p) {
  const now = p.td && p.gp ? fpg(p.td, p.tbp || [0, 0, 0]) : null;
  const adj = p.adj ? fpg(p.adj, p.abp) : null;
  const ros = fpg(p.s, p.bp);
  const pre = p.ps ? fpg(p.ps, p.pbp) : null;
  const left = gamesLeftFor(p);              // an absentee's games start at his return
  const bi = boostInfo(p);
  return {p, now, adj, ros, pre, gp: p.gp || 0, gap: now != null && adj != null ? adj - now : null,
    gl: (p.av || 0) * left, tot: ros * (p.av || 0) * left + (bi ? bi.tot : 0), boost: bi};
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
    fpgRow(r) - fpg(r[C.adj], r[C.abp]));
}
const keepSet = () => new Set((L.keep || []).map(normName));
function renderInseason() {
  renderBoostPanel("is-boosts");
  const lg = LGRES[L.id], mt = myTeam();
  const body = $("is-body");
  $("is-keepbox").hidden = IS.view !== "drop";
  $("is-teamctl").hidden = IS.view !== "buy" || !lg;
  if (!lg) {
    $("is-lede").innerHTML = "";
    body.innerHTML = L.platform === "espn" && /^\d+$/.test(L.id || "")
      ? '<p class="note">Loading your league&rsquo;s rosters from ESPN&hellip;</p>'
      : rosterMsg("In-season analysis");
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
    `<td class="l dim why">${esc(luckWhy(r.p, -sign))}</td>` +
    `<td class="grp">${fx(r.ros)}</td><td class="pos-up" title="${r.boost ? esc(boostTip(r.boost)) : ""}">${r.boost ? "+" + r.boost.fpg.toFixed(1) + " thru " + r.boost.thru.slice(5) : ""}</td><td>${fx(r.pre)}</td><td class="${r.pre != null && r.now != null ? cut(r.now - r.pre) : ""}">${r.pre != null && r.now != null ? sg(r.now - r.pre) : "-"}</td>` +
    `<td class="dim">${r.p.pre_rank ?? "-"}</td><td>${spark(lucks(r.p.id), 80, 24)}</td>`;
  const luckHead = (sign) =>
    H("gp", "GP") + H("now", "Now FP/G", "grp", "Actual FP/G this season") +
    H("adj", "Luck-adj", "", "FP/G with luck removed: his own per-minute rates at the minutes he played, plus his real shot attempts and assists (the parts that carry into future games)") +
    H("gap", sign > 0 ? "Buy-low gap" : "Luck/G", "big", sign > 0 ? "Luck-adjusted minus actual FP/G: how far the box score is running BELOW his real level" : "Actual minus luck-adjusted FP/G: how much of his box score is luck") +
    `<th class="l">${sign > 0 ? "Ran cold on" : "Ran hot on"}</th>` +
    H("ros", "ROS FP/G", "grp", "Our rest-of-season projection (the tested in-season blend)") +
    H("bfp", "Injury boost", "", "Extra FP/G while an injured teammate is out (see Injury boosts below), and roughly until when") +
    H("pre", "Draft-day FP/G", "", "What we projected before the season: roughly what his manager drafted him to be") +
    H("vsdraft", "Now vs draft", "", "Actual FP/G minus the draft-day projection. Early in the season managers judge players against draft cost") +
    H("pre_rank", "Pre #", "", "Preseason board rank") + "<th>Luck by game</th>";
  all.forEach((r) => { r.vsdraft = r.pre != null && r.now != null ? r.now - r.pre : null; r.bfp = r.boost ? r.boost.fpg : null; });
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
    const fa = all.filter((r) => lg.owner[r.p.id] == null && !outNow(r.p) && r.tot > 0)
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
          `<td class="grp">${fx(r.ros)}</td><td>${fx(r.gl, 0)}</td><td class="big"${r.boost ? ` title="${esc(boostTip(r.boost))}"` : ""}>${fx(r.tot, 0)}${r.boost ? `<br><span class="pos-up" style="font-size:.72rem;font-weight:500">incl. +${fx(r.boost.tot, 0)} boost</span>` : ""}</td>` +
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
        `<span class="sub">${esc(r.p.tm)}${lg.slot[r.p.id] === 13 ? " · IR" : ""}${outNow(r.p) ? " · out" : ""}</span>` +
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
const WK = {week: null, pair: null, mm: null, mmP: null};
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
const luKey = (wk, tid) => `fnba.v2.lineup.${L.key}.${wk}.${tid}`;
function lineupMarks(wk, tid) {
  try { return JSON.parse(localStorage.getItem(luKey(wk, tid)) || "{}") || {}; } catch (e) { return {}; }
}
function setLineup(wk, tid, pid, d, start) {
  const m = lineupMarks(wk, tid);
  (m[pid] = m[pid] || {})[d] = start ? 1 : 0;
  try { localStorage.setItem(luKey(wk, tid), JSON.stringify(m)); } catch (e) { /* storage blocked */ }
}
// Sleeper matchups -> ESPN mMatchupScore shape (+ each side's Sleeper entry in .sl)
function sleeperMatchups() {
  const today = todayET();
  const weeks = META.weeks.filter((w) => w[1] <= today).map((w) => w[0]);
  return Promise.all(weeks.map((w) => fetch(SLB + L.id + "/matchups/" + w, {cache: "no-store"}).then((r) => (r.ok ? r.json() : [])).catch(() => [])
    .then((arr) => {
      const by = {};
      (arr || []).forEach((e) => { if (e.matchup_id != null) (by[e.matchup_id] = by[e.matchup_id] || []).push(e); });
      return Object.values(by).filter((x) => x.length === 2).map(([a, h]) => ({matchupPeriodId: w,
        away: {teamId: a.roster_id, totalPoints: a.points || 0, totalPointsLive: a.points || 0, sl: a},
        home: {teamId: h.roster_id, totalPoints: h.points || 0, totalPointsLive: h.points || 0, sl: h}}));
    }))).then((x) => x.flat());
}
function loadMatchups(lg) {
  if (WK.mm) return Promise.resolve(WK.mm);
  if (L.platform === "sleeper") {
    if (!WK.mmP) WK.mmP = sleeperMatchups().then((x) => { WK.mm = x; return x; });
    return WK.mmP;
  }
  if (!WK.mmP) WK.mmP = fetch(espnBase() + L.id + "?view=mMatchupScore").then((r) => (r.ok ? r.json() : {schedule: []}))
    .catch(() => ({schedule: []})).then((j) => { WK.mm = j.schedule || []; return WK.mm; });
  return WK.mmP;
}
function loadReturns(lg) {
  const ids = Object.keys(lg.owner).map(Number).filter((id) =>
    (lg.slot[id] === 13 || OUT_SET.includes(lg.inj[id]) || longOut(BYID[id])) && !(id in lg.ret));
  if (!ids.length) return Promise.resolve();
  ids.forEach((id) => { lg.ret[id] = null; });
  const flt = JSON.stringify({players: {filterIds: {value: ids}, limit: ids.length + 5,
                                        sortPercOwned: {sortPriority: 1, sortAsc: false}}});
  return fetch(espnBase() + (L.platform === "espn" ? L.id : META.league.id) + "?view=kona_playercard", {headers: {"x-fantasy-filter": flt}})
    .then((r) => (r.ok ? r.json() : {players: []})).catch(() => ({players: []}))
    .then((k) => (k.players || []).forEach((w) => {
      const pl = w.player || {}, d = (pl.injuryDetails || {}).expectedReturnDate;
      if (pl.id != null && d && d.length === 3)
        lg.ret[pl.id] = `${d[0]}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}`;
    }));
}
// the tested matchup adjustment for one game (pace, FP allowed to his position,
// FG% allowed, home), in the active league's points via scale
function mAdj(p, g, scale) {
  const mf = g && META.mf[g[1]];
  if (!mf || !p) return {adj: 0, parts: null};
  const c = posCls(p.pos), b = META.mfb;
  const parts = {pace: b.pace * (mf.pace - 1) * scale, dvp: b.dvp * ((mf[c] || 1) - 1) * scale,
                 fgp: b.fgp * ((mf.fgp || 1) - 1) * scale, home: b.home * (g[2] ? 0.5 : -0.5) * scale,
                 f: {pace: mf.pace, dvp: mf[c] || 1, fgp: mf.fgp || 1, c, n: mf.n}};
  return {adj: parts.pace + parts.dvp + parts.fgp + parts.home, parts};
}
// a player's projected value on each of these days (the Waivers formula: ROS
// FP/G + injury boost, return ramp, matchup, back-to-back and game-day status
// odds). ok(d, statusPlayChance) says whether that game can count at all;
// own = the visitor forced him in (status odds then ignored)
function dayVals(p, days, own, ok) {
  const B = META.b2b;
  const fp = p ? fpg(p.s, p.bp) : 0;
  const fpd = p ? fpgUnder(META.league, p.s, p.bp) || fp : 1;
  const scale = fpd > 0 ? fp / fpd : 1;
  const sd = p ? (p.sd || 0) * scale : 0;
  const teamDays = new Set(p ? (META.sched[p.tm] || []).map((g) => g[0]) : []);
  const psit = p && p.b2b ? p.b2b[2] : B.base;
  const ramp = p ? rampFor(p) : () => 1;
  return days.map((d) => {
    const g = p ? (META.sched[p.tm] || []).find((x) => x[0] === d) : null;
    let val = 0, avail = false, play = 0;
    const sp = p ? statusPlay(p, d) : 1;
    if (g && ok(d, sp)) {
      const second = teamDays.has(addDays(d, -1));
      play = (second ? Math.max(0, 1 - Math.max(0, psit - B.other)) : 1) * (own ? 1 : sp);
      const {adj, parts} = mAdj(p, g, scale);
      const bst = boostFP(p, d), rf = ramp(d), v = (fp + bst) * rf + adj, sg2 = sd * rf;
      val = Math.max(0, play * v);
      avail = true;
      // when he plays: v +- sg2; else 0 -> mean val, variance of that mixture
      return {d, g, avail, val, play, sd2: sd * sd, st: false, base: fp, bst, rf, adj, parts, v, second, sp,
        ceil: play >= 0.5 ? v + META.ceiling.z * sg2 : val,
        var: Math.max(0, play * (sg2 * sg2 + v * v) - val * val)};
    }
    return {d, g, avail, val, play, sd2: sd * sd, st: false};
  });
}
// a team's week: per player, per day -> game?, plays?, value, started?
function teamWeek(lg, teamId, days, wk, SLOTS, today) {
  const marks = weekMarks(wk);
  // after today's first tip-off: today (and earlier days) = the roster locked at
  // tip-off, tomorrow on = the roster with the moves made since (lg.locked)
  const LK = lg.locked && lg.locked.day === today ? lg.locked : null;
  const onDay = (id, d) => (!LK || d > today ? lg.owner[id] === teamId : LK.owner[id] === teamId);
  const ids = new Set(Object.keys(lg.owner).map(Number).filter((id) => lg.owner[id] === teamId));
  if (LK) Object.keys(LK.owner).map(Number).forEach((id) => { if (LK.owner[id] === teamId) ids.add(id); });
  const ps = [...ids].map((id) => {
    const p = BYID[id];
    const inj = lg.inj[id];
    const hurt = (p ? espnOut(p, inj) : OUT_SET.includes(inj)) || lg.slot[id] === 13 || isAbsent(p);
    // same absence window as every other tab (your weeks > ESPN date > typical absence)
    const ret = p && isAbsent(p) ? absWindow(p).ret : lg.ret[id];
    // a Plays choice only counts when it differs from what the page would do
    // anyway (ticking him back on = no choice), so "set by you" means something
    const def = (!hurt || !!ret) && !benched(p);
    const own = id in marks && (!!marks[id] !== def || (!!marks[id] && (hurt || benched(p))));
    const plays = own ? !!marks[id] : def;
    const elig = (lg.elig[id] && lg.elig[id].length ? lg.elig[id] : eligFromPos(p && p.pos)).filter((s) => SLOTS.includes(s));
    const r = {id, n: p ? p.n : lg.name[id] || "#" + id, p, inj, ret, hurt, plays, manual: own, elig,
      days: dayVals(p, days, own, (d, sp) => onDay(id, d) && plays && !(hurt && !own && ret && d < ret) && !(outOn(p, d) && !own) && !(sp < 0.05 && !own)),
      starts: 0, games: 0, pts: 0, var: 0};
    if (LK) {
      r.dropped = LK.owner[id] === teamId && lg.owner[id] !== teamId;
      r.added = lg.owner[id] === teamId && LK.owner[id] !== teamId;
      r.days.forEach((x) => { if (!onDay(id, x.d)) { x.avail = false; x.off = true; } });
    }
    return r;
  });
  // the visitor's per-game lineup choices: 1 = start him, 0 = bench him
  const LU = lineupMarks(wk, teamId);
  const choice = (id, d) => (LU[id] && d in LU[id] ? LU[id][d] : null);
  // tonight, once his game has tipped off, ESPN's lineup is locked: started = start, bench = bench
  const locked = (id, d) => { const p = BYID[id], e = d === today && WL.day === today && p && wkGame(p, d) !== "pre" ? WL.ent[id] : null;
    return e ? (e.slot !== 12 && e.slot !== 13 ? 1 : 0) : null; };
  // tonight: a player ESPN shows on the court counts as playing whatever his injury tag said
  if (WL.day === today) ps.forEach((r) => { const i = days.indexOf(today); if (i < 0 || !r.p) return;
    const x = r.days[i], L2 = wkLiveLine(r.p, x, today);
    if (L2 && L2.played && x.g && !x.avail && !x.off) { const v = fpg(r.p.s, r.p.bp) || 0; Object.assign(x, {avail: true, val: v, v, play: 1, sd2: x.sd2 || 0, live: true}); } });
  const out = {ps, days: days.map((d, i) => ({d, past: d < today, open: 0, started: 0, playing: 0, pts: 0, over: 0}))};
  days.forEach((d, i) => {
    const playing = ps.filter((r) => r.days[i].avail);
    playing.forEach((r) => { r.games++; const lk = locked(r.id, d); r.days[i].lock = lk != null; r.days[i].pick = lk != null ? lk : choice(r.id, d); });
    const av = playing.filter((r) => r.days[i].pick !== 0);
    // forced starters outrank everyone, so they get a slot whenever one fits
    const Wm = av.map((r) => SLOTS.map((s) => (r.elig.includes(s)
      ? Math.max(r.days[i].val, 0.01) + (r.days[i].pick === 1 ? 1e5 : 0) : 0)));
    const res = assignMax(Wm);
    av.forEach((r, k) => {
      if (res.rc[k] >= 0) {
        r.days[i].st = true; r.starts++; r.days[i].slot = SLOTS[res.rc[k]];
        if (d >= today) {
          const L2 = d === today ? wkLiveLine(r.p, r.days[i], today) : null;
          r.pts += L2 ? L2.rest : r.days[i].val; r.var += r.days[i].sd2 * (L2 ? L2.left : 1);
        }
      } else if (r.days[i].pick === 1) r.days[i].noslot = true;
    });
    const D = out.days[i];
    D.playing = playing.length; D.started = res.rc.filter((c) => c >= 0).length; D.open = SLOTS.length - D.started;
    D.over = av.filter((r) => r.days[i].noslot).length;
    const used = new Set(res.rc.filter((c) => c >= 0));
    D.openSlots = SLOTS.filter((_, j) => !used.has(j)).map((sid) => ESPN_SLOT[sid]);
    D.pts = d >= today ? av.reduce((a, r, k) => { if (res.rc[k] < 0) return a;
      const L2 = d === today ? wkLiveLine(r.p, r.days[i], today) : null; return a + (L2 ? L2.rest : r.days[i].val); }, 0) : 0;
  });
  out.rem = ps.reduce((a, r) => a + r.pts, 0);
  out.var = ps.reduce((a, r) => a + r.var, 0);
  return out;
}
// ---- START-OF-WEEK PROJECTION ----------------------------------------------
// What each team was projected to score over the whole matchup on the morning it
// began: that day's ESPN roster (view=mRoster&scoringPeriodId = the week's first
// day), each player's in-season projection re-run on games BEFORE the week
// (rosAt), the week's schedule with the tested matchup and back-to-back
// adjustments, and the same exact best-lineup assignment as the live projection.
// Out = on the IR slot that day, or missed his team's last two games before the
// week (knowable then). Not included (not knowable after the fact): injury
// boosts, game-day statuses, return ramps. Matchup factors are today's.
// ESPN scoring period of a date (1 = opening night). Days before opening night
// are clamped to 1: period 0 is NOT the opening roster (it returned unrelated
// rosters for week 1, which starts the Monday before opening night).
const espnPeriod = (d) => {
  const first = Object.values(META.sched).reduce((m, gs) => (gs.length && gs[0][0] < m ? gs[0][0] : m), "9999");
  return Math.max(1, Math.round((Date.parse(d) - Date.parse(first)) / 864e5) + 1);
};
function weekRoster(lg, ws) {
  lg.wsr = lg.wsr || {};
  if (!(ws in lg.wsr)) {
    lg.wsr[ws] = fetch(espnBase() + L.id + "?view=mRoster&scoringPeriodId=" + espnPeriod(ws))
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => {
        if (!j || !(j.teams || []).length) return (lg.wsr[ws] = {fail: true});
        const R = {owner: {}, slot: {}, elig: {}};
        j.teams.forEach((t) => ((t.roster || {}).entries || []).forEach((e) => {
          R.owner[e.playerId] = t.id; R.slot[e.playerId] = e.lineupSlotId;
          R.elig[e.playerId] = ((e.playerPoolEntry || {}).player || {}).eligibleSlots || [];
        }));
        return (lg.wsr[ws] = R);
      });
  }
  return lg.wsr[ws];
}
// missed his team's last two games before T (team played, he did not)
function outAt(p, T) {
  const C = GAMES.C, mine = new Set((GAMES.byP[p.id] || []).map((r) => r[C.d]));
  const team = (META.sched[p.tm] || []).map((g) => g[0]).filter((d) => d < T);
  if (team.length < 2) return false;
  return team.slice(-2).every((d) => !mine.has(d));
}
const RA = {};                       // rosAt cache: id|date -> line
const rosAtC = (p, T) => (RA[p.id + "|" + T] = RA[p.id + "|" + T] || rosAt(p, T));
function startWeek(R, tid, days, ws, SLOTS, today) {
  const B = META.b2b;
  const rows = Object.keys(R.owner).map(Number).filter((id) => R.owner[id] === tid).map((id) => {
    const p = BYID[id];
    if (!p) return null;
    const at = rosAtC(p, ws), fp = at.fp;
    const fpd = fpgUnder(META.league, at.sl, at.bp) || fp, scale = fpd > 0 ? fp / fpd : 1;
    const out = R.slot[id] === 13 || outAt(p, ws);
    const teamDays = new Set((META.sched[p.tm] || []).map((g) => g[0]));
    const psit = p.b2b ? p.b2b[2] : B.base;
    const elig = (R.elig[id] && R.elig[id].length ? R.elig[id] : eligFromPos(p.pos)).filter((s) => SLOTS.includes(s));
    const vals = days.map((d) => {
      const g = (META.sched[p.tm] || []).find((x) => x[0] === d);
      if (!g || out) return 0;
      const play = teamDays.has(addDays(d, -1)) ? Math.max(0, 1 - Math.max(0, psit - B.other)) : 1;
      return Math.max(0, play * (fp + mAdj(p, g, scale).adj));
    });
    return {id, p, fp, out, elig, vals};
  }).filter(Boolean);
  let tot = 0, past = 0;
  days.forEach((d, i) => {
    const av = rows.filter((r) => r.vals[i] > 0);
    const res = assignMax(av.map((r) => SLOTS.map((s) => (r.elig.includes(s) ? r.vals[i] : 0))));
    const pts = av.reduce((a, r, k) => a + (res.rc[k] >= 0 ? r.vals[i] : 0), 0);
    tot += pts; if (d < today) past += pts;
  });
  return {tot, past, rem: tot - past, rows};
}
// a player's games this week so far vs what the start-of-week projection
// expected from each of those games (his projection then + that game's matchup)
// ---- My week, today (owner 11-14): once a player's game tips off his box locks like a played day
// (green dot = in ESPN's starting lineup, hollow = bench), and finished games count in "Scored vs
// expected" the same night. ESPN league feed for today's scoring period (each roster's actual lineup and
// points) + ESPN's NBA scoreboard (game state). Re-read at most once a minute while games are on.
const WL = {day: null, j: null, sb: null, at: 0, busy: null, timer: null, state: {}, ent: {}, det: {}};
function wkLiveLoad(today, force) {
  if (L.platform !== "espn" || !/^\d+$/.test(L.id || "")) return Promise.resolve(false);
  if (WL.busy) return WL.busy;
  if (!force && WL.day === today && Date.now() - WL.at < 55e3) return Promise.resolve(false);
  const P = espnPeriod(today);
  WL.busy = Promise.all([
    fetch(espnBase() + L.id + "?view=mMatchupScore&view=mScoreboard&scoringPeriodId=" + P, {cache: "no-store"}).then((r) => (r.ok ? r.json() : null)),
    espnSite("scoreboard", "dates=" + today.replace(/-/g, ""))]).then(([j, sb]) => {
    WL.day = today; WL.j = j; WL.sb = sb; WL.at = Date.now(); WL.P = P;
    WL.state = {}; WL.ent = {}; WL.det = {};
    ((sb && sb.events) || []).forEach((e) => {
      const st = ((e.status || {}).type || {}).state || "pre";
      (e.competitions[0].competitors || []).forEach((t) => { const tri = ETRI[t.team.abbreviation] || t.team.abbreviation;
        WL.state[tri] = st; WL.det[tri] = ((e.status || {}).type || {}).shortDetail || ""; });
    });
    ((j && j.schedule) || []).forEach((m) => ["home", "away"].forEach((k) => {
      const sd = m[k]; if (!sd || !sd.rosterForCurrentScoringPeriod) return;
      sd.rosterForCurrentScoringPeriod.entries.forEach((e) => { const x = liveStat(e, P);
        WL.ent[e.playerId] = {slot: e.lineupSlotId, fp: x ? x.appliedTotal || 0 : null, min: x && x.stats ? x.stats[40] || 0 : 0}; });
      // the live score on the matchup cards
      const mm = (WK.mm || []).find((x) => x.id === m.id);
      if (mm && mm[k]) { mm[k].totalPointsLive = sd.totalPointsLive; mm[k].totalPoints = sd.totalPoints; }
    }));
    return true;
  }).catch(() => false).finally(() => { WL.busy = null; });
  return WL.busy;
}
// his NBA team's game today: "pre" (or unknown), "in", "post"
const wkGame = (p, d) => (p && WL.day === d ? WL.state[p.tm] || "pre" : "pre");
// the share of a game still to be played (projections count only that part)
function wkLeft(p, d) {
  const st = wkGame(p, d);
  if (st === "post") return 0;
  if (st !== "in") return 1;
  const e = ((WL.sb && WL.sb.events) || []).find((ev) => (ev.competitions[0].competitors || []).some((t) => (ETRI[t.team.abbreviation] || t.team.abbreviation) === p.tm));
  const S = (e && e.status) || {}, per = S.period || 0, clk = S.clock != null ? S.clock : 720;
  return per > 4 ? 0 : Math.max(0, 2880 - ((per - 1) * 720 + (720 - clk))) / 2880;
}
// a player whose game has tipped off (owner 11-14: "pull the live projection into a Currently playing status"):
// his ESPN lineup is locked, his points so far are known, and the rest of his game is projected as on the
// Live tab: on the court = his per-game value if he plays (no sit odds left) x share of 48 minutes to go,
// not yet in = the usual per-game value x that share, final = nothing left
function wkLiveLine(p, x, today) {
  if (!p || !x || x.d !== today || WL.day !== today) return null;
  const st = wkGame(p, today);
  if (st === "pre") return null;
  const e = WL.ent[p.id] || null, played = !!e && (e.min > 0 || (e.fp || 0) !== 0), left = wkLeft(p, today);
  const per = played ? (x.v != null ? x.v : x.val) : x.val;
  const rest = st === "post" ? 0 : per * left;
  return {st, e, played, left, rest, fp: e && e.fp != null ? e.fp : 0, starter: e ? e.slot !== 12 && e.slot !== 13 : null,
    detail: WL.det[p.tm] || "", proj: (e && e.fp != null ? e.fp : 0) + rest};
}
function weekVsProj(p, ws, today) {
  if (!GAMES || !p) return null;
  const C = GAMES.C, at = rosAtC(p, ws);
  const fpd = fpgUnder(META.league, at.sl, at.bp) || at.fp, scale = fpd > 0 ? at.fp / fpd : 1;
  const gs = (GAMES.byP[p.id] || []).filter((r) => r[C.d] >= ws && r[C.d] < today);
  let act = 0, exp = 0, n = gs.length;
  gs.forEach((r) => {
    act += fpgRow(r);
    exp += at.fp + mAdj(p, (META.sched[p.tm] || []).find((x) => x[0] === r[C.d]), scale).adj;
  });
  // tonight's game once it's final (ESPN's points; the morning build adds the box score)
  const e = WL.day === today && WL.ent[p.id];
  if (e && e.fp != null && wkGame(p, today) === "post" && today >= ws && !gs.some((r) => r[C.d] === today)) {
    const g = (META.sched[p.tm] || []).find((x) => x[0] === today);
    if (g) { act += e.fp; exp += at.fp + mAdj(p, g, scale).adj; n++; }
  }
  if (!n) return null;
  return {n, act, exp, pg: at.fp, live: !!e};
}
// colour-coded status for a My week row: official report > IR slot > live ESPN
function statusTag(r, lg) {
  const td = todayET(), x = (r.days || []).find((y) => y.d === td), Lv = r.p && x ? wkLiveLine(r.p, x, td) : null;
  if (Lv) {
    const where = Lv.starter == null ? "" : Lv.starter ? "in your lineup" : "on your bench";
    if (Lv.st === "post") return `<span class="tag fin" style="margin:0" title="${esc(`Final${where ? ", " + where : ""}: ${fx(Lv.fp, 1)} FP`)}">FINAL ${fx(Lv.fp, 0)}</span>`;
    return `<span class="tag live" style="margin:0" title="${esc(`Currently playing (${Lv.detail})${where ? ", " + where : ""}.\n${fx(Lv.fp, 1)} FP so far` +
      `${Lv.played ? "" : " (not in the game yet)"} + ${fx(Lv.rest, 1)} expected in the ${Math.round(Lv.left * 100)}% of the game left = ${fx(Lv.proj, 1)} projected` +
      (Lv.starter === false ? "\nOn your bench: his points don't count for you" : ""))}"><i></i>PLAYING</span>` +
      `<span class="wk-ln">${fx(Lv.fp, 0)} <span class="dim">→ ${fx(Lv.proj, 0)}</span> <small>${esc(Lv.detail)}</small></span>`;
  }
  const o = off(r.p);
  if (o) {
    const lbl = {Out: "OUT", Doubtful: "DOUBT", Questionable: "Q", Probable: "PROB"}[o[0]];
    const cls = {Out: "inj", Doubtful: "doubt", Questionable: "dtd", Probable: "prob"}[o[0]];
    const when = o[0] === "Out" && o[2] < 2 && o[1] ? " " + o[1].slice(5) : "";
    return `<span class="tag ${cls}" style="margin:0" title="${esc(offTitle(o, r.p))}">${lbl}${when}</span>`;
  }
  if (lg.slot[r.id] === 13) return '<span class="tag inj" style="margin:0" title="On the IR slot">IR</span>';
  const e = r.p && offCleared(r.p) ? "ACTIVE" : r.inj;
  if (r.p && benched(r.p)) return `<span class="tag dnp" style="margin:0" title="${esc(benchTip(r.p))}">DNP</span>`;
  if (OUT_SET.includes(e))
    return `<span class="tag inj" style="margin:0" title="${r.p ? esc(espnTip(r.p)) : "ESPN status"}">${e === "INJURY_RESERVE" ? "IR" : e === "SUSPENSION" ? "SUSP" : "OUT"}</span>`;
  if (e === "DAY_TO_DAY") return `<span class="tag dtd" style="margin:0" title="${r.p ? esc(espnTip(r.p)) : "ESPN status"}">DTD</span>`;
  return "";
}
const normCdf = (x) => {   // Abramowitz-Stegun
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};
// The league's matchup periods: ESPN's map (matchup id -> its fantasy weeks)
// when the league was pulled, else built from the League tab's playoff weeks
// and weeks per round. Playoff rounds are named from the end (Finals, ...).
const mdShort = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, {month: "short", day: "numeric"});
function matchupPeriods() {
  const W = Object.fromEntries(META.weeks.map((w) => [w[0], w]));
  let per = [];
  if (L.mp) per = Object.entries(L.mp).map(([id, wks]) => ({id: +id, weeks: wks.map(Number)})).sort((a, b) => a.id - b.id);
  else {
    const pw = L.playoff_weeks, len = Math.max(1, L.po_len || 1), last = META.weeks.length;
    for (let w = 1; w <= (pw ? pw[0] - 1 : last); w++) per.push({id: w, weeks: [w]});
    if (pw) for (let w = pw[0], id = pw[0]; w <= pw[1]; w += len, id++)
      per.push({id, weeks: Array.from({length: Math.min(len, pw[1] - w + 1)}, (_, i) => w + i)});
  }
  per = per.filter((p) => p.weeks.length && p.weeks.every((w) => W[w]));
  const poStart = L.playoff_weeks ? L.playoff_weeks[0] : Infinity;
  const po = per.filter((p) => p.weeks[0] >= poStart);
  const names = ["Finals", "Semifinals", "Quarterfinals"];
  po.forEach((p, i) => { p.playoff = true; p.label = names[po.length - 1 - i] || `Playoff round ${i + 1}`; });
  const gameDays = new Set(Object.values(META.sched).flatMap((g) => g.map((x) => x[0])));
  per.forEach((p) => {
    p.start = W[p.weeks[0]][1]; p.end = W[p.weeks[p.weeks.length - 1]][2];
    if (!p.label) p.label = `Matchup ${p.id}`;          // owner 11-14: matchups, not weeks (some span two weeks)
    p.span = Math.round((Date.parse(p.end) - Date.parse(p.start)) / 864e5) + 1;
    p.dates = `${mdShort(p.start)} – ${mdShort(p.end)}`;
    let n = 0;
    for (let d = p.start; d <= p.end; d = addDays(d, 1)) if (gameDays.has(d)) n++;
    p.gameDays = n;
    // ESPN: adds per game day x game days, rounded down (assumed; scaled proportionally per ESPN)
    p.adds = L.adds_day ? Math.floor(L.adds_day * n + 1e-9) : L.adds;
  });
  return per;
}
function starterSlots() {               // the league's starter slot ids, one per slot
  const S = [];
  Object.entries(L.slots).forEach(([nm, c]) => {
    const id = SLOT_ID[nm];
    if (id == null || nm === "BE" || nm === "IR") return;
    for (let q = 0; q < c; q++) S.push(id);
  });
  return S.sort((a, b) => a - b);
}
// ============================================================ LOCK-IN (Sleeper)
// One game per starter counts each week (Mon-Sun): after a game you lock it or
// pass; never locked -> his team's LAST game of the week, 0 if he sits it.
// Optimal stopping (src/backtest/lockin.py, pre-registered, 2024-25 + 2025-26:
// +5 FP per starter-week over Sleeper's default, weekly value within 5%):
//   after the last game V = play x mean; earlier V = (1-play) V + play E[max(S, V)]
// S ~ Normal(mean, sd) per game = the Waivers per-game value (matchup, back-to-back)
// and the calibrated game-to-game spread.
const npdf = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
function emaxN(mu, sd, c) {
  if (!(sd > 0)) return Math.max(mu, c);
  const a = (mu - c) / sd;
  return c + (mu - c) * normCdf(a) + sd * npdf(a);
}
// expected locked score from these upcoming games (in order), each {play, v, sd}
function lockV(gs) {
  let V = null;
  for (let i = gs.length - 1; i >= 0; i--) {
    const g = gs[i];
    V = V == null ? g.play * g.v : (1 - g.play) * V + g.play * emaxN(g.v, g.sd, V);
  }
  return V || 0;
}
// a player's Lock-In week: actual FP in finished games, the lock the rule would
// have made, and what he is worth from here
function lockWeek(p, days, today) {
  const C = GAMES && GAMES.C;
  // upcoming games: today's availability (injuries, return dates, status odds);
  // finished games are judged as they looked then, so today's injury never leaks back
  const dvF = dayVals(p, days, false, (d, sp) => !outOn(p, d) && sp >= 0.05 && !benched(p) && !(isAbsent(p) && absWindow(p).ret > d));
  const dvP = dayVals(p, days, false, () => true);
  const games = days.map((d, i) => ({d, x: d < today ? dvP[i] : dvF[i], xp: dvP[i]})).filter((g) => g.x.g);
  const act = {};
  if (C) (GAMES.byP[p.id] || []).forEach((r) => { if (days.includes(r[C.d])) act[r[C.d]] = fpgRow(r); });
  const proj = (g) => ({play: g.x.avail ? g.x.play : 0, v: g.x.v || 0, sd: Math.sqrt(g.x.sd2 || 0) * (g.x.rf || 1)});
  const projThen = (g) => ({play: g.xp.play || 0, v: g.xp.v || 0, sd: Math.sqrt(g.xp.sd2 || 0) * (g.xp.rf || 1)});
  const past = games.filter((g) => g.d < today), fut = games.filter((g) => g.d >= today);
  let locked = null;
  past.forEach((g) => {
    const k = games.indexOf(g);
    if (locked || !(g.d in act) || k === games.length - 1) return;
    const bar = lockV(games.slice(k + 1).map(projThen));   // as it looked that night
    if (act[g.d] >= bar) locked = {d: g.d, x: act[g.d], bar};
  });
  const futV = lockV(fut.map(proj));
  const last = games[games.length - 1];
  const recent0 = [...past].reverse().find((g) => g.d in act);
  const canLock = recent0 && fut.length && (!locked || locked.d === recent0.d) ? act[recent0.d] : null;   // his latest game can still be locked now
  const value = locked ? locked.x : fut.length ? Math.max(futV, canLock ?? -Infinity) : last && last.d in act ? act[last.d] : 0;
  const state = locked ? "locked" : fut.length ? "open" : "final";
  const recent = [...past].reverse().find((g) => g.d in act);
  // the decision now: his latest finished game vs what his remaining games are worth
  const decide = recent && fut.length && (!locked || locked.d === recent.d)
    ? {x: act[recent.d], d: recent.d, bar: futV, lock: act[recent.d] >= futV} : null;
  const out = fut.length > 0 && fut.every((g) => !g.x.avail);   // won't play again this week -> his last game = 0
  return {games, act, locked, value, state, fut, futV, decide, recent, out, mean: fpg(p.s, p.bp), next: fut[0] && fut[0].d};
}
const SLOT_OF = (pos) => ({PG: "PG", SG: "SG", SF: "SF", PF: "PF", C: "C", G: "G", F: "F", UTIL: "UTIL"}[pos] || pos);
function renderWeekLock(lg, PER, days, today) {
  if (!GAMES) { $("wk-detail").innerHTML = '<p class="note">Loading this week&rsquo;s games&hellip;</p>'; loadGames().then(renderWeek); return; }
  const wk = PER.id, over = PER.end < today, mt = myTeam();
  const gridKey = document.querySelector("#tab-week > .legend");
  if (gridKey) gridKey.hidden = true;                  // that key explains the every-game lineup grid
  const ms = (WK.mm || []).filter((m) => m.matchupPeriodId === wk && m.home && m.away);
  const dn = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short"});
  const dshort = (d) => dn(d) + " " + (+d.slice(8));
  $("acc-box").hidden = true;
  if (!ms.length) {
    $("wk-cards").innerHTML = "";
    $("ss-box").hidden = true;
    $("wk-detail").innerHTML = `<p class="note">${PER.start > today ? "Sleeper sets this week&rsquo;s matchups and lineups when it starts." : "No Sleeper matchups found for this week."}</p>`;
    return;
  }
  // every team in this week's matchups: starters (Sleeper's current lineup) and their Lock-In values
  const T = {};
  ms.forEach((m) => [m.away, m.home].forEach((side) => {
    const e = side.sl || {}, rp = lg.rpos || [];
    const rows = (e.starters || []).map((sid, i) => {
      const id = SL2ID[sid], p = BYID[id];
      return {sid, id, p, slot: SLOT_OF(rp[i] || ""), lw: p ? lockWeek(p, days, today) : null};
    });
    const st = new Set(e.starters || []);
    const bench = (e.players || []).filter((sid) => !st.has(sid)).map((sid) => ({sid, id: SL2ID[sid], p: BYID[SL2ID[sid]]})).filter((r) => r.p);
    T[side.teamId] = {rows, bench, live: side.totalPoints || 0, proj: rows.reduce((a, r) => a + (r.lw ? r.lw.value : 0), 0)};
  }));
  const pairOf = (m) => [m.away.teamId, m.home.teamId];
  if (!WK.pair || !ms.some((m) => pairOf(m).join() === WK.pair.join())) {
    const mine = ms.find((m) => m.home.teamId === mt || m.away.teamId === mt);
    WK.pair = pairOf(mine || ms[0]);
  }
  $("wk-team").innerHTML = ms.map((m) => { const pr = pairOf(m);
    return `<option value="${pr.join(",")}"${pr.join() === WK.pair.join() ? " selected" : ""}>${esc(lg.byId[pr[0]].name)} vs ${esc(lg.byId[pr[1]].name)}${pr.includes(mt) ? " (yours)" : ""}</option>`; }).join("");
  $("wk-cards").innerHTML = ms.map((m) => {
    const A = m.away, H = m.home, a = T[A.teamId], h = T[H.teamId];
    const isMine = A.teamId === mt || H.teamId === mt, sel = WK.pair.join() === [A.teamId, H.teamId].join();
    const side = (S, t) => `<span class="tn${S.teamId === mt ? " mine" : ""}" title="${esc(lg.byId[S.teamId].name)}"><i class="sw ${S === A ? "a" : "h"}"></i>${esc(lg.byId[S.teamId].name)}</span>` +
      `<span class="lv"></span><span class="lv" title="Sleeper&rsquo;s live score">${over ? "" : fx(t.live, 0)}</span>` +
      `<span class="pf" title="${over ? "Final score" : "Projected: each starter&rsquo;s locked game if the rule says it&rsquo;s locked, else what his remaining games are worth"}">${fx(over ? t.live : t.proj, 0)}</span>`;
    const ap = over ? a.live : a.proj, hp = over ? h.live : h.proj;
    return `<div class="card mcard${isMine ? " minem" : ""}${sel ? " sel" : ""}" data-a="${A.teamId}" data-h="${H.teamId}">` +
      (isMine ? '<span class="yours">YOUR MATCHUP</span>' : "") +
      `<div class="mside"><span class="dim" style="font-size:.7rem">TEAM</span><span></span><span class="dim" style="font-size:.7rem">${over ? "" : "LIVE"}</span><span class="dim" style="font-size:.7rem">${over ? "FINAL" : "PROJ"}</span>` +
      side(A, a) + side(H, h) + "</div>" +
      `<div class="mres">${over ? (ap > hp ? esc(lg.byId[A.teamId].name) + " won" : hp > ap ? esc(lg.byId[H.teamId].name) + " won" : "Tie") + " by " + fx(Math.abs(ap - hp), 0)
        : (ap === hp ? "Dead even" : esc(lg.byId[(ap > hp ? A : H).teamId].name) + " projected to win by " + fx(Math.abs(ap - hp), 0))}</div></div>`;
  }).join("");
  // ---- Lock or pass? (your starters, this week)
  const mine = T[mt];
  if (mine && !over && PER.start <= today) {
    const calls = mine.rows.filter((r) => r.lw).map((r) => {
      const w = r.lw;
      let tag, cls, why;
      const left = `his ${w.fut.length} game${w.fut.length > 1 ? "s" : ""} left ${w.fut.length > 1 ? "are" : "is"} worth`;
      if (w.out && w.decide) {
        tag = "LOCK IT"; cls = "lk-lock";
        why = `Scored <b>${fx(w.decide.x)}</b> on ${dshort(w.decide.d)} and isn&rsquo;t expected to play again this week: lock it now, or he scores 0`;
      } else if (w.out && !w.locked) {
        tag = "SWAP"; cls = "lk-pass";
        why = "Not expected to play his remaining games: start someone else, or he scores 0";
      } else if (w.decide) {
        tag = w.decide.lock ? "LOCK IT" : "PASS"; cls = w.decide.lock ? "lk-lock" : "lk-pass";
        why = `Scored <b>${fx(w.decide.x)}</b> on ${dshort(w.decide.d)}; ${left} <b>${fx(w.decide.bar)}</b> to wait for`;
      } else if (w.locked) {
        tag = "LOCKED"; cls = "lk-done"; why = `${fx(w.locked.x)} on ${dshort(w.locked.d)} beat the ${fx(w.locked.bar)} bar: lock it if you haven&rsquo;t`;
      } else if (w.state === "open") {
        tag = "WAIT"; cls = "lk-wait"; why = `Next game ${dshort(w.next)}; ${left} <b>${fx(w.futV)}</b>`;
      } else {
        tag = "DONE"; cls = "lk-wait"; why = `No games left: his last game counts (${fx(w.value)})`;
      }
      return `<div class="lk-row">${headshot(r.id)}<div class="lk-mid"><div><span class="name" data-id="${r.id}">${esc(r.p.n)}</span> <span class="slt-s">${esc(r.slot)}</span> <span class="dim">avg ${fx(w.mean)}</span></div><div class="lk-why">${why}</div></div><span class="lk-tag ${cls}">${tag}</span></div>`;
    });
    $("ss-box").hidden = false;
    $("ss-box").innerHTML = `<summary><strong>Lock or pass?</strong> &mdash; your starters this week</summary>` +
      `<p class="note" style="margin:.5rem 0">Lock a game when it beats what his remaining games are worth on average (the bar). In two seasons of testing, locking this way scored about <strong>5 more points per starter per week</strong> than Sleeper&rsquo;s default of taking his last game, and the plain rule <em>lock any game at or above his average</em> did almost as well.</p>` +
      `<div class="lk-list">${calls.join("")}</div>` +
      `<div class="legend" aria-label="Key"><span class="lg-i"><span class="lk-tag lk-lock">LOCK IT</span> his last game beats the bar</span><span class="lg-i"><span class="lk-tag lk-pass">PASS</span> his games left are worth more</span><span class="lg-i"><span class="lk-tag lk-done">LOCKED</span> an earlier game already beat the bar</span><span class="lg-i"><span class="lk-tag lk-wait">WAIT</span> no finished game yet</span><span class="lg-i"><span class="lk-tag lk-pass">SWAP</span> won&rsquo;t play again this week: he&rsquo;d score 0</span></div>`;
  } else $("ss-box").hidden = true;
  // ---- detail: both teams of the chosen matchup
  const block = (tid) => {
    const t = T[tid];
    if (!t) return "";
    const cell = (r, d) => {
      const w = r.lw, g = w && w.games.find((x) => x.d === d);
      if (!g) return `<td class="dg"></td>`;
      if (d < today) {
        if (!(d in w.act)) return `<td class="dg out past" title="Didn&rsquo;t play">×</td>`;
        const isL = w.locked && w.locked.d === d;
        return `<td class="dg past${isL ? " lk-cell" : ""}" title="${isL ? "The rule locks this game" : ""}">${fx(w.act[d], 0)}${isL ? " ★" : ""}</td>`;
      }
      if (!g.x.avail) return `<td class="dg out" title="Not expected to play">×</td>`;
      const sl = slpFP(r.id, d);
      return `<td class="dg" title="Projected ${fx(g.x.v)} if he plays (${Math.round((g.x.play || 0) * 100)}% to play)${sl != null ? `\nSleeper projects ${fx(sl)}` : ""}"><span class="dim">${fx(g.x.v, 0)}</span></td>`;
    };
    const status = (w) => w.state === "locked" ? `locked ${fx(w.locked.x, 0)} (${dn(w.locked.d)})` : w.state === "open" ? `${w.fut.length} left` : "week done";
    const rows = t.rows.map((r) => r.lw ? `<tr><td class="l"><span class="slt-s">${esc(r.slot)}</span></td><td class="l name" data-id="${r.id}">${esc(r.p.n)}</td><td class="l dim">${status(r.lw)}</td>` +
      days.map((d) => cell(r, d)).join("") + `<td class="big">${fx(r.lw.value, 1)}</td></tr>`
      : `<tr><td class="l"><span class="slt-s">${esc(r.slot)}</span></td><td class="l dim" colspan="${days.length + 3}">${r.sid ? "A player the site doesn&rsquo;t project (Sleeper id " + esc(r.sid) + ")" : "Empty slot"}</td></tr>`).join("");
    const bench = t.bench.map((r) => `<tr class="isout"><td class="l"><span class="slt-s">BN</span></td><td class="l name" data-id="${r.id}">${esc(r.p.n)}</td><td class="l dim">bench: can&rsquo;t be locked</td>${days.map(() => '<td class="dg"></td>').join("")}<td class="dim">&ndash;</td></tr>`).join("");
    return `<div class="controls" style="align-items:center;margin-top:1.2rem"><h2 style="margin:0">${esc(lg.byId[tid].name)}${tid === mt ? ' <span class="tag rk">YOU</span>' : ""} &mdash; ${esc(PER.label)}</h2>` +
      `<span class="count" style="margin-left:0">${over ? "final " + fx(t.live, 0) : "projected " + fx(t.proj, 0) + " · live " + fx(t.live, 0)}</span></div>` +
      '<div class="tablewrap" style="max-height:none"><table><thead><tr><th class="l">Slot</th><th class="l">Player</th><th class="l">Lock-In</th>' +
      days.map((d) => `<th class="dcol${d < today ? " past" : ""}">${dn(d)}<br><span class="dim">${d.slice(5)}</span></th>`).join("") +
      `<th title="His locked game, or what his remaining games are worth">Worth</th></tr></thead><tbody>${rows}${bench}</tbody></table></div>`;
  };
  $("wk-detail").innerHTML = WK.pair.map(block).join("") +
    `<p class="note">Lock-In counts one game per starter: past days show his fantasy points (★ = the game the lock rule takes), future days his projected score if he plays. ` +
    `<strong>Worth</strong> is the locked game when the rule would have locked one, otherwise what his remaining games are worth if you lock smartly (the expected best you can bank, not his average). ` +
    `Sleeper doesn&rsquo;t say which games you actually locked, so the projection assumes the rule; the live score is Sleeper&rsquo;s own. Bench players can&rsquo;t be locked.</p>`;
  $("wk-count").textContent = `${ms.length} matchups`;
  $("wk-lede").innerHTML = `${esc(PER.label)} (${PER.dates}), every pairing, scored under <strong>${esc(L.name)}</strong> with Sleeper&rsquo;s <strong>Lock-In</strong> rules: one game per starter counts. ` +
    `<strong>Proj</strong> adds each starter&rsquo;s locked game, or what his remaining games are worth if you lock smartly.`;
  $("wk-note").innerHTML = "Lineups and live scores are read from Sleeper; projections from this morning&rsquo;s build. Win chances aren&rsquo;t shown for Lock-In yet.";
}
function renderWeek() {
  const lg = LGRES[L.id];
  if (!lg) {
    $("wk-cards").innerHTML = "";
    $("wk-detail").innerHTML = L.platform === "espn" && /^\d+$/.test(L.id || "")
      ? '<p class="note">Loading your league from ESPN&hellip;</p>'
      : rosterMsg("My week");
    return;
  }
  if (!WK.mm) {
    $("wk-detail").innerHTML = '<p class="note">Loading matchups&hellip;</p>';
    Promise.all([loadMatchups(lg), loadReturns(lg)]).then(renderWeek);
    return;
  }
  const today = todayET();
  const periods = matchupPeriods();
  if (!periods.length) { $("wk-detail").innerHTML = '<p class="note">No matchup weeks in this build.</p>'; return; }
  if (WK.week == null || !periods.some((p) => p.id === WK.week)) {
    const cur = periods.find((p) => p.start <= today && today <= p.end) || periods.find((p) => p.end >= today) || periods[periods.length - 1];
    WK.week = cur.id;
  }
  const pstate = (p) => (p.end < today ? "final" : p.start <= today ? "now" : "upcoming");
  const opt = (p) => `<option value="${p.id}"${p.id === WK.week ? " selected" : ""}>${p.label}: ${p.dates}` +
    `${p.span > 8 ? ` (${Math.round(p.span / 7)} weeks)` : ""} · ${pstate(p)}</option>`;
  const reg = periods.filter((p) => !p.playoff), po = periods.filter((p) => p.playoff);
  $("wk-week").innerHTML = `<optgroup label="Regular season">${reg.map(opt).join("")}</optgroup>` +
    (po.length ? `<optgroup label="Playoffs">${po.map(opt).join("")}</optgroup>` : "");
  const PER = periods.find((p) => p.id === WK.week);
  const wk = PER.id, ws = PER.start, we = PER.end;
  const days = [];
  for (let d = ws; d <= we; d = addDays(d, 1)) days.push(d);
  const SLOTS = starterSlots();
  if (L.platform === "sleeper") return renderWeekLock(lg, PER, days, today);
  if (ws <= today && today <= we) {
    wkLiveLoad(today).then((fresh) => { if (fresh && !$("tab-week").hidden) renderWeek(); });
    clearTimeout(WL.timer);
    const live = Object.values(WL.state).some((st) => st === "in") ||
      (WL.day === today && Object.values(WL.state).some((st) => st === "pre") && dayLocked(today));
    // while games are on, re-read every minute (only while the tab is open)
    if (live) WL.timer = setTimeout(() => { if (!$("tab-week").hidden && !document.hidden) renderWeek(); }, 60e3);
  }
  const gridKey = document.querySelector("#tab-week > .legend");
  if (gridKey) gridKey.hidden = false;
  const TW = Object.fromEntries(lg.teams.map((t) => [t.id, teamWeek(lg, t.id, days, wk, SLOTS, today)]));
  const liveOf = (tid) => { const m = (WK.mm || []).find((x) => x.matchupPeriodId === wk && x.home && x.away && (x.home.teamId === tid || x.away.teamId === tid));
    if (!m) return 0; const sd = m.home.teamId === tid ? m.home : m.away; return (sd.totalPointsLive != null ? sd.totalPointsLive : sd.totalPoints) || 0; };
  Object.entries(TW).forEach(([tid, T]) => { T.final = liveOf(+tid) + T.rem; });
  // start-of-week projection: needs that day's rosters (ESPN) and the game logs
  let SW = null, swNote = "";
  if (ws <= today) {
    const R = lg.wsr && lg.wsr[ws];
    if (R && !(R instanceof Promise) && !R.fail && GAMES)
      SW = Object.fromEntries(lg.teams.map((t) => [t.id, startWeek(R, t.id, days, ws, SLOTS, today)]));
    else if (R && R.fail) swNote = "ESPN did not return this week's opening rosters";
    else if (!WK.swP) WK.swP = Promise.all([weekRoster(lg, ws), loadGames()]).then(() => { WK.swP = null; renderWeek(); });
  }
  const lim = PER.adds;
  const addsLeft = (id) => (lim == null ? null : Math.max(0, lim - ((lg.tx[id] || {})[String(wk)] || 0)));
  const addsTip = L.adds_day
    ? `Adds limit this matchup: ${lim} = ${(L.adds_day * 7).toFixed(0)}/7 per game day × ${PER.gameDays} game days, rounded down (ESPN scales the limit to the matchup's game days). Left = limit − adds used.`
    : `Adds limit this matchup: ${lim}. Left = limit − adds used.`;
  const mt = myTeam();
  const over = we < today;
  // ---- matchups this week; the detail shows BOTH teams of the chosen one
  const ms = WK.mm.filter((m) => m.matchupPeriodId === wk && m.home && m.away);
  const pairOf = (m) => [m.away.teamId, m.home.teamId];
  if (!WK.pair || !ms.some((m) => pairOf(m).join() === WK.pair.join())) {
    const mine = ms.find((m) => m.home.teamId === mt || m.away.teamId === mt);
    WK.pair = mine ? pairOf(mine) : ms.length ? pairOf(ms[0]) : [mt != null ? mt : lg.teams[0].id];
  }
  $("wk-team").innerHTML = ms.length ? ms.map((m) => { const pr = pairOf(m);
    return `<option value="${pr.join(",")}"${pr.join() === WK.pair.join() ? " selected" : ""}>${esc(lg.byId[pr[0]].name)} vs ${esc(lg.byId[pr[1]].name)}${pr.includes(mt) ? " (yours)" : ""}</option>`; }).join("")
    : lg.teams.map((t) => `<option value="${t.id}"${t.id === WK.pair[0] ? " selected" : ""}>${esc(t.name)}</option>`).join("");
  const live = (side) => (side.totalPointsLive != null ? side.totalPointsLive : side.totalPoints) || 0;
  const cards = ms.map((m) => {
    const A = m.away, H = m.home, a = TW[A.teamId], h = TW[H.teamId];
    if (!a || !h) return "";
    const al = live(A), hl = live(H), ap = al + a.rem, hp = hl + h.rem;
    const sd = Math.sqrt(a.var + h.var);
    const pa = sd > 0 ? normCdf((ap - hp) / sd) : (ap > hp ? 1 : ap < hp ? 0 : 0.5);
    const isMine = A.teamId === mt || H.teamId === mt, sel = WK.pair.join() === [A.teamId, H.teamId].join();
    const swv = (tid) => { if (!SW) return `<span class="lv sw0" title="${esc(swNote || "Loading the start-of-week projection")}">${ws <= today ? "…" : ""}</span>`;
      const v = SW[tid].tot, now = over ? liveOf(tid) : TW[tid].final;
      return `<span class="lv sw0" title="${esc(`Projected at the start of the week: ${fx(v, 0)} (opening-day roster and projections, whole week).\n${over ? "Final" : "Projected now"}: ${fx(now, 0)}, ${sg(now - v, 0)} vs the start of the week`)}">${fx(v, 0)}</span>`; };
    const side = (s, t, l, pr, p) => `<span class="tn${s.teamId === mt ? " mine" : ""}" title="${esc(lg.byId[s.teamId].name)}"><i class="sw ${s === A ? "a" : "h"}"></i>${esc(lg.byId[s.teamId].name)}</span>` +
      swv(s.teamId) + `<span class="lv" title="${over ? "" : "Live score"}">${over ? "" : fx(l, 0)}</span><span class="pf" title="${over ? "Final score" : "Projected final: live score + best lineup on each remaining day"}">${fx(pr, 0)}</span>`;
    const st = (t) => t.days.filter((D) => !D.past).reduce((x, D) => x + D.started, 0);
    return `<div class="card mcard${isMine ? " minem" : ""}${sel ? " sel" : ""}" data-a="${A.teamId}" data-h="${H.teamId}">` +
      (isMine ? '<span class="yours">YOUR MATCHUP</span>' : "") +
      `<div class="mside"><span class="dim" style="font-size:.7rem">TEAM</span><span class="dim" style="font-size:.7rem" title="Projected for the whole week on the morning it started">${ws <= today ? "START" : ""}</span><span class="dim" style="font-size:.7rem">${over ? "" : "LIVE"}</span><span class="dim" style="font-size:.7rem">${over ? "FINAL" : "PROJ"}</span>` +
      side(A, a, al, ap, pa) + side(H, h, hl, hp, 1 - pa) + "</div>" +
      (over ? `<div class="mres">${ap > hp ? esc(lg.byId[A.teamId].name) + " won" : hp > ap ? esc(lg.byId[H.teamId].name) + " won" : "Tie"} by ${fx(Math.abs(ap - hp), 0)}</div></div>` :
      `<div class="wrow" title="Rough win chance: projected margin against the week's game-to-game spread"><b class="wa">${Math.round(pa * 100)}%</b>` +
      `<div class="wbar"><span class="a" style="width:${(pa * 100).toFixed(0)}%"></span><span class="h"></span></div><b class="wh">${Math.round((1 - pa) * 100)}%</b></div>` +
      `<div class="mstat"><span class="v">${st(a)}</span><span class="k" title="Starter games left this week (best legal lineup each remaining day)">starts left</span><span class="v">${st(h)}</span>` +
      (lim != null ? `<span class="v">${addsLeft(A.teamId)}<small>/${lim}</small></span><span class="k" title="${esc(addsTip)}">adds left</span><span class="v">${addsLeft(H.teamId)}<small>/${lim}</small></span>` : "") +
      "</div></div>");
  }).join("");
  // ---- start / sit for your team, rest of this matchup
  if (mt != null && TW[mt] && !over) {
    const myM0 = ms.find((m) => m.home.teamId === mt || m.away.teamId === mt);
    const oppId = myM0 ? (myM0.home.teamId === mt ? myM0.away.teamId : myM0.home.teamId) : null;
    $("ss-box").hidden = false;
    renderStartSit(lg, TW[mt], days, today, SLOTS, oppId != null && TW[oppId] ? TW[mt].final - TW[oppId].final : null);
  } else $("ss-box").hidden = true;
  renderAccuracy(lg, SLOTS, today);
  $("wk-cards").innerHTML = cards || '<p class="note">No matchups found for this week (a bye week, or this league&rsquo;s matchup periods don&rsquo;t follow this calendar).</p>';
  // ---- detail: both teams of the chosen matchup
  const dn = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short"});
  const block = (tid) => {
  const T = TW[tid], tname = lg.byId[tid].name;
  const rows = T.ps.slice().sort((a, b) => b.pts - a.pts || b.games - a.games);
  const cell = (r, D, i) => {
    const x = r.days[i], past = D.past ? " past" : "";
    if (!x.g) return `<td class="dg${past}"></td>`;
    if (x.off) return `<td class="dg off${past}" title="${esc(r.dropped ? "Dropped after today's first tip-off: he still counts for you today, not after" : "Added after today's first tip-off: he counts for you from tomorrow")}">–</td>`;
    if (!x.avail) return `<td class="dg out${past}" title="Not playing">×</td>`;
    if (D.past) return x.st ? `<td class="dg st past">●<span class="slt">${ESPN_SLOT[x.slot] || ""}</span></td>` : `<td class="dg bn past">○</td>`;
    const gst = x.d === today ? wkGame(r.p, today) : "pre";
    if (gst !== "pre") {                     // his game has tipped off: the lineup is locked
      const e = WL.ent[r.id], on = e ? e.slot !== 12 && e.slot !== 13 : x.st, sl = e ? (on ? ESPN_SLOT[e.slot] : "") : ESPN_SLOT[x.slot];
      const tip = `${gst === "post" ? "Final" : "In progress"}: ${on ? "in your starting lineup" : "on your bench"} (locked at tip-off)` +
        (e && e.fp != null ? ` — ${fx(e.fp, 1)} FP${gst === "in" ? " so far" : ""}` : "");
      return `<td class="dg ${on ? "st" : "bn"} past lk" title="${esc(tip)}">${on ? "●" : "○"}${on && sl ? `<span class="slt">${sl}</span>` : ""}${gst === "in" ? '<i class="lk-live"></i>' : ""}</td>`;
    }
    const sl = slpFP(r.id, x.d);
    const tip = (x.noslot ? "You started him but every slot he can fill is taken — he won't count"
      : x.pick === 1 ? `You started him: ${fx(x.val)} projected` : x.pick === 0 ? "You benched him"
      : x.st ? `In the best lineup: ${fx(x.val)} projected. Untick to bench him` : "On the bench: the best lineup has no slot for him. Tick to start him") +
      (sl != null ? `\nSleeper projects ${fx(sl)} if he plays (ours ${fx(x.v)})` : "");
    // quiet matchup mark: only when the tested matchup adjustment is big (|adj| >= WK_MCH)
    const pc = posCls((BYID[r.id] || {}).pos), opp = x.g[1], adj = x.adj || 0;
    const big = Math.abs(adj) >= WK_MCH;
    const mtip = `${x.g[2] ? "vs" : "@"} ${opp}: matchup ${sg(adj)} FP` + (x.parts ? ` (pace ${sg(x.parts.pace)}, vs ${CLS_NAME[pc]} ${sg(x.parts.dvp)}, FG% ${sg(x.parts.fgp)}, ${x.g[2] ? "home" : "away"} ${sg(x.parts.home)})` : "") +
      "\n" + dvpTip(opp, pc);
    return `<td class="dg ${x.st ? "st" : "bn"}${x.pick != null ? " man" : ""}${x.noslot ? " warn" : ""}" title="${esc(tip + "\n" + mtip)}">` +
      `<span class="gcw"><input type="checkbox" class="gcb" data-tid="${tid}" data-lpid="${r.id}" data-d="${x.d}"${x.st || x.pick === 1 ? " checked" : ""} aria-label="${esc(r.n)} plays ${x.d}"></span>` +
      (x.st && x.slot != null || big ? `<span class="slt">${x.st && x.slot != null ? ESPN_SLOT[x.slot] + (big ? " " : "") : ""}` +
        (big ? `<b class="wk-m ${adj > 0 ? "up" : "dn"}">${adj > 0 ? "▲" : "▼"}${Math.abs(adj).toFixed(1)}</b>` : "") + "</span>" : "") + "</td>";
  };
  const nPicks = T.ps.reduce((a, r) => a + r.days.filter((x) => x.pick != null && !x.lock && x.d >= today).length + (r.manual ? 1 : 0), 0);
  return `<div class="controls" style="align-items:center;margin-top:1.2rem"><h2 style="margin:0">${esc(tname)}${tid === mt ? ' <span class="tag rk">YOU</span>' : ""} &mdash; ${esc(PER.label)}</h2>` +
    `<span class="count" style="margin-left:0">${over ? "final " + fx(T.final, 0) : "projected " + fx(T.final, 0)}</span>` +
    (SW ? (() => { const S = SW[tid], lv = liveOf(tid), now = over ? lv : T.final, dlt = now - S.tot;
      const sofar = lv - S.past, rest = over ? 0 : T.rem - S.rem;
      return `<span class="count wk-sw" title="${esc(`Projected at the start of the week: ${fx(S.tot, 0)} for the whole week (opening-day roster, projections from games before ${ws}).` +
        `\nScored so far: ${fx(lv, 0)} vs ${fx(S.past, 0)} expected by now` + (over ? "" : ` (days before today; tonight's games count once they start)\nRest of the week: ${fx(T.rem, 0)} projected now vs ${fx(S.rem, 0)} at the start (injuries, roster moves, lineup choices)`))}">` +
        `start of matchup ${fx(S.tot, 0)} <b class="${dlt >= 0 ? "pos-up" : "pos-dn"}">${sg(dlt, 0)}</b>` +
        ` <span class="dim">· so far ${sg(sofar, 0)}${over ? "" : ` · rest of matchup ${sg(rest, 0)}`}</span></span>`; })() : "") +
    (nPicks ? `<button class="btn" data-reset="${tid}">Reset lineup choices (${nPicks})</button>` : "") + "</div>" +
    '<div class="tablewrap" style="max-height:none"><table><thead><tr><th class="l" title="Untick a player you know won\'t play this week">Plays</th><th class="l">Player</th><th class="l">Status</th>' +
    days.map((d, i) => { const D = T.days[i];
      return `<th class="dcol${i % 2 ? " alt" : ""}${D.past ? " past" : ""}">${dn(d)}<br><span class="dim">${d.slice(5)}</span></th>`; }).join("") +
    '<th class="grp" title="Games this week / games in a starter slot">Games / starts</th>' +
    `<th class="wkvp" title="For the games he has played this week: the fantasy points he scored, compared with what we projected for those same games at the start of the week (his projection then, adjusted for each opponent). Green = he beat it, red = he fell short.">Scored vs expected<br><span class="th-sub">this week so far</span></th>` +
    '<th title="Projected points from his remaining starts">Proj left</th></tr></thead><tbody>' +
    rows.map((r) => `<tr class="${r.plays ? "" : "isout"}"><td class="l"><input type="checkbox" data-pid="${r.id}"${r.plays ? " checked" : ""} aria-label="${esc(r.n)} plays this week"></td>` +
      `<td class="l name" data-id="${r.id}">${esc(r.n)}${r.p ? "" : ' <span class="dim">(no projection)</span>'}</td>` +
      `<td class="l">${statusTag(r, lg)}<span class="dim" style="font-size:.76rem">` +
      `${r.dropped ? ' <span class="tag mv" title="Dropped after today\'s first tip-off: today\'s lineup was already locked, so his game today still counts for you; nothing after today does">dropped · today only</span>' : r.added ? ' <span class="tag mv" title="Added after today\'s first tip-off: pickups made after the lock start tomorrow">added · from tomorrow</span>' : ""}${r.ret ? " back " + r.ret.slice(5) : ""}${r.manual ? ` · <span title="${esc(r.plays ? "You ticked his Plays box for this week, so he counts even though the page had him out" : "You unticked his Plays box for this week, so none of his games count")}. Saved in this browser; Reset lineup choices undoes it.">set by you</span>` : ""}</span></td>` +
      T.days.map((D, i) => cell(r, D, i).replace('<td class="dg', `<td class="dg${i % 2 ? " alt" : ""}`)).join("") +
      `<td class="grp">${r.games} / ${r.starts}</td>` + (() => { const v = ws <= today ? weekVsProj(r.p, ws, today) : null;
        if (!v) return '<td class="dim"></td>';
        const d = v.act - v.exp;
        return `<td class="wkvp" title="${esc(`${v.n} game${v.n > 1 ? "s" : ""} played this week: he scored ${fx(v.act)} fantasy points; at the start of the week we expected ${fx(v.exp)} from those games (${fx(v.pg)} per game, adjusted for each opponent). ${d >= 0 ? "He's " + fx(d) + " ahead" : "He's " + fx(-d) + " behind"}.`)}">` +
          `<b class="${d >= 0 ? "pos-up" : "pos-dn"}">${d >= 0 ? "+" : "−"}${fx(Math.abs(d), 0)}</b>` +
          `<span class="sub">${fx(v.act, 0)} scored · ${fx(v.exp, 0)} expected · ${v.n} game${v.n > 1 ? "s" : ""}</span></td>`; })() +
      `<td class="big">${fx(r.pts, 0)}</td></tr>`).join("") +
    `<tr class="open"><td></td><td class="l" colspan="2" title="Players in a starter slot each day, out of ${SLOTS.length}. The small letters are the slots still empty: nights to stream a free agent">Filled starter slots</td>` +
    T.days.map((D, i) => `<td class="dg${i % 2 ? " alt" : ""}${D.past ? " past" : ""}${D.over ? " pos-dn" : D.open && !D.past ? " part" : ""}" title="${esc(D.over ? D.over + " started player(s) don't fit a slot" : D.open ? "Empty: " + D.openSlots.join(", ") : "All " + SLOTS.length + " filled")}">` +
      (!D.playing ? '<span class="dim">no games</span>' : `${D.started}<small>/${SLOTS.length}</small>${D.over ? " !" : ""}` +
      (D.open && !D.past && D.open <= 5 ? `<span class="slt">${esc(D.openSlots.join(" "))}</span>` : "")) + "</td>").join("") +
    `<td class="grp"></td><td></td><td>${fx(T.rem, 0)}</td></tr>` +
    "</tbody></table></div>";
  };
  $("wk-detail").innerHTML = (over ? `<p class="note">${esc(PER.label)} is over: scores are ESPN&rsquo;s finals. The grid below uses <em>today&rsquo;s</em> rosters, so it shows what the best lineup would have been, not what was played.</p>` : "") +
    WK.pair.map(block).join("") +
    `<p class="note">Each remaining game has a box, pre-ticked with the best possible lineup (${SLOTS.length} starter slots, positions respected). ` +
    "Untick a game to bench him that night, tick one to start him; the projection follows your lineup. Outlined boxes are your choices; a red one means every slot he can fill is already taken. " +
    "× = not playing. The <strong>Plays</strong> box on the left takes a player out for the whole week. The bottom row counts filled starter slots each night; the letters under a short night are the empty slots, a chance to stream a free agent (see the Waivers tab). " +
    "All choices are saved for this week in your browser.</p>";
  const myM = ms.find((m) => m.home.teamId === mt || m.away.teamId === mt);
  $("wk-count").textContent = `${ms.length} matchups`;
  $("wk-lede").innerHTML = `${PER.playoff ? "The " + PER.label : PER.label} (${PER.dates}${PER.span > 8 ? `, ${Math.round(PER.span / 7)} weeks` : ""}), every pairing: ${PER.gameDays} game days, ${lim != null ? lim + " adds" : "adds per your league"}. Scored under <strong>${esc(L.name)}</strong>. <strong>Proj</strong> = the live ESPN score plus the best possible lineup on each remaining day ` +
    `(${SLOTS.length} starter slots, filled by an exact assignment of who plays that day), at rest-of-season FP/G with the matchup and back-to-back adjustments from the Waivers tab. ` +
    `Players out or on IR count from ESPN&rsquo;s expected return date when it has one. Click a matchup to see both teams below. Pick any matchup, past or future.` +
    (myM ? "" : "");
  $("wk-note").innerHTML = "Win chance is rough: it treats each remaining game as independent, with each player&rsquo;s game-to-game spread (the same one behind the Waivers ceiling). " +
    "Once a player&rsquo;s game tips off his box locks (● started, ○ bench, as ESPN set the lineup); the projection counts only the part of tonight&rsquo;s games still to play, and a finished game joins &ldquo;Scored vs expected&rdquo; right away. Rosters, injuries, live scores and adds are read from ESPN (tonight&rsquo;s every minute while games are on); projections are from this morning.";
}
// ---- SEASON ACCURACY of the start-of-week projection --------------------------
// Every finished matchup: each team's start-of-week projection (startWeek on that
// week's opening roster) against its ESPN final. Lazy: one roster call per week.
function renderAccuracy(lg, SLOTS, today) {
  const box = $("acc-box");
  const fin = matchupPeriods().filter((p) => p.end < today);
  const ms = (p) => (WK.mm || []).filter((m) => m.matchupPeriodId === p.id && m.home && m.away);
  const done = fin.filter((p) => ms(p).length);
  if (!done.length) { box.hidden = true; return; }
  box.hidden = false;
  const ready = GAMES && done.every((p) => lg.wsr && lg.wsr[p.start] && !(lg.wsr[p.start] instanceof Promise));
  if (!ready) {
    box.innerHTML = '<summary><strong>How accurate is the start-of-week projection?</strong> <span class="dim">loading finished weeks&hellip;</span></summary>';
    if (!WK.accP) WK.accP = Promise.all([loadGames(), ...done.map((p) => weekRoster(lg, p.start))]).then(() => { WK.accP = null; renderWeek(); });
    return;
  }
  const rows = [], games = [];
  done.forEach((p) => {
    const R = lg.wsr[p.start];
    if (R.fail) return;
    const days = [];
    for (let d = p.start; d <= p.end; d = addDays(d, 1)) days.push(d);
    ms(p).forEach((m) => {
      const one = (sd) => ({wk: p, tid: sd.teamId, start: startWeek(R, sd.teamId, days, p.start, SLOTS, today).tot, final: sd.totalPoints || 0});
      const a = one(m.away), h = one(m.home);
      rows.push(a, h);
      if (a.final !== h.final) games.push({wk: p, hit: (a.start > h.start) === (a.final > h.final)});
    });
  });
  if (!rows.length) { box.hidden = true; return; }
  const stats = (rs) => { const n = rs.length, e = rs.map((r) => r.final - r.start);
    return {n, mae: e.reduce((a, x) => a + Math.abs(x), 0) / n, bias: e.reduce((a, x) => a + x, 0) / n,
      pct: rs.reduce((a, r) => a + Math.abs(r.final - r.start) / Math.max(1, r.start), 0) / n,
      in10: rs.filter((r) => Math.abs(r.final - r.start) <= 0.1 * r.start).length}; };
  const S = stats(rows), hits = games.filter((g) => g.hit).length;
  const kpi = (v, k, tip) => `<div class="sp-kpi"${tip ? ` title="${esc(tip)}"` : ""}><b>${v}</b><span>${k}</span></div>`;
  const mt = myTeam();
  const byWk = done.filter((p) => rows.some((r) => r.wk === p)).map((p) => {
    const st = stats(rows.filter((r) => r.wk === p)), g = games.filter((x) => x.wk === p);
    return `<tr><td class="l">${esc(p.label)} <span class="dim">${p.start.slice(5)} to ${p.end.slice(5)}</span></td><td>${st.n}</td><td>${fx(st.mae, 0)} <span class="dim">${Math.round(st.pct * 100)}%</span></td>` +
      `<td class="${st.bias >= 0 ? "pos-up" : "pos-dn"}">${sg(st.bias, 0)}</td><td>${st.in10} / ${st.n}</td><td>${g.filter((x) => x.hit).length} / ${g.length}</td></tr>`;
  }).join("");
  const teams = lg.teams.map((t) => { const rs = rows.filter((r) => r.tid === t.id);
    if (!rs.length) return null;
    const d = rs.map((r) => r.final - r.start);
    return {t, n: rs.length, start: rs.reduce((a, r) => a + r.start, 0) / rs.length, final: rs.reduce((a, r) => a + r.final, 0) / rs.length,
      diff: d.reduce((a, x) => a + x, 0) / rs.length, beat: d.filter((x) => x > 0).length};
  }).filter(Boolean).sort((a, b) => b.diff - a.diff);
  const byTeam = teams.map((o) => `<tr class="${o.t.id === mt ? "mine" : ""}"><td class="l">${esc(o.t.name)}${o.t.id === mt ? ' <span class="tag rk">YOU</span>' : ""}</td><td>${o.n}</td>` +
    `<td>${fx(o.start, 0)}</td><td>${fx(o.final, 0)}</td><td class="${o.diff >= 0 ? "pos-up" : "pos-dn"}"><b>${sg(o.diff, 0)}</b></td><td>${o.beat} / ${o.n}</td></tr>`).join("");
  box.innerHTML = `<summary><strong>How accurate is the start-of-week projection?</strong> <span class="dim">${done.length} finished week${done.length > 1 ? "s" : ""}: ` +
    `typical miss ${fx(S.mae, 0)} (${Math.round(S.pct * 100)}%) · winner called ${hits} of ${games.length}</span></summary>` +
    `<div class="sp-kpis">${kpi(S.n, "team-weeks", "Every team in every finished matchup")}` +
    kpi(fx(S.mae, 0), "typical miss", `Average gap between the start-of-week projection and the final score, either direction: ${Math.round(S.pct * 100)}% of the projection`) +
    kpi(sg(S.bias, 0), "lean", "Average final minus projection: + means teams scored more than projected (pickups and streaming help), − less") +
    kpi(`${S.in10}/${S.n}`, "within 10%", "Team-weeks whose final landed within 10% of the start-of-week projection") +
    kpi(`${hits}/${games.length}`, "winners called", "Matchups where the team projected higher at the start of the week won") + "</div>" +
    `<div class="grid2 acc-cols"><div><h3>By week</h3><div class="tablewrap" style="max-height:none"><table><thead><tr><th class="l">Week</th><th>Teams</th><th title="Average miss, either direction (% of the projection)">Typical miss</th><th title="Average final minus projection">Lean</th><th>Within 10%</th><th>Winners called</th></tr></thead><tbody>${byWk}</tbody></table></div></div>` +
    `<div><h3>By team</h3><div class="tablewrap" style="max-height:none"><table><thead><tr><th class="l">Team</th><th>Weeks</th><th>Projected</th><th>Final</th><th title="Average final minus start-of-week projection">vs projection</th><th title="Weeks the team beat its start-of-week projection">Beat it</th></tr></thead><tbody>${byTeam}</tbody></table></div></div></div>` +
    `<p class="note">Each team&rsquo;s projection uses its roster on the first day of that week and only games played before it (see How it works). ` +
    `It can&rsquo;t know about pickups, so a team that streams well beats it and one that leaves injured players in its lineup falls short: the By team table is partly a measure of management. ` +
    `${S.n < 40 ? "Still a small sample; the numbers firm up as weeks finish." : ""}</p>`;
}
// ============================================================ START / SIT
// Nights when more of your players play than you have starter slots. Each
// player's value that night = the My week / Waivers per-game formula (ROS FP/G
// + injury boost, return ramp, matchup: pace / FP allowed to his position /
// FG% allowed / home, back-to-back and game-day status odds). The lineup is
// the exact best assignment to the starter slots; every bench player is then
// forced in to price the swap exactly (who drops out, points it costs).
const SS = {day: null, mode: "proj"};
function startSit(T, i, SLOTS, mode) {
  const av = T.ps.filter((r) => r.days[i].avail);
  const w = (r) => (mode === "ceil" ? r.days[i].ceil : r.days[i].val);
  const solve = (force) => {
    const res = assignMax(av.map((r) => SLOTS.map((s) => (r.elig.includes(s) ? Math.max(w(r), 0.01) + (r === force ? 1e5 : 0) : 0))));
    const st = new Map();
    av.forEach((r, k) => { if (res.rc[k] >= 0) st.set(r, SLOTS[res.rc[k]]); });
    return {st, tot: [...st.keys()].reduce((a, r) => a + w(r), 0)};
  };
  const best = solve(null);
  const minStart = Math.min(...[...best.st.keys()].map(w));
  const rows = av.map((r) => {
    const x = r.days[i], o = {r, x, w: w(r), slot: best.st.get(r)};
    o.start = o.slot != null;
    if (!o.start) {
      const f = solve(r);
      if (!f.st.has(r)) o.noslot = true;
      else {
        o.cost = best.tot - f.tot;
        o.out = [...best.st.keys()].filter((q) => !f.st.has(q));
        // chance he outscores the starter he'd replace (normal approx., games independent)
        const q = o.out[0];
        if (q) { const v = x.var + q.days[i].var; o.beat = v > 0 ? normCdf((x.val - q.days[i].val) / Math.sqrt(v)) : (x.val > q.days[i].val ? 1 : 0); }
      }
      o.pos = o.w > minStart;          // ranks above a starter but positions keep him out
    }
    return o;
  });
  return {rows, tot: best.tot, n: av.length};
}
function renderStartSit(lg, T, days, today, SLOTS, margin) {
  const box = $("ss-box");
  const idx = days.map((d, i) => i).filter((i) => days[i] >= today && T.ps.filter((r) => r.days[i].avail).length > SLOTS.length);
  if (!idx.length) {
    box.innerHTML = `<summary><strong>Start / sit</strong> &mdash; nights with more players than slots</summary><p class="note">No crowded nights left this week: you never have more than ${SLOTS.length} players playing, so everyone who plays starts.</p>`;
    return;
  }
  if (SS.day == null || !idx.some((i) => days[i] === SS.day)) SS.day = days[idx[0]];
  const i = days.indexOf(SS.day);
  const S = startSit(T, i, SLOTS, SS.mode);
  SS.last = {T, i, SLOTS};
  const dn = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short"}) + " " + (+d.slice(8));
  const chip = (k, v, lbl, tip) => `<button class="chip" data-ss${k}="${v}" aria-pressed="${(k === "day" ? SS.day : SS.mode) === v}"${tip ? ` title="${esc(tip)}"` : ""}>${lbl}</button>`;
  const dayChips = idx.map((j) => chip("day", days[j], `${dn(days[j])} <small>${T.ps.filter((r) => r.days[j].avail).length} for ${SLOTS.length}</small>`)).join("");
  const top = Math.max(...S.rows.map((o) => o.x.ceil), 1);
  const mtip = (x) => {
    if (!x.parts) return "No matchup data for this opponent yet";
    const P = x.parts, f = P.f, cw = {G: "guards", F: "forwards", C: "centres"}[f.c], o = x.g[1];
    return `Matchup ${sg(x.adj)} FP vs an average game\n` +
      `  pace: ${o} plays at ${(f.pace * 100).toFixed(0)}% of league  ${sg(P.pace)}\n` +
      `  ${o} allows ${(f.dvp * 100).toFixed(0)}% of league FP to ${cw}  ${sg(P.dvp)}\n` +
      `  ${o} allows ${(f.fgp * 100).toFixed(0)}% of league FG%  ${sg(P.fgp)}\n` +
      `  ${x.g[2] ? "home" : "away"}  ${sg(P.home)}\n` +
      `(${f.n} ${o} games so far; tested on 16 seasons of games)`;
  };
  const flags = (o) => {
    const x = o.x, out = [];
    const st = statusTag(o.r, lg);
    if (st) out.push(st);
    if (x.second && x.play < 1 && x.sp >= 1) out.push(`<span class="tag b2b" title="${esc(`Second night of a back-to-back: he has sat ${o.r.p && o.r.p.b2b ? b2b0(o.r.p) : "some"} of these. Counts ${Math.round(x.play * 100)}% of a game`)}">B2B ${Math.round((1 - x.play) * 100)}%</span>`);
    else if (x.sp < 1) out.push(`<span class="tag dtd" title="${esc(statusPlayTip(o.r.p, x.d) || "")}">plays ${Math.round(x.play * 100)}%</span>`);
    if (x.bst > 0.05) out.push(`<span class="tag boost" title="Injury boost: teammates out">▲ +${fx(x.bst)}</span>`);
    if (x.rf < 0.995) out.push(`<span class="tag" title="Back from a long absence: minutes ramp up over his first two games">ramp ${Math.round(x.rf * 100)}%</span>`);
    return out.join("");
  };
  const row = (o) => {
    const x = o.x, p = o.r.p, opp = x.g[1];
    const why = o.start ? "" : o.noslot ? `<span class="ss-why" title="Every slot he can fill (${esc(o.r.elig.map((s) => ESPN_SLOT[s]).join(", "))}) is taken by a better player">no slot</span>`
      : `<span class="ss-why" title="${esc(`Starting him instead costs ${fx(o.cost)} ${SS.mode === "ceil" ? "ceiling " : ""}points: ${o.out.map((q) => q.n).join(", ")} would sit. He outscores ${o.out[0] ? o.out[0].n : "him"} about ${Math.round((o.beat || 0) * 100)}% of the time (rough)`)}">` +
        `vs ${esc(surname(o.out[0] ? o.out[0].n : ""))} <b>${Math.round((o.beat || 0) * 100)}%</b> · −${fx(o.cost)}</span>`;
    return `<div class="ss-row${o.start ? " on" : ""}${!o.start && o.beat >= 0.4 ? " close" : ""}">` +
      (p ? headshot(p.id) : '<span class="sp-hs"></span>') +
      `<div class="ss-mid"><div class="ss-n"><span class="name" data-id="${o.r.id}">${esc(o.r.n)}</span>${o.start ? `<span class="slt-s">${ESPN_SLOT[o.slot]}</span>` : ""}${flags(o)}</div>` +
      `<div class="ss-sub">${teamLogo(p ? p.tm : "")}<span class="dim">${x.g[2] ? "vs" : "@"}</span> ${teamLogo(opp)}${opp}` +
      `<span class="ss-mch ${x.adj >= 0.5 ? "pos-up" : x.adj <= -0.5 ? "pos-dn" : "dim"}" title="${esc(mtip(x))}">${x.parts ? sg(x.adj) : "–"}</span>${why}</div>` +
      `<div class="ss-bar" title="${esc(`Projected ${fx(x.val)} FP (${fx(x.base)} FP/G${x.bst > 0.05 ? " + " + fx(x.bst) + " boost" : ""}${x.adj ? " " + sg(x.adj) + " matchup" : ""}${x.play < 1 ? ", × " + Math.round(x.play * 100) + "% to play" : ""}). Ceiling (a 1-in-10 night) ${fx(x.ceil)}`)}">` +
      `<i class="p" style="width:${(100 * x.val / top).toFixed(1)}%"></i><i class="c" style="left:${(100 * x.ceil / top).toFixed(1)}%"></i></div></div>` +
      `<div class="ss-v"><b>${fx(SS.mode === "ceil" ? x.ceil : x.val)}</b><small>${SS.mode === "ceil" ? "ceil" : "proj"}</small></div></div>`;
  };
  const on = S.rows.filter((o) => o.start).sort((a, b) => b.w - a.w);
  const sit = S.rows.filter((o) => !o.start).sort((a, b) => b.w - a.w);
  const close = sit.filter((o) => o.beat != null).sort((a, b) => b.beat - a.beat)[0];
  // the lineup on the grid below (your own ticks included) vs this one
  const grid = new Set(T.ps.filter((r) => r.days[i].st).map((r) => r.id));
  const diff = on.filter((o) => !grid.has(o.r.id));
  const kpi = (v, k, tip) => `<div class="sp-kpi"${tip ? ` title="${esc(tip)}"` : ""}><b>${v}</b><span>${k}</span></div>`;
  box.innerHTML = `<summary><strong>Start / sit</strong> &mdash; nights with more players than slots</summary>` +
    `<div class="controls" style="margin-top:.6rem"><div class="ctl"><span class="lbl">Crowded nights</span><div class="chips">${dayChips}</div></div>` +
    `<div class="ctl"><span class="lbl">Rank by</span><div class="chips">${chip("mode", "proj", "Projected", "Expected points tonight")}${chip("mode", "ceil", "Ceiling", "A 1-in-10 good night: chase this when you are behind")}</div></div></div>` +
    `<div class="sp-kpis">${kpi(S.n, "playing", `${S.n} of your players have a game, ${SLOTS.length} starter slots`)}` +
    kpi(fx(on.reduce((a, o) => a + o.x.val, 0), 0), "proj FP", "Projected points from the best lineup") +
    (close ? kpi(`${Math.round(close.beat * 100)}%`, "closest call", `${close.r.n} outscores ${close.out[0].n} about ${Math.round(close.beat * 100)}% of the time (rough: normal approximation, games independent)`) : "") +
    (margin != null && !isNaN(margin) ? kpi(`${margin >= 0 ? "+" : "−"}${fx(Math.abs(margin), 0)}`, "week margin", margin < -30 ? "Projected to lose this week: ceiling picks give you more upside" : "Projected margin in your matchup this week") : "") + "</div>" +
    (margin < -30 && SS.mode !== "ceil" ? `<p class="ss-hint">Behind this week? Try <button class="linkbtn" data-ssmode="ceil">Ceiling</button>.</p>` : "") +
    `<div class="grid2 ss-cols"><div><h3 class="ss-h on">Start <small>${on.length}</small></h3>${on.map(row).join("")}</div>` +
    `<div><h3 class="ss-h">Sit <small>${sit.length}</small></h3>${sit.map(row).join("")}</div></div>` +
    (diff.length ? `<p class="ss-hint">Your lineup in the grid below differs: it benches ${diff.map((o) => esc(o.r.n)).join(", ")}.</p>` : "") +
    `<div class="legend" aria-label="Key"><span class="lg-i"><span class="ss-bar lg"><i class="p" style="width:60%"></i><i class="c" style="left:85%"></i></span> projected, gold tick = ceiling</span>` +
    `<span class="lg-i"><span class="ss-mch pos-up">+1.1</span> matchup FP (hover for why)</span>` +
    `<span class="lg-i"><span class="ss-why">vs Name <b>45%</b> · −2.0</span> chance he outscores the starter he&rsquo;d replace · points it costs</span>` +
    `<span class="lg-i"><span class="lgbox" style="outline:1px dashed var(--gold)"></span> close call (40%+)</span></div>`;
}
function bindStartSit() {
  $("ss-box").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ssday],[data-ssmode]");
    if (b) {
      if (b.dataset.ssday) SS.day = b.dataset.ssday;
      if (b.dataset.ssmode) SS.mode = b.dataset.ssmode;
      renderWeek();
      return;
    }
    const n = e.target.closest(".name[data-id]");
    if (n && BYID[+n.dataset.id]) openPlayer(+n.dataset.id);
  });
}
function bindWeek() {
  bindStartSit();
  $("wk-week").addEventListener("change", (e) => { WK.week = +e.target.value; renderWeek(); });
  $("wk-team").addEventListener("change", (e) => { WK.pair = e.target.value.split(",").map(Number); renderWeek(); });
  $("wk-cards").addEventListener("click", (e) => {
    const c = e.target.closest(".mcard");
    if (!c) return;
    WK.pair = [+c.dataset.a, +c.dataset.h];
    renderWeek();
    $("wk-detail").scrollIntoView({behavior: "smooth", block: "start"});
  });
  $("wk-detail").addEventListener("change", (e) => {
    const g = e.target.closest("input[data-lpid]");
    if (g) {
      setLineup(WK.week, +g.dataset.tid, +g.dataset.lpid, g.dataset.d, g.checked);
      renderWeek();
      return;
    }
    const cb = e.target.closest("input[data-pid]");
    if (!cb) return;
    setWeekMark(WK.week, +cb.dataset.pid, cb.checked);
    renderWeek();
  });
  $("wk-detail").addEventListener("click", (e) => {
    const b = e.target.closest("[data-reset]");
    if (!b) return;
    const tid = +b.dataset.reset, lg = LGRES[L.id];
    try {
      localStorage.removeItem(luKey(WK.week, tid));
      const m = weekMarks(WK.week);                 // this team's Plays choices too
      Object.keys(m).forEach((id) => { if (lg && lg.owner[id] === tid) delete m[id]; });
      localStorage.setItem(outKey(WK.week), JSON.stringify(m));
    } catch (err) { /* storage blocked */ }
    renderWeek();
  });
  $("wk-detail").addEventListener("click", (e) => {
    const n = e.target.closest(".name[data-id]");
    if (n && BYID[+n.dataset.id]) openPlayer(+n.dataset.id);
  });
}

// ========================================================= TRADE ANALYZER
// Score = net rest-of-season points (ROS FP/G x projected games left) for
// your side, after the roster-spot effect of an uneven trade.
const TR = {a: null, b: null, give: new Set(), get: new Set()};
const TR_EVEN = 0.03;      // within 3% of what you send = roughly even
function playoffGames(tm) {
  const pw = L.playoff_weeks;
  if (!pw) return 0;
  const ws = META.weeks.filter((w) => w[0] >= pw[0] && w[0] <= pw[1]);
  if (!ws.length) return 0;
  const s = ws[0][1], e = ws[ws.length - 1][2], last = META.last_game_day || "";
  return (META.sched[tm] || []).filter((g) => g[0] >= s && g[0] <= e && g[0] > last).length;
}
function tradeVal(r) {
  const p = r.p;
  return Object.assign(r, {box: (r.now != null ? r.now : r.ros) * r.gl,
    po: r.ros * (p.av || 0) * playoffGames(p.tm)});
}
// A roster's worth = its best `rostered(L)` players chosen from the roster
// PLUS the free-agent pool (keep-list players always stay), so pickups the
// team could make anyway are in the baseline and a trade is only credited
// for value over what waivers already offer. IR-slot players sit outside.
function bestRoster(ids, irIds, fa, k, keep) {
  const n = rostered(L);
  const pool = ids.filter((id) => !irIds.has(id)).map((id) => ({id, v: VAL[id][k], own: true}))
    .concat(fa.map((id) => ({id, v: VAL[id][k], own: false})));
  const forced = pool.filter((x) => x.own && keep && keep.has(normName(BYID[x.id].n)));
  const rest = pool.filter((x) => !forced.includes(x)).sort((a, b) => b.v - a.v);
  const chosen = forced.concat(rest).slice(0, Math.max(n, forced.length));
  return {sum: chosen.reduce((a, x) => a + x.v, 0), set: new Set(chosen.map((x) => x.id))};
}
let VAL = {};
function tradeSide(lg, tid, out, inn, keep) {
  const fa = PLAYERS.filter((p) => lg.owner[p.id] == null && !outNow(p)).map((p) => p.id);
  const ids = Object.keys(lg.owner).map(Number).filter((id) => lg.owner[id] === tid && BYID[id]);
  const ir = new Set(ids.filter((id) => lg.slot[id] === 13));
  const outIds = new Set(out.map((r) => r.p.id));
  const after = ids.filter((id) => !outIds.has(id)).concat(inn.map((r) => r.p.id));
  const res = {};
  ["tot", "po"].forEach((k) => {
    const b = bestRoster(ids, ir, fa, k, keep), a = bestRoster(after, ir, fa, k, keep);
    res[k] = {net: a.sum - b.sum, before: b.set, after: a.set};
  });
  // box-score view = how a manager eyeballs it: the plain sums, no waiver
  // pool (a waiver pool valued on tiny-sample FP/G is all hot starts)
  const inIds = inn.map((r) => r.p.id), outL = [...outIds];
  res.box = {net: inIds.reduce((a, id) => a + VAL[id].box, 0) - outL.reduce((a, id) => a + VAL[id].box, 0),
    before: new Set(outL), after: new Set(inIds)};
  return res;
}
function renderTrade() {
  renderPastTrades();
  const lg = LGRES[L.id];
  if (!lg) {
    $("tr-score").innerHTML = L.platform === "espn" && /^\d+$/.test(L.id || "")
      ? '<p class="note">Loading your league from ESPN&hellip;</p>'
      : rosterMsg("The trade analyzer");
    $("tr-ra").innerHTML = $("tr-rb").innerHTML = "";
    return;
  }
  const mt = myTeam();
  if (TR.a == null || !lg.byId[TR.a]) TR.a = mt != null ? mt : lg.teams[0].id;
  if (TR.b == null || !lg.byId[TR.b] || TR.b === TR.a) TR.b = lg.teams.find((t) => t.id !== TR.a).id;
  const opt = (sel, excl) => lg.teams.filter((t) => t.id !== excl).map((t) =>
    `<option value="${t.id}"${t.id === sel ? " selected" : ""}>${esc(t.name)}${t.id === mt ? " (you)" : ""}</option>`).join("");
  $("tr-a").innerHTML = opt(TR.a, null);
  $("tr-b").innerHTML = opt(TR.b, TR.a);
  const roster = (tid) => Object.keys(lg.owner).map(Number).filter((id) => lg.owner[id] === tid && BYID[id])
    .map((id) => tradeVal(seasonLine(BYID[id]))).sort((x, y) => y.tot - x.tot);
  const RA = roster(TR.a), RB = roster(TR.b);
  const list = (rows, set, side) => rows.map((r) => `<label class="trow${set.has(r.p.id) ? " on" : ""}">` +
    `<input type="checkbox" data-side="${side}" data-pid="${r.p.id}"${set.has(r.p.id) ? " checked" : ""}>` +
    `<span><span class="name" data-id="${r.p.id}">${esc(r.p.n)}</span>${tags(r.p)}${lg.slot[r.p.id] === 13 ? ' <span class="sub">IR</span>' : ""}<br>` +
    `<span class="sub">${esc(r.p.tm)} · ${esc(r.p.pos || "")} · now ${fx(r.now)} · luck-adj ${fx(r.adj)}</span></span>` +
    `<span class="v">${fx(r.ros)}<br><span class="sub">ROS FP/G</span></span><span class="v">${fx(r.tot, 0)}<br><span class="sub">${fx(r.gl, 0)} gm</span></span></label>`).join("");
  $("tr-ra").innerHTML = list(RA, TR.give, "a");
  $("tr-rb").innerHTML = list(RB, TR.get, "b");
  const out = RA.filter((r) => TR.give.has(r.p.id)), inn = RB.filter((r) => TR.get.has(r.p.id));
  $("tr-lede").innerHTML = `Tick players on both sides. The score is <strong>your net rest-of-season points</strong> under <strong>${esc(L.name)}</strong>: ` +
    `each player&rsquo;s projected FP/G × projected games left (his availability × his team&rsquo;s remaining games), so injuries, durability and schedule all count. ` +
    `Both rosters are valued as their best ${rostered(L)} players <em>including the free agents available to them</em>, before and after the trade, so an uneven trade&rsquo;s roster spots count ` +
    `(a 2-for-1 frees a spot for the best free agent; taking back more forces a drop) and nothing gets credit for a pickup you could make today anyway.`;
  if (!out.length && !inn.length) {
    $("tr-score").innerHTML = '<div class="card"><p class="note" style="margin:0">Pick the players you&rsquo;d send and the players you&rsquo;d get.</p></div>';
    $("tr-note").innerHTML = "";
    return;
  }
  VAL = {};
  PLAYERS.forEach((p) => { VAL[p.id] = tradeVal(seasonLine(p)); });
  const keep = TR.a === mt ? keepSet() : null;
  const SA = tradeSide(lg, TR.a, out, inn, keep), SB = tradeSide(lg, TR.b, inn, out, null);
  const mine = {tot: SA.tot.net, box: SA.box.net, po: SA.po.net};
  const theirs = {tot: SB.tot.net, box: SB.box.net};
  const give = out.reduce((a, r) => a + r.tot, 0) || 1;
  // ledger: each player's contribution = in the best 13 after (+) minus before (-)
  const ledger = (S, k) => {
    const ids = new Set([...S[k].before, ...S[k].after]);
    return [...ids].map((id) => ({r: VAL[id], c: (S[k].after.has(id) ? VAL[id][k] : 0) - (S[k].before.has(id) ? VAL[id][k] : 0)}))
      .filter((x) => Math.abs(x.c) > 0.5);
  };
  const L3 = {tot: ledger(SA, "tot"), box: ledger(SA, "box"), po: ledger(SA, "po")};
  const contrib = (id, k) => (L3[k].find((x) => x.r.p.id === id) || {c: 0}).c;
  const inIds = new Set(inn.map((r) => r.p.id)), outIds = new Set(out.map((r) => r.p.id));
  const churn = [...new Set(["tot", "box", "po"].flatMap((k) => L3[k].map((x) => x.r.p.id)))]
    .filter((id) => !inIds.has(id) && !outIds.has(id));
  const pct = mine.tot / give;
  const verdict = Math.abs(pct) < TR_EVEN ? "Roughly even on projected points."
    : pct > 0 ? (theirs.box >= 0 ? "Good for you, and by the box score it also looks fine to them: the kind of offer that gets accepted."
                                 : "Good for you, but by the box score they lose: expect pushback.")
    : (theirs.box < 0 ? "You lose projected points, though by the box score it looks like you&rsquo;re winning it." : "You lose projected points.");
  const nm = (id) => esc(lg.byId[id].name);
  const cls = (v, base) => (Math.abs(v) < TR_EVEN * base ? "" : v > 0 ? "pos-up" : "pos-dn");
  const c0 = (v) => `<span class="${v > 0.5 ? "pos-up" : v < -0.5 ? "pos-dn" : "dim"}">${Math.abs(v) < 0.5 ? "0" : sg(v, 0)}</span>`;
  const why = (id) => {
    if (inIds.has(id)) return contrib(id, "tot") > 0.5 ? "you get" : "you get · doesn't beat the waiver wire";
    if (outIds.has(id)) return contrib(id, "tot") < -0.5 ? "you send" : "you send · was below the waiver wire";
    const own = lg.owner[id] === TR.a;
    return own ? (contrib(id, "tot") < 0 ? "dropped to make room" : "back in your best " + rostered(L))
      : (contrib(id, "tot") > 0 ? "free agent: fills the freed spot" : "free agent you could add today; no room after the trade");
  };
  const row = (id) => {
    const r = VAL[id];
    return `<tr><td class="l"><span class="name" data-id="${id}">${esc(r.p.n)}</span> <span class="dim">${esc(why(id))}</span></td>` +
      `<td>${fx(r.ros)}</td><td>${fx(r.gl, 0)}</td><td>${c0(contrib(id, "tot"))}</td>` +
      `<td class="grp">${fx(r.now)}</td><td>${c0(contrib(id, "box"))}</td><td class="grp">${c0(contrib(id, "po"))}</td></tr>`;
  };
  const pcard = (r, side) => {
    const id = r.p.id, c = contrib(id, "tot");
    const cell = (k, v, t) => `<div title="${esc(t)}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    return `<div class="tpc ${side}"><div class="tph"><span class="name" data-id="${id}">${esc(r.p.n)}</span>${tags(r.p)}` +
      `<span class="sub">${esc(r.p.tm)} · ${esc(r.p.pos || "")}${lg.slot[id] === 13 ? " · on IR" : ""}</span></div>` +
      '<div class="tpg">' +
      cell("ROS FP/G", fx(r.ros), "Rest-of-season projected fantasy points per game") +
      cell("Games left", fx(r.gl, 0), "Projected games left: availability × his team's remaining games") +
      cell("ROS points", fx(r.tot, 0), "ROS FP/G × games left") +
      cell("Now FP/G", fx(r.now), "Actual fantasy points per game so far this season") +
      cell("Luck-adj", fx(r.adj), "This season's FP/G with shooting / steal / block luck stripped out") +
      (L.playoff_weeks ? cell("Playoff pts", fx(r.po, 0), `ROS FP/G × his expected games in weeks ${L.playoff_weeks[0]}–${L.playoff_weeks[1]}`) : "") +
      `</div><div class="tpf" title="What he changes in your best ${rostered(L)} (roster + free agents)">Effect on your team ${c0(c)} <span class="dim">${esc(why(id))}</span></div></div>`;
  };
  const sumT = (rows) => rows.reduce((a, r) => a + r.tot, 0);
  const straight = sumT(inn) - sumT(out), spots = mine.tot - straight;
  const col = (rows, side, title, team) => `<div class="tcol ${side}"><div class="tch"><span>${title}</span><span class="dim">${team}</span></div>` +
    (rows.length ? rows.map((r) => pcard(r, side)).join("") : '<p class="note" style="margin:.4rem 0">Nobody yet: tick players below.</p>') +
    `<div class="tct">${rows.length} player${rows.length === 1 ? "" : "s"} · <strong>${fx(sumT(rows), 0)}</strong> ROS points</div></div>`;
  const pill = (k, v, t, base) => `<span class="tpill" title="${esc(t)}"><span class="k">${k}</span><b class="${base ? cls(v, base) : ""}">${sg(v, 0)}</b></span>`;
  $("tr-score").innerHTML = '<div class="card tbanner">' +
    `<div class="tbig"><div class="lbl2">Your net rest-of-season points</div><div class="big ${cls(mine.tot, give)}">${sg(mine.tot, 0)}</div>` +
    `<div class="lbl2">${sg(pct * 100, 1)}% of what you send</div></div>` +
    `<div class="tsum"><p style="margin:0 0 .5rem"><strong>${verdict}</strong></p>` +
    `<div class="tmath">You get <b>${fx(sumT(inn), 0)}</b> − you send <b>${fx(sumT(out), 0)}</b> = <b>${sg(straight, 0)}</b> straight up` +
    `<span title="The free agents you could add anyway, and the drop or pickup an uneven trade forces"> · waiver wire &amp; roster spots <b>${sg(spots, 0)}</b></span> → <b class="${cls(mine.tot, give)}">${sg(mine.tot, 0)}</b></div>` +
    '<div class="tpills">' + pill(nm(TR.b) + "’s net", theirs.tot, "Their net rest-of-season points, valued the same way", give) +
    pill("Their box-score view", theirs.box, "Actual FP/G so far × games left: how a manager going by averages sees it for them") +
    pill("Your box-score view", mine.box, "Actual FP/G so far × games left, for you") +
    (L.playoff_weeks ? pill(`Your playoff weeks ${L.playoff_weeks[0]}–${L.playoff_weeks[1]}`, mine.po, "ROS FP/G × expected games in your fantasy playoff weeks") : "") +
    "</div></div></div>" +
    '<div class="tcols">' + col(out, "send", "You send", nm(TR.a)) + col(inn, "get", "You get", nm(TR.b)) + "</div>" +
    (churn.some((id) => Math.abs(contrib(id, "tot")) >= 0.5) ? `<div class="card tspots"><div class="tch"><span>Roster spots</span><span class="dim">who moves in or out of your best ${rostered(L)} because of the trade</span></div>` +
      churn.filter((id) => Math.abs(contrib(id, "tot")) >= 0.5).map((id) => `<div class="tsr"><span class="name" data-id="${id}">${esc(VAL[id].p.n)}</span> <span class="dim">${esc(why(id))} · ${fx(VAL[id].ros)} FP/G × ${fx(VAL[id].gl, 0)} gm</span>${c0(contrib(id, "tot"))}</div>`).join("") + "</div>" : "") +
    '<details class="card tledger"><summary>Full ledger (every number behind the score)</summary>' +
    '<div class="tablewrap" style="max-height:none;margin-top:.6rem"><table class="tbrk"><thead><tr><th class="l">Your side of the ledger</th><th>ROS FP/G</th><th>Games left</th><th title="Change to your best-' + rostered(L) + ' rest-of-season points">ROS points</th>' +
    '<th class="grp">Now FP/G</th><th>Box-score points</th><th class="grp">Playoff-week points</th></tr></thead><tbody>' +
    [...inIds].map(row).join("") + [...outIds].map(row).join("") + churn.map(row).join("") +
    `<tr class="tot"><td class="l">Net for ${nm(TR.a)}</td><td></td><td></td><td class="${cls(mine.tot, give)}">${sg(mine.tot, 0)}</td><td class="grp"></td><td>${sg(mine.box, 0)}</td><td class="grp">${sg(mine.po, 0)}</td></tr>` +
    "</tbody></table></div>" +
    `<p class="note">Each line is that player&rsquo;s change to your best ${rostered(L)} (your roster plus whatever the waiver wire offers): a player you get only counts for what he adds over the free agents you could pick up anyway, ` +
    `and a player you send only costs what he was worth over them.</p></details>`;
  $("tr-note").innerHTML = "<strong>Box-score view</strong> is the plain sum of each traded player&rsquo;s actual FP/G so far × games left, with no waiver-wire adjustment: roughly how a manager who goes by average points eyeballs the deal. " +
    "The best trades win on projection and still look fair by box score. Players on your keep list are never the ones dropped to make room. " +
    `With about ${Math.max(...Object.values(TEAMLEFT))} team games left, every number here is a forecast; a gap under ${Math.round(TR_EVEN * 100)}% of what you send is inside the noise.`;
}
// ---- past trades: value at the time vs value now ----------------------------
// At the time = the in-season blend (section 3 of How it works) re-run with
// only the games before the trade date, x availability x team games left
// then. Now = fantasy points actually scored since the trade + today's
// rest-of-season points. Plain sums (no roster-spot adjustment).
const PT = {key: null, p: null, trades: null};
function rosAt(p, T) {
  const C = GAMES.C, rows = (GAMES.byP[p.id] || []).filter((r) => r[C.d] < T);
  const approx = !p.ps;
  const ps = p.ps || p.s, pbp = p.pbp || p.bp, mpg0 = (p.ps ? p.pmpg : p.mpg) || 1e-9;
  let gp = rows.length, mn = 0;
  const tot = STATS.map(() => 0), cnt = [0, 0, 0];
  rows.forEach((r) => { mn += r[C.min] || 0; STATS.forEach((k, i) => { tot[i] += r[C[k]] || 0; });
    cnt[0] += r[C.dd]; cnt[1] += r[C.td]; cnt[2] += r[C.qd]; });
  // the ros.py blend: veterans k 600 min / g0 5 games; rookies (college-model
  // prior) k 200 / g0 5 with minutes from their last 5 games (rookie_ros.py)
  const R = META.ros || {k: 600, g0: 5, h: 20, v_k_up: 300, v_k_down: 1000, v_g0_up: 1, v_g0_down: 10, v_H: 10, rk_k_up: 100, rk_k_down: 400, rk_g0_up: 2, rk_g0_down: 10, rk_L: 5, rk_h: 10};
  const rook = !!p.rook;
  let k = R.k, g0 = R.g0, mpg = (g0 * mpg0 + mn) / (g0 + gp);
  if (rook) {
    // rookies trust real games faster when he beats the projection (rookie_ros.py part 4);
    // direction under the site's default scoring, as the build computes it
    const W = META.league.w, fpOf = (arr) => STATS.reduce((a, s, i) => a + (arr[i] || 0) * (W[s] || 0), 0);
    k = mn > 0 && fpOf(tot) / mn > fpOf(ps) / mpg0 ? R.rk_k_up : R.rk_k_down;
    const last = R.rk_L ? rows.slice().sort((a, b) => (a[C.d] < b[C.d] ? -1 : 1)).slice(-R.rk_L) : rows;
    const ms = last.reduce((a, r) => a + (r[C.min] || 0), 0), n = last.length;
    g0 = n && ms / n > mpg0 ? R.rk_g0_up : R.rk_g0_down;
    mpg = (g0 * mpg0 + ms) / (g0 + n);
  }
  let sl, bp;
  if (!rook && R.v_H && gp) {
    // veterans (ros_refine.py): each game weighted 0.5^(games ago / H), real games trusted
    // faster when he beats the projection; FP judged under the site's default scoring
    const srt = rows.slice().sort((a, b) => (a[C.d] < b[C.d] ? -1 : 1));
    let Mw = 0, Nw = 0, Fw = 0;
    const Tw = STATS.map(() => 0), Bw = [0, 0, 0];
    srt.forEach((r, i) => {
      const w = Math.pow(0.5, (srt.length - 1 - i) / R.v_H), line = STATS.map((kk) => r[C[kk]] || 0);
      Mw += w * (r[C.min] || 0); Nw += w;
      line.forEach((v, j) => { Tw[j] += w * v; });
      [r[C.dd], r[C.td], r[C.qd]].forEach((v, j) => { Bw[j] += w * (v || 0); });
      Fw += w * fpgUnder(META.league, line, [r[C.dd] || 0, r[C.td] || 0, r[C.qd] || 0]);
    });
    const fp0 = fpgUnder(META.league, ps, pbp) / mpg0;
    k = Mw > 0 && Fw / Mw > fp0 ? R.v_k_up : R.v_k_down;
    g0 = Nw && Mw / Nw > mpg0 ? R.v_g0_up : R.v_g0_down;
    mpg = (g0 * mpg0 + Mw) / (g0 + Nw);
    sl = STATS.map((kk, i) => (ps[i] / mpg0 * k + Tw[i]) / (k + Mw) * mpg);
    const geq = k / mpg0;
    bp = pbp.map((b, j) => (b * geq + Bw[j]) / (geq + Nw));
  } else {
    sl = STATS.map((kk, i) => (ps[i] / mpg0 * k + tot[i]) / (k + mn) * mpg);
    const geq = k / mpg0;
    bp = pbp.map((b, j) => (b * geq + cnt[j]) / (geq + gp));
  }
  const sched = (META.sched[p.tm] || []).map((g) => g[0]);
  const before = sched.filter((d) => d < T).length, left = sched.filter((d) => d >= T).length;
  const av0 = p.pre_gp ? Math.min(1, p.pre_gp / 82) : (p.av || 0.8);
  const h = rook ? (R.rk_h || 10) : (R.h || 20);
  const av = Math.min(1, (av0 * h + gp) / (h + before));
  withX(sl, p.xr);
  return {fp: fpg(sl, bp), av, left, tot: fpg(sl, bp) * av * left, approx, sl, bp};
}
function sinceFP(p, T) {
  const C = GAMES.C;
  return (GAMES.byP[p.id] || []).filter((r) => r[C.d] >= T)
    .reduce((a, r) => a + fpgRow(r), 0);
}
function loadPastTrades(lg) {
  const key = L.id;
  if (PT.key === key && PT.p) return PT.p;
  PT.key = key; PT.trades = null;
  const days = [...new Set(Object.values(META.sched).flatMap((g) => g.map((x) => x[0])))].sort();
  const n = days.filter((d) => d <= nowDay()).length;            // ESPN scoring periods = game days
  const flt = JSON.stringify({transactions: {filterType: {value: ["TRADE_ACCEPT", "TRADE_UPHOLD", "TRADE_PROPOSAL", "TRADE_VETO", "TRADE_DECLINE"]}}});
  const ids = Array.from({length: n}, (_, i) => i + 1);
  const out = [];
  const one = (sp) => fetch(espnBase() + key + "?view=mTransactions2&scoringPeriodId=" + sp, {headers: {"x-fantasy-filter": flt}})
    .then((r) => (r.ok ? r.json() : {transactions: []})).catch(() => ({transactions: []}))
    .then((j) => (j.transactions || []).forEach((t) => out.push(t)));
  const pool = async () => { while (ids.length) { await one(ids.shift()); } };
  PT.p = Promise.all(Array.from({length: 6}, pool)).then(() => {
    const seen = new Set();
    PT.trades = out.filter((t) => t.status === "EXECUTED" && /TRADE/.test(t.type) && !seen.has(t.id) && seen.add(t.id))
      .map((t) => {
        const ts = t.processDate || t.proposedDate || 0;
        const d = new Intl.DateTimeFormat("en-CA", {timeZone: "America/New_York"}).format(new Date(ts));
        const items = (t.items || []).filter((i) => i.playerId > 0 && i.toTeamId != null && i.fromTeamId != null);
        return {id: t.id, d, items};
      }).filter((t) => t.items.length).sort((a, b) => (a.d < b.d ? 1 : -1));
    return PT.trades;
  });
  return PT.p;
}
function renderPastTrades() {
  const el = $("tr-past"), lg = LGRES[L.id];
  if (!lg) { el.innerHTML = '<p class="note">Past trades are read from a public ESPN league.</p>'; return; }
  if (!GAMES || PT.trades == null) {
    el.innerHTML = '<p class="note">Reading the league&rsquo;s transaction log from ESPN&hellip;</p>';
    Promise.all([loadGames(), loadPastTrades(lg)]).then(() => renderPastTrades());
    return;
  }
  const tn = (id) => esc((lg.byId[id] || {}).name || "Team " + id);
  const tradeCard = (t, sample) => {
    const sides = {};
    t.items.forEach((i) => { (sides[i.toTeamId] = sides[i.toTeamId] || []).push(i.playerId); });
    const teams = Object.keys(sides).map(Number);
    const val = (tid) => sides[tid].map((pid) => {
      const p = BYID[pid];
      if (!p) return {pid, n: (lg.name[pid] || "#" + pid), then: 0, since: 0, ros: 0, missing: true};
      const a = rosAt(p, t.d), sl = seasonLine(p), C = GAMES.C;
      const sg_ = (GAMES.byP[pid] || []).filter((r) => r[C.d] >= t.d).length;
      return {pid, p, n: p.n, then: a.tot, tfp: a.fp, tgl: a.av * a.left, since: sinceFP(p, t.d), sgp: sg_,
        ros: sl.tot, rfp: sl.ros, rgl: sl.gl, approx: a.approx};
    });
    const V = Object.fromEntries(teams.map((tid) => [tid, val(tid)]));
    const sum = (tid, k) => V[tid].reduce((a, x) => a + (k === "now" ? x.since + x.ros : x[k]), 0);
    const [A, B] = teams;
    const thenEdge = B != null ? sum(A, "then") - sum(B, "then") : 0, nowEdge = B != null ? sum(A, "now") - sum(B, "now") : 0;
    const who = (e) => (Math.abs(e) < 50 ? "even" : (e > 0 ? tn(A) : tn(B)) + " by " + Math.abs(e).toFixed(0));
    const dshort = new Date(t.d + "T12:00:00").toLocaleDateString(undefined, {month: "short", day: "numeric"});
    const changed = (x) => {
      const now = x.since + x.ros, d = now - x.then;
      const games = x.sgp + x.rgl - x.tgl, rate = x.rfp - x.tfp;
      const parts = [];
      if (Math.abs(rate) >= 1) parts.push(`projected FP/G ${rate > 0 ? "up" : "down"} ${fx(Math.abs(rate))}`);
      if (Math.abs(games) >= 2) parts.push(`${Math.abs(games).toFixed(0)} ${games > 0 ? "more" : "fewer"} games expected` +
        (games < 0 && x.p && x.p.inj ? " (" + String(x.p.inj).toLowerCase().replace(/_/g, " ") + ")" : ""));
      return Math.abs(d) < 25 ? "Tracking about where the model had him." : `${d > 0 ? "Worth more" : "Worth less"} than at the trade: ${parts.join(", ") || "small changes in rate and games"}.`;
    };
    const pc = (x) => {
      if (x.missing) return `<div class="ptc"><div class="tph">${esc(x.n)} <span class="sub">no longer in the player pool</span></div></div>`;
      const now = x.since + x.ros, d = now - x.then;
      return `<div class="ptc"><div class="tph"><span class="name" data-id="${x.pid}">${esc(x.n)}</span>${tags(x.p)}<span class="sub">${esc(x.p.tm)} · ${esc(x.p.pos || "")}</span></div>` +
        '<table class="ptt"><thead><tr><th></th>' +
        `<th title="The model's rest-of-season view on ${t.d}, from games before that day only">On ${dshort}</th>` +
        `<th title="What he has actually done for his new team since the trade">Since</th>` +
        `<th title="Today's rest-of-season projection">From today</th></tr></thead><tbody>` +
        `<tr><td class="l">FP/G</td><td>${fx(x.tfp)}${x.approx ? "*" : ""}</td><td>${x.sgp ? fx(x.since / x.sgp) : "–"}</td><td>${fx(x.rfp)}</td></tr>` +
        `<tr><td class="l">Games</td><td>${fx(x.tgl, 0)}</td><td>${x.sgp}</td><td>${fx(x.rgl, 0)}</td></tr>` +
        `<tr class="pts"><td class="l">Points</td><td>${fx(x.then, 0)}</td><td>${fx(x.since, 0)}</td><td>${fx(x.ros, 0)}</td></tr></tbody></table>` +
        `<div class="ptv">Value <span class="dim">${fx(x.then, 0)}</span> &rarr; <b>${fx(now, 0)}</b> <span class="${d > 25 ? "pos-up" : d < -25 ? "pos-dn" : "dim"}">(${sg(d, 0)})</span>` +
        `<span class="dim"> = ${fx(x.since, 0)} scored since + ${fx(x.ros, 0)} to come</span></div>` +
        `<div class="ptw">${esc(changed(x))}</div></div>`;
    };
    const sideHtml = (tid) => `<div class="tcol"><div class="tch"><span>${tn(tid)} got</span>` +
      `<span class="dim">value <span title="On the trade date">${fx(sum(tid, "then"), 0)}</span> &rarr; <b title="Scored since + rest of season from today">${fx(sum(tid, "now"), 0)}</b></span></div>` +
      V[tid].map(pc).join("") + "</div>";
    const flip = Math.sign(nowEdge) !== Math.sign(thenEdge) && Math.abs(nowEdge) >= 50 && Math.abs(thenEdge) >= 50;
    return `<div class="card${sample ? " sample" : ""}" style="margin-bottom:.8rem"><div class="controls" style="margin-bottom:.4rem">` + (sample ? '<span class="tag rk" style="margin:0">EXAMPLE · not a real trade</span>' : "") +
      `<strong>${dshort}: ${teams.map(tn).join(" &#8644; ")}</strong></div>` +
      `<div class="tverd"><span><span class="k">At the time</span><b>${who(thenEdge)}</b></span><span class="arr">&rarr;</span>` +
      `<span><span class="k">Now</span><b class="${flip ? "pos-dn" : ""}">${who(nowEdge)}</b></span>` +
      `<span class="dim">${flip ? "The trade has flipped since it was made." : Math.abs(nowEdge - thenEdge) < 50 ? "Playing out about as projected." : "Same winner, margin " + (Math.abs(nowEdge) > Math.abs(thenEdge) ? "wider" : "narrower") + " than projected."}</span></div>` +
      `<div class="tcols" style="margin-top:.6rem">${teams.map(sideHtml).join("")}</div></div>`;
  };
  // the example (owner asked to keep it on the page): a made-up Oct 24 swap,
  // Jamal Murray for Anthony Edwards, valued exactly like a real trade
  const ids = lg.teams.map((x) => x.id);
  const A = lg.byId[1] ? 1 : ids[0], B = lg.byId[3] && A !== 3 ? 3 : ids.find((x) => x !== A);
  const sample = BYID[3936299] && BYID[4594268] && B != null && META.weeks.length && META.weeks[0][1] <= "2026-10-24" && "2026-10-24" <= (META.last_game_day || "")
    ? {id: "sample", d: "2026-10-24", items: [{playerId: 3936299, fromTeamId: A, toTeamId: B}, {playerId: 4594268, fromTeamId: B, toTeamId: A}]} : null;
  el.innerHTML = (PT.trades.length ? PT.trades.map((t) => tradeCard(t, false)).join("")
      : '<div class="card" style="margin-bottom:.8rem"><p class="note" style="margin:0">No trades have gone through in this league yet this season. When one does, it shows here like the example below.</p></div>') +
    (sample ? tradeCard(sample, true) : "") + '<p class="note">Each player has three columns: <strong>On the trade date</strong> (the model&rsquo;s projected FP/G × games left as it stood that day), <strong>Since</strong> (what he has actually scored for his new team) and <strong>From today</strong> (today&rsquo;s rest-of-season projection). <b>Value now</b> = points scored since + points still to come. ' +
    'The trade-date value re-runs the in-season update with only the games played before that day. * = no preseason line (rookie or call-up), so his current projection stands in. Plain sums, no roster-spot adjustment.</p>';
}

function bindTrade() {
  $("tr-a").addEventListener("change", (e) => { TR.a = +e.target.value; TR.give.clear(); TR.get.clear(); if (TR.b === TR.a) TR.b = null; renderTrade(); });
  $("tr-b").addEventListener("change", (e) => { TR.b = +e.target.value; TR.get.clear(); renderTrade(); });
  $("tab-trade").addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-pid]");
    if (!cb) return;
    const set = cb.dataset.side === "a" ? TR.give : TR.get, id = +cb.dataset.pid;
    if (cb.checked) set.add(id); else set.delete(id);
    renderTrade();
  });
  $("tab-trade").addEventListener("click", (e) => {
    const n = e.target.closest(".name[data-id]");
    if (n && BYID[+n.dataset.id]) { e.preventDefault(); openPlayer(+n.dataset.id); }
  });
}

// =========================================================== TEAM DEFENCE
// Every team's fantasy points allowed to guards / forwards / centres (META.mf,
// season to date), ranked 1 = toughest .. N = easiest, plus pace and opponents'
// FG% — the same factors behind the Waivers matchup adjustment.
const DF = {sort: "tm", dir: 1};
function renderDefence() {
  const R = dvpRanks(), mf = META.mf || {}, T = Object.keys(mf), today = todayET();
  const rk = (c) => { const o = {}; T.slice().sort((a, b) => mf[a][c] - mf[b][c]).forEach((t, i) => { o[t] = i + 1; }); return o; };
  const RP = rk("pace"), RF = rk("fgp");                           // 1 = slowest / stingiest
  const nxt = {};
  Object.entries(META.sched || {}).forEach(([tm, gs]) => { const g = gs.find((x) => x[0] >= today); if (g) nxt[tm] = g; });
  const val = (t, k) => k === "tm" ? (TEAM_NAMES[t] || t) : k === "n" ? mf[t].n : k === "pace" ? mf[t].pace : k === "fgp" ? mf[t].fgp : R[k][t];
  const rows = T.slice().sort((a, b) => { const x = val(a, DF.sort), y = val(b, DF.sort);
    return DF.dir * (typeof x === "string" ? x.localeCompare(y) : x - y) || a.localeCompare(b); });
  const on = (k) => (DF.sort === k ? ` on${DF.dir > 0 ? " asc" : ""}` : "");
  const H = (k, lbl, cls = "", tip = "") => `<th data-k="${k}" class="${cls}${on(k)}"${tip ? ` title="${esc(tip)}"` : ""}>${lbl}</th>`;
  $("df-table").querySelector("thead").innerHTML = "<tr>" + H("tm", "Team", "l") +
    H("G", "vs Guards", "grp", "Rank vs guards: 1 = allows the fewest fantasy points") + H("F", "vs Forwards", "", "Rank vs forwards") + H("C", "vs Centres", "", "Rank vs centres") +
    H("pace", "Pace", "grp", "Possessions per 48 minutes in their games vs the league (100% = average); faster = more chances for everyone") +
    H("fgp", "Opp FG%", "", "Field-goal % opponents shoot against them vs the league (100% = average); higher = softer") +
    '<th class="l grp">Next game</th>' + H("n", "Games") + "</tr>";
  const cell = (t, c) => { const k = R[c][t]; return `<td class="${c === "G" ? "grp" : ""}" title="${esc(dvpTip(t, c))}"><span class="dvp ${dvpCls(k)}">${ordinal(k)}</span> <span class="dim">${Math.round(mf[t][c] * 100)}%</span></td>`; };
  const pct = (v) => Math.round(v * 1000) / 10 + "%";
  $("df-table").querySelector("tbody").innerHTML = rows.map((t) => {
    const g = nxt[t];
    return `<tr><td class="l df-team">${teamLogo(t)}<span class="name"><span class="sc-full">${esc(TEAM_NAMES[t] || t)}</span><span class="sc-ab">${esc(t)}</span></span></td>` +
      cell(t, "G") + cell(t, "F") + cell(t, "C") +
      `<td class="grp" title="${ordinal(RP[t])} slowest of ${T.length}">${pct(mf[t].pace)}</td>` +
      `<td title="${ordinal(RF[t])} stingiest of ${T.length}" class="${mf[t].fgp >= 1.03 ? "pos-up" : mf[t].fgp <= 0.97 ? "pos-dn" : ""}">${pct(mf[t].fgp)}</td>` +
      `<td class="l grp dim">${g ? `${g[0] === today ? "Tonight" : new Date(g[0] + "T12:00:00").toLocaleDateString(undefined, {weekday: "short"})} ${g[2] ? "vs" : "@"} ${esc(g[1])}` : ""}</td>` +
      `<td class="dim">${mf[t].n}</td></tr>`;
  }).join("");
  const missing = Object.keys(TEAM_NAMES).filter((t) => !mf[t]);
  $("df-lede").innerHTML = `Fantasy points each team gives up per game to <strong>guards</strong>, <strong>forwards</strong> and <strong>centres</strong>, ` +
    `scored under the default league, season to date. Rank 1 = gives up the fewest (toughest matchup), ${R.n} = the most (easiest). ` +
    `The Waivers tab shows the same rank on every game chip, against the player&rsquo;s position.`;
  $("df-note").innerHTML = `Position = each player&rsquo;s first ESPN position (PG/SG guards, SF/PF forwards, C centres). ` +
    `Teams need 5 games to be ranked${missing.length ? ` (${missing.join(", ")} not yet)` : ""}. Early in the season one big night moves a team a lot. ` +
    `These ranks are for reading; the matchup number on Waivers / My week (±FP) is the tested adjustment that combines position, pace, opponents&rsquo; FG% and home court.`;
}
function bindDefence() {
  $("df-table").querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (!th) return;
    const k = th.dataset.k;
    DF.dir = DF.sort === k ? -DF.dir : (k === "tm" ? 1 : -1);
    DF.sort = k;
    renderDefence();
  });
}

// =============================================================== SCHEDULE
// Every NBA team's games in one fantasy week (Mon-Sun): "@ORL" = at Orlando,
// "ORL" = home vs Orlando; plus the next week's Monday and Tuesday, as on
// Hashtag Basketball's schedule grid (owner, 2026-11-04).
const TEAM_NAMES = {ATL: "Atlanta Hawks", BKN: "Brooklyn Nets", BOS: "Boston Celtics", CHA: "Charlotte Hornets", CHI: "Chicago Bulls",
  CLE: "Cleveland Cavaliers", DAL: "Dallas Mavericks", DEN: "Denver Nuggets", DET: "Detroit Pistons", GSW: "Golden State Warriors",
  HOU: "Houston Rockets", IND: "Indiana Pacers", LAC: "LA Clippers", LAL: "Los Angeles Lakers", MEM: "Memphis Grizzlies",
  MIA: "Miami Heat", MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves", NOP: "New Orleans Pelicans", NYK: "New York Knicks",
  OKC: "Oklahoma City Thunder", ORL: "Orlando Magic", PHI: "Philadelphia 76ers", PHX: "Phoenix Suns", POR: "Portland Trail Blazers",
  SAC: "Sacramento Kings", SAS: "San Antonio Spurs", TOR: "Toronto Raptors", UTA: "Utah Jazz", WAS: "Washington Wizards"};
const SC = {week: null, days: new Set(), sort: "tm", dir: 1};
function renderSchedule() {
  const W = META.weeks, today = todayET();
  if (SC.week == null || !W.some((w) => w[0] === SC.week)) {
    const cur = W.find((w) => w[1] <= today && today <= w[2]) || W.find((w) => w[2] >= today) || W[W.length - 1];
    SC.week = cur[0];
  }
  const md = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, {month: "short", day: "numeric"});
  const MP = matchupPeriods();
  const wname = (n) => { const p = MP.find((q) => q.weeks.includes(n)); if (!p) return `After the fantasy season`;
    return p.weeks.length > 1 ? `${p.label}, part ${p.weeks.indexOf(n) + 1} of ${p.weeks.length}` : p.label; };
  $("sc-week").innerHTML = W.map((w) => `<option value="${w[0]}"${w[0] === SC.week ? " selected" : ""}>${wname(w[0])}: ${md(w[1])} – ${md(w[2])}` +
    `${w[2] < today ? " · done" : w[1] <= today ? " · now" : ""}</option>`).join("");
  const wk = W.find((w) => w[0] === SC.week);
  const days = [];
  for (let d = wk[1]; d <= wk[2]; d = addDays(d, 1)) days.push(d);
  const extra = [addDays(wk[2], 1), addDays(wk[2], 2)];            // next Monday + Tuesday
  const all = days.concat(extra), ND = days.length;      // a two-week stretch (All-Star break) has 14 days
  const dn = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short"});
  $("sc-days").innerHTML = days.map((d) => `<button type="button" class="chip" data-d="${d}" aria-pressed="${SC.days.has(d)}">${dn(d)}</button>`).join("");
  const game = {};                                                   // team -> date -> [opp, home]
  Object.entries(META.sched).forEach(([tm, gs]) => { game[tm] = {}; gs.forEach(([d, o, h]) => { game[tm][d] = [o, h]; }); });
  const perDay = all.map((d) => Object.keys(game).filter((tm) => game[tm][d]).length / 2);   // two teams per game
  const played = days.map((_, i) => perDay[i]).filter((n) => n > 0);
  const light = played.length ? Math.min(...played) : 0;
  let rows = Object.keys(game).map((tm) => ({tm, n: days.filter((d) => game[tm][d]).length}));
  if (SC.days.size) rows = rows.filter((r) => [...SC.days].every((d) => game[r.tm][d]));
  rows.sort((a, b) => SC.sort === "n" ? SC.dir * (a.n - b.n) || a.tm.localeCompare(b.tm)
    : SC.sort === "tm" ? SC.dir * (TEAM_NAMES[a.tm] || a.tm).localeCompare(TEAM_NAMES[b.tm] || b.tm)
    : SC.dir * ((game[a.tm][SC.sort] ? 1 : 0) - (game[b.tm][SC.sort] ? 1 : 0)) || a.tm.localeCompare(b.tm));
  const on = (k) => (SC.sort === k ? ` on${SC.dir > 0 ? " asc" : ""}` : "");
  // column classes: alternate shading, a heavier line where next week starts, today outlined
  const cc = (d, i) => `sc-d${i % 2 ? " alt" : ""}${i >= ND ? " sc-next" : ""}${i === ND ? " wkb" : ""}${d < today ? " past" : ""}${d === today ? " today" : ""}`;
  $("sc-table").querySelector("thead").innerHTML = `<tr><th class="l${on("tm")}" data-k="tm">Team</th><th class="sc-gc${on("n")}" data-k="n" title="Games this week (Mon–Sun)"><span class="sc-full">Games</span><span class="sc-ab">G</span></th>` +
    all.map((d, i) => `<th class="${cc(d, i)}${on(d)}" data-k="${d}" title="Click to sort by who plays this day">` +
      `<span class="sc-tag">${d === today ? "Today" : i >= ND ? "Next wk" : "&nbsp;"}</span><span class="sc-dn">${dn(d)}</span><span class="sc-dt">${d.slice(5).replace("-", "/")}</span></th>`).join("") + "</tr>" +
    `<tr class="sc-tot"><th class="l"><span class="sc-full">Games that day</span><span class="sc-ab">Per day</span></th><th class="sc-gc"></th>` +
    perDay.map((n, i) => `<th class="${cc(all[i], i)}"><span class="${i < ND && n && n === light ? "sc-lt" : ""}">${n}</span></th>`).join("") + "</tr>";
  $("sc-table").querySelector("tbody").innerHTML = rows.map((r) => `<tr><td class="l sc-team">${teamLogo(r.tm)}<span class="name"><span class="sc-full">${esc(TEAM_NAMES[r.tm] || r.tm)}</span><span class="sc-ab">${esc(r.tm)}</span></span></td>` +
    `<td class="sc-gc"><span class="sc-gn${r.n >= 4 ? " hi" : r.n <= 2 ? " lo" : ""}">${r.n}</span></td>` +
    all.map((d, i) => { const g = game[r.tm][d];
      return `<td class="${cc(d, i)}${SC.days.has(d) ? " sel" : ""}">` +
        (g ? `<span class="sc-g ${g[1] ? "h" : "a"}" title="${esc(`${TEAM_NAMES[r.tm]} ${g[1] ? "vs" : "at"} ${TEAM_NAMES[g[0]] || g[0]} (${g[1] ? "home" : "away"})`)}">` +
          `${teamLogo(g[0]).replace('class="sp-logo"', 'class="sp-logo sc-ol"')}${g[1] ? "" : "<i>@</i>"}${esc(g[0])}</span>` : `<span class="sc-no">–</span>`) + "</td>"; }).join("") + "</tr>").join("") ||
    `<tr><td class="l dim" colspan="${all.length + 2}">No team plays on all of those days.</td></tr>`;
  $("sc-count").textContent = SC.days.size ? `${rows.length} of 30 teams play on all of ${[...SC.days].sort().map(dn).join(", ")}` : "";
  $("sc-note").textContent = "The last two columns are the start of next week, for planning a pickup that carries over. Click a column heading to sort; " +
    "click a day under “Plays on” to list only the teams that play that day (pick several for teams that play on all of them).";
}
function bindSchedule() {
  $("sc-week").addEventListener("change", (e) => { SC.week = +e.target.value; SC.days.clear(); renderSchedule(); });
  $("sc-days").addEventListener("click", (e) => {
    const c = e.target.closest(".chip[data-d]");
    if (!c) return;
    if (SC.days.has(c.dataset.d)) SC.days.delete(c.dataset.d); else SC.days.add(c.dataset.d);
    renderSchedule();
  });
  $("sc-table").querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (!th) return;
    const k = th.dataset.k;
    if (SC.sort === k) SC.dir = -SC.dir; else { SC.sort = k; SC.dir = k === "tm" ? 1 : -1; }
    renderSchedule();
  });
}

// ================================================================ ROUTING
const TABS = ["league", "proj", "insea", "wire", "recap", "live", "week", "trade", "sched", "def", "how"];
// ================================================================== LIVE
// A fantasy matchup as it happens, player by player. Points are ESPN's own
// (the league feed's per-day stats for each roster, view=mMatchupScore +
// mScoreboard with scoringPeriodId = the day, which ESPN updates during games);
// game clocks and scores come from ESPN's NBA scoreboard. What is still to
// come = our projection: a game not started counts its full projected value,
// a game in progress the share of 48 minutes left, a finished game nothing;
// days after today = My week's best lineup. ESPN leagues only.
const LV = {day: null, pair: null, j: null, sb: null, at: 0, prev: {}, timer: null, busy: null, err: ""};
const LV_SLOT_ORDER = (s) => (s === 12 ? 100 : s === 13 ? 101 : s);
function liveFetch() {
  // one request at a time: share it (and fetch again if the day changed meanwhile)
  if (LV.busy) return LV.busy.then(() => (LV.j && LV.P === espnPeriod(LV.day) ? null : liveFetch()));
  if (!LV.day) return Promise.resolve();
  const day = LV.day, P = espnPeriod(day);
  const lgP = fetch(espnBase() + L.id + "?view=mMatchupScore&view=mScoreboard&scoringPeriodId=" + P, {cache: "no-store"})
    .then((r) => { if (!r.ok) throw new Error("ESPN answered " + r.status); return r.json(); });
  return (LV.busy = Promise.all([lgP, espnSite("scoreboard", "dates=" + day.replace(/-/g, ""))]).then(([j, sb]) => {
    if (LV.day !== day) return;
    if (LV.j) LV.prev = liveFPMap(LV.j, P);
    LV.j = j; LV.sb = sb; LV.at = Date.now(); LV.P = P; LV.err = "";
  }).catch((e) => { LV.err = e.message || "ESPN did not answer"; }).finally(() => { LV.busy = null; }));
}
function liveFPMap(j, P) {
  const m = {};
  (j.schedule || []).forEach((x) => ["home", "away"].forEach((k) => {
    const s = x[k]; if (!s || !s.rosterForCurrentScoringPeriod) return;
    s.rosterForCurrentScoringPeriod.entries.forEach((e) => { const st = liveStat(e, P); if (st) m[e.playerId] = st.appliedTotal || 0; });
  }));
  return m;
}
function liveStat(e, P) {
  const pl = ((e.playerPoolEntry || {}).player) || {};
  return (pl.stats || []).find((s) => s.scoringPeriodId === P && s.statSourceId === 0 && s.statSplitTypeId === 5) || null;
}
// the NBA game a pro team plays that day: {state pre|in|post, detail, period, clock, us, them, opp, home, left (share of 48 min)}
function liveGames() {
  const G = {};
  ((LV.sb && LV.sb.events) || []).forEach((e) => {
    const c = e.competitions[0], st = e.status || {}, ty = st.type || {};
    const T = (t) => ETRI[t.team.abbreviation] || t.team.abbreviation;
    const per = st.period || 0, clk = st.clock != null ? st.clock : 720;
    const done = per <= 4 ? (per - 1) * 720 + (720 - clk) : 2880;
    const left = ty.state === "pre" ? 1 : ty.state === "post" ? 0 : Math.max(0, 2880 - Math.max(0, done)) / 2880;
    c.competitors.forEach((t) => {
      const o = c.competitors.find((x) => x !== t);
      G[+t.team.id] = {id: +e.id, state: ty.state, detail: ty.shortDetail || "", tip: Date.parse(e.date), period: per,
        tm: T(t), opp: T(o), home: t.homeAway === "home", us: +t.score || 0, them: +o.score || 0, left};
    });
  });
  return G;
}
function liveSide(side, G, P, lg, today) {
  const rows = side.rosterForCurrentScoringPeriod.entries.map((e) => {
    const pl = ((e.playerPoolEntry || {}).player) || {}, id = e.playerId, p = BYID[id];
    const st = liveStat(e, P), s = (st && st.stats) || {};
    const g = G[pl.proTeamId] || null;
    const fp = st ? st.appliedTotal || 0 : 0;
    const starter = e.lineupSlotId !== 12 && e.lineupSlotId !== 13;
    // our projection for his game that day (My week's per-game value)
    let proj = 0, v = 0, sd2 = 0;
    if (p && g) {
      const dv = dayVals(p, [LV.day], false, (d, sp) => !outOn(p, d) && sp >= 0.05)[0];
      if (dv && dv.avail) { proj = dv.val; v = dv.v || dv.val; sd2 = dv.sd2 || 0; }
    }
    const played = (s[40] || 0) > 0;
    const exp = !g ? 0 : g.state === "post" ? 0 : g.state === "in" ? (played ? v : proj) * g.left : proj;
    return {id, p, n: pl.fullName || (p && p.n) || "#" + id, slot: e.lineupSlotId, starter, inj: pl.injuryStatus, g, s, fp, st: !!st,
      played, proj, exp, var: g && g.state !== "post" ? sd2 * (g.state === "in" ? g.left : 1) : 0,
      bump: LV.prev[id] != null && LV.prev[id] !== fp ? fp - LV.prev[id] : 0};
  }).sort((a, b) => LV_SLOT_ORDER(a.slot) - LV_SLOT_ORDER(b.slot) || b.fp - a.fp);
  const S = rows.filter((r) => r.starter);
  const n = (f) => S.filter(f).length;
  return {rows, teamId: side.teamId, live: (side.totalPointsLive != null ? side.totalPointsLive : side.totalPoints) || 0,
    today: S.reduce((a, r) => a + r.fp, 0), bench: rows.filter((r) => !r.starter && r.slot !== 13).reduce((a, r) => a + r.fp, 0),
    rest: S.reduce((a, r) => a + r.exp, 0), var: S.reduce((a, r) => a + r.var, 0),
    ytp: n((r) => r.g && r.g.state === "pre" && r.proj > 0), ip: n((r) => r.g && r.g.state === "in"), done: n((r) => r.g && r.g.state === "post")};
}
function renderLive() {
  const lg = LGRES[L.id];
  const box = $("lv-main");
  if (L.platform !== "espn" || !/^\d+$/.test(L.id || "")) { box.innerHTML = rosterMsg("Live"); $("lv-ctl").hidden = true; return; }
  $("lv-ctl").hidden = false;
  if (!lg) {
    box.innerHTML = LV.lgFail ? '<p class="note pos-dn">ESPN did not return your league. Press Update now to try again.</p>' : '<p class="note">Loading your league from ESPN&hellip;</p>';
    if (!LV.lgP && !LV.lgFail) LV.lgP = espnLeague(L).then((d) => { LV.lgP = null; LV.lgFail = !d; if (!$("tab-live").hidden) renderLive(); });
    return;
  }
  const today = todayET();
  const per = matchupPeriods().find((p) => p.start <= today && today <= p.end) || matchupPeriods().find((p) => p.end >= today);
  if (!per) { box.innerHTML = '<p class="note">No matchup this week.</p>'; return; }
  const days = [];
  for (let d = per.start; d <= per.end; d = addDays(d, 1)) days.push(d);
  if (!LV.day || !days.includes(LV.day) || LV.day > today) LV.day = days.includes(today) ? today : days[0];
  $("lv-day").innerHTML = days.filter((d) => d <= today).map((d) => `<option value="${d}"${d === LV.day ? " selected" : ""}>${d === today ? "Today, " : ""}${new Date(d + "T12:00:00").toLocaleDateString(undefined, {weekday: "short", month: "short", day: "numeric"})}</option>`).join("");
  if (!LV.j || LV.P !== espnPeriod(LV.day)) {
    box.innerHTML = LV.err ? `<p class="note pos-dn">${esc(LV.err)}</p>` : '<p class="note">Loading the live matchup from ESPN&hellip;</p>';
    if (!LV.err && !LV.loadP) LV.loadP = Promise.all([liveFetch(), loadReturns(lg)]).then(() => {
      LV.loadP = null;
      if (!LV.j && !LV.err) LV.err = "ESPN did not return this day's matchups";
      if (!$("tab-live").hidden) renderLive();
    });
    return;
  }
  const P = LV.P, G = liveGames(), isToday = LV.day === today;
  const ms = (LV.j.schedule || []).filter((m) => m.home && m.away && m.home.rosterForCurrentScoringPeriod && m.away.rosterForCurrentScoringPeriod);
  if (!ms.length) { box.innerHTML = '<p class="note">ESPN shows no matchups with rosters for this day.</p>'; return; }
  const mt = myTeam(), pairOf = (m) => [m.away.teamId, m.home.teamId];
  if (!LV.pair || !ms.some((m) => pairOf(m).join() === LV.pair.join())) {
    const mine = ms.find((m) => m.home.teamId === mt || m.away.teamId === mt);
    LV.pair = pairOf(mine || ms[0]);
  }
  // rest of the week after today: My week's best lineup per day
  const SLOTS = starterSlots();
  const after = days.filter((d) => d > today);
  const fut = (tid) => {
    if (!after.length || !isToday) return {pts: 0, var: 0};
    const T = teamWeek(lg, tid, days, per.id, SLOTS, today);
    let pts = 0, v = 0;
    days.forEach((d, i) => { if (d > today) { pts += T.days[i].pts; T.ps.forEach((r) => { if (r.days[i].st) v += r.days[i].sd2; }); } });
    return {pts, var: v};
  };
  const all = ms.map((m) => {
    const A = liveSide(m.away, G, P, lg, today), H = liveSide(m.home, G, P, lg, today);
    [A, H].forEach((X) => { const f = fut(X.teamId); X.fut = f.pts;
      X.final = X.live + (isToday ? X.rest : 0) + X.fut; X.fvar = X.var + f.var; });
    const sd = Math.sqrt(A.fvar + H.fvar);
    A.win = sd > 0 ? normCdf((A.final - H.final) / sd) : (A.final > H.final ? 1 : A.final < H.final ? 0 : .5); H.win = 1 - A.win;
    return {m, A, H, key: pairOf(m).join()};
  });
  const cur = all.find((x) => x.key === LV.pair.join());
  const tn = (id) => esc((lg.byId[id] || {}).name || "Team " + id);
  // ---- strip of every matchup (click to switch)
  const strip = `<div class="lv-strip">${all.map((x) => `<button class="lv-mini${x === cur ? " sel" : ""}${[x.A.teamId, x.H.teamId].includes(mt) ? " mine" : ""}" data-pair="${x.key}">` +
    `<span class="tn">${tn(x.A.teamId)}</span><b>${fx(x.A.live, 0)}</b><span class="tn">${tn(x.H.teamId)}</span><b>${fx(x.H.live, 0)}</b></button>`).join("")}</div>`;
  // ---- the score
  // score header (owner 11-14: keep the format, make it better): the live score, a bar of what's banked against
  // the projected final, and the starters playing / still to play / done as pills
  const sideHead = (X, cls) => {
    const fin = isToday && X.final > 0 ? X.final : null, pct = fin ? Math.min(100, X.live / fin * 100) : 0;
    return `<div class="lv-sc ${cls}"><div class="lv-tn${X.teamId === mt ? " mine" : ""}"><i class="lv-sw ${cls}"></i>${tn(X.teamId)}${X.teamId === mt ? ' <span class="tag rk">YOU</span>' : ""}</div>` +
      `<div class="lv-big">${fx(X.live, 0)}</div>` +
      (fin ? `<div class="lv-pbar" title="${esc(`Banked ${fx(X.live, 0)} of a projected ${fx(fin, 0)} (live score + still to come today + the best lineup on the days left)`)}"><i style="width:${pct.toFixed(1)}%"></i></div>` : "") +
      `<div class="lv-sub"><span title="Points in starter slots ${isToday ? "today" : "that day"} (ESPN's live total)"><b>${fx(X.today, 0)}</b> ${isToday ? "today" : "that day"}</span>` +
      (fin ? ` <span class="sep">·</span> <span title="Projected final for the matchup">proj <b>${fx(fin, 0)}</b></span>` : "") + "</div>" +
      `<div class="lv-cnt" title="Starters ${isToday ? "today" : "that day"}: in progress / yet to play / done">` +
      (X.ip ? `<span class="pl ip"><i></i>${X.ip} playing</span>` : "") + (X.ytp ? `<span class="pl">${X.ytp} to play</span>` : "") + (X.done ? `<span class="pl dn">${X.done} done</span>` : "") +
      "</div></div>";
  };
  const wbar = isToday ? `<div class="wrow lv-w" title="Rough win chance: projected final margin against the spread of the games still to come (normal approximation, games independent; untested as a probability)"><b class="wa">${Math.round(cur.A.win * 100)}%</b>` +
    `<div class="wbar"><span class="a" style="width:${(cur.A.win * 100).toFixed(0)}%"></span><span class="h"></span></div><b class="wh">${Math.round(cur.H.win * 100)}%</b></div>` : "";
  const score = `<div class="card lv-score">${sideHead(cur.A, "a")}<div class="lv-vs">${(() => { const d = cur.A.live - cur.H.live, ld = d > 0 ? cur.A : cur.H;
    return Math.round(d) === 0 ? '<b>tied</b>' : `<span class="dim">${ld.teamId === mt ? "you lead by" : tn(ld.teamId) + " by"}</span><b>${fx(Math.abs(d), 0)}</b>`; })()}</div>${sideHead(cur.H, "h")}${wbar}</div>`;
  // ---- NBA games that day with this matchup's players in them
  const own = {};
  [cur.A, cur.H].forEach((X, k) => X.rows.forEach((r) => { if (r.g && r.starter) { const o = own[r.g.id] = own[r.g.id] || [0, 0]; o[k]++; } }));
  const evs = Object.values(G).filter((g) => g.home).sort((a, b) => a.tip - b.tip || a.id - b.id);
  const games = evs.length ? `<div class="lv-games">${evs.map((g) => { const o = own[g.id] || [0, 0];
    return `<div class="lv-g ${g.state}${o[0] + o[1] ? "" : " none"}" title="${esc(`${g.opp} @ ${g.tm}: ${g.detail}\nStarters in this game: ${tn(cur.A.teamId).replace(/&amp;/g, "&")} ${o[0]}, ${tn(cur.H.teamId).replace(/&amp;/g, "&")} ${o[1]}`)}">` +
      `<span>${teamLogo(g.opp)}${g.opp} <b>${g.state === "pre" ? "" : g.them}</b></span><span>${teamLogo(g.tm)}${g.tm} <b>${g.state === "pre" ? "" : g.us}</b></span>` +
      `<span class="st">${esc(g.state === "pre" ? new Date(g.tip).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"}) : g.detail)}</span>` +
      `<span class="ow"><i class="sw a"></i>${o[0]} <i class="sw h"></i>${o[1]}</span></div>`; }).join("")}</div>` : "";
  // ---- both rosters
  const gameCell = (r) => {
    const g = r.g;
    if (!g) return '<span class="dim">no game</span>';
    const vs = `${g.home ? "vs" : "@"} ${g.opp}`;
    if (g.state === "pre") return vs;
    const res = g.state === "post" ? `<b class="${g.us > g.them ? "pos-up" : "pos-dn"}">${g.us > g.them ? "W" : "L"}</b> ` : "";
    return `${vs} · ${res}${g.us}-${g.them}`;
  };
  // the game's state as a small pill next to his points: tip time, the clock, or Final
  const statePill = (r) => {
    const g = r.g;
    if (!g || !isToday) return "";                       // past days: every game is final, no pill needed
    if (g.state === "pre") return `<span class="lv-st pre">${new Date(g.tip).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"})}</span>`;
    if (g.state === "in") return `<span class="lv-st in"><i></i>${esc(g.detail.replace(/ - /, " "))}</span>`;
    return '<span class="lv-st fin">Final</span>';
  };
  const line = (r) => {
    if (!r.st || !r.played) return r.g && r.g.state !== "pre" ? '<span class="dim">' + (r.g.state === "post" ? "did not play" : "not in yet") + "</span>" : "";
    const s = r.s, k = (i) => Math.round(s[i] || 0);
    return `<span class="lv-ln">${k(40)} min · <b>${k(0)}</b> pts ${k(6)} reb ${k(3)} ast` +
      (k(2) ? ` ${k(2)} stl` : "") + (k(1) ? ` ${k(1)} blk` : "") + (k(11) ? ` ${k(11)} to` : "") +
      ` · ${k(13)}-${k(14)} FG${k(17) ? `, ${k(17)} 3PM` : ""}${k(16) ? `, ${k(15)}-${k(16)} FT` : ""}</span>`;
  };
  // points so far against the projection, on a scale that runs past it (a player can
  // beat his projection): the projection sits at 2/3 of the bar unless he passes it
  const bar = (r) => {
    if (!r.g || !(r.proj > 0 || r.fp > 0)) return "";
    const fp = Math.max(0, r.fp), live = isToday && r.g.state !== "post", end = live ? fp + r.exp : fp;
    const max = Math.max(r.proj * 1.5, end * 1.1, fp * 1.1, 10), pc = (v) => (Math.min(v, max) / max * 100).toFixed(1) + "%";
    const over = r.proj > 0 && fp >= r.proj;
    return `<div class="lv-pb${r.g.state === "pre" ? " pre" : ""}"><div class="lv-tr">` +
      (live && end > fp + 0.5 ? `<i class="lv-ex${fp <= 0 ? " st0" : ""}" style="left:${pc(fp)};width:${pc(end - fp)}" title="Still to come (estimate): about ${fx(end, 0)} by the end"></i>` : "") +
      `<i class="lv-cur${over ? " over" : ""}" style="width:${pc(fp)}"></i>` +
      (r.proj > 0 ? `<b class="lv-tk" style="left:${pc(r.proj)}"></b><span class="lv-tl" style="left:${pc(r.proj)}">proj ${fx(r.proj, 0)}</span>` : "") +
      `</div></div>`;
  };
  // fantasy points broken down by stat under the league's scoring (owner 11-14: "click a player to see what
  // his score is made of"). ESPN's stat ids -> our stats; anything ESPN scores that we don't model shows as
  // "other" (the gap to ESPN's own total)
  const BD_ID = {PTS: 0, FGM: 13, FGA: 14, FTM: 15, FTA: 16, FG3M: 17, REB: 6, OREB: 4, AST: 3, STL: 2, BLK: 1, TOV: 11};
  const bdown = (r) => {
    const s2 = r.s || {}, items = [];
    STATS.forEach((k) => { const w = (L.w || {})[k] || 0, n = +s2[BD_ID[k]] || 0; if (w && n) items.push({k: STAT_LBL[k] || k, n, w, v: n * w}); });
    [["DD", 37, "Double-double"], ["TD", 38, "Triple-double"], ["QD", 39, "Quadruple-double"]].forEach(([k, id, nm]) => {
      const w = (L.b || {})[k] || 0, n = +s2[id] || 0; if (w && n) items.push({k: nm, n, w, v: n * w, bonus: true}); });
    const sum = items.reduce((a, x) => a + x.v, 0), gap = (r.fp || 0) - sum;
    if (Math.abs(gap) >= 0.05) items.push({k: "Other scoring", n: null, w: null, v: gap});
    const pos = items.filter((x) => x.v > 0).sort((a, b) => b.v - a.v), neg = items.filter((x) => x.v < 0).sort((a, b) => a.v - b.v);
    const tp = pos.reduce((a, x) => a + x.v, 0), tn2 = neg.reduce((a, x) => a + x.v, 0), tot = tp + tn2 || 1;
    const chip = (x) => `<span class="bd-c ${x.v > 0 ? "p" : "n"}"><b>${esc(x.k)}</b>${x.n != null ? `<span>${x.n} × ${x.w}</span>` : ""}<em>${sg(x.v, x.v % 1 ? 1 : 0)}</em></span>`;
    const scale = Math.max(tp, 1);
    return `<div class="lv-bd"><div class="bd-bar" title="${esc(`Points earned ${fx(tp, 1)}, points lost ${fx(-tn2, 1)}`)}">` +
      pos.map((x) => `<i class="p" style="width:${(x.v / scale * 100).toFixed(1)}%" title="${esc(x.k)}: ${sg(x.v, 1)}"></i>`).join("") + "</div>" +
      (neg.length ? `<div class="bd-bar neg">${neg.map((x) => `<i class="n" style="width:${(-x.v / scale * 100).toFixed(1)}%" title="${esc(x.k)}: ${sg(x.v, 1)}"></i>`).join("")}</div>` : "") +
      `<div class="bd-chips">${pos.map(chip).join("")}${neg.map(chip).join("")}</div>` +
      `<div class="bd-sum">earned <b class="pos-up">${fx(tp, 1)}</b> · lost <b class="pos-dn">${fx(-tn2, 1)}</b> · <b>${fx(r.fp, 1)} FP</b>${r.proj > 0 ? ` <span class="dim">(projected ${fx(r.proj, 1)})</span>` : ""}</div></div>`;
  };
  const row = (r) => {
    const b = bar(r), canBd = r.st && (r.played || r.fp), open = canBd && LV.open && LV.open.has(r.id);
    return `<tr class="${r.starter ? "" : "bn"}${b ? " hb" : ""}${r.g ? "" : " ng"}${r.g && r.g.state === "in" && r.played ? " on" : ""}${isToday && r.g && r.g.state === "post" ? " done" : ""}${canBd ? " bdok" : ""}${open ? " bdopen" : ""}" data-id="${r.id}"${canBd ? ` data-bd="${r.id}" title="Click for his points, stat by stat"` : ""}>` +
      `<td class="l slt-c">${ESPN_SLOT[r.slot] || (r.slot === 12 ? "BE" : r.slot === 13 ? "IR" : "")}</td>` +
      `<td class="l"><span class="name nm2" data-id="${r.id}">${esc(r.n)}</span> ${r.p ? statusTag({id: r.id, p: r.p, inj: r.inj}, lg).replace('style="margin:0"', 'style="margin:0 0 0 .2rem"') : ""}` +
      `<div class="lv-gm">${r.p ? esc(r.p.tm) + " · " : ""}${gameCell(r)}</div><div>${line(r)}</div></td>` +
      `<td class="lv-fp${r.bump ? (r.bump > 0 ? " up" : " dn") : ""}" title="${esc(`ESPN fantasy points ${isToday ? "so far today" : "that day"}: ${fx(r.fp)}` +
        (r.proj > 0 ? `\nOur projection for this game: ${fx(r.proj)}` + (isToday && r.g && r.g.state !== "post" ? `\nStill to come (estimate): ${fx(r.exp)} → about ${fx(r.fp + r.exp)}` : "") : "") +
        (r.bump ? `\n${sg(r.bump)} since the last update` : "") + (r.starter ? "" : "\nOn the bench: these points don't count"))}">` +
      `<b>${r.g || r.fp ? fx(r.fp, 0) : '<span class="dim">–</span>'}</b>` +
      (isToday && r.g && r.g.state === "in" && r.proj > 0 ? `<span class="sub">≈ ${fx(r.fp + r.exp, 0)}</span>` : "") + statePill(r) + "</td></tr>" +
      (b ? `<tr class="lv-br${r.starter ? "" : " bn"}${isToday && r.g && r.g.state === "post" ? " done" : ""}${canBd ? " bdok" : ""}"${canBd ? ` data-bd="${r.id}"` : ""}><td></td><td colspan="2">${b}</td></tr>` : "") +
      (open ? `<tr class="lv-bdr${r.starter ? "" : " bn"}"><td></td><td colspan="2">${bdown(r)}</td></tr>` : "");
  };
  const tbl = (X) => {
    const S = X.rows.filter((r) => r.starter), B = X.rows.filter((r) => !r.starter);
    return `<div class="card lv-team"><h3>${tn(X.teamId)}</h3><table class="lv-t"><thead><tr><th class="l">Slot</th><th class="l">Player</th><th>FP</th></tr></thead><tbody>` +
      S.map(row).join("") + `<tr class="lv-tot"><td></td><td class="l">Starters</td><td><b>${fx(X.today, 0)}</b></td></tr>` +
      (B.length ? `<tr class="lv-sep"><td class="l" colspan="3">Bench${X.bench ? ` <span class="dim">· ${fx(X.bench, 0)} pts left on the bench</span>` : ""}</td></tr>` + B.map(row).join("") : "") + "</tbody></table></div>";
  };
  box.innerHTML = strip + score + games + `<div class="lv-cols">${tbl(cur.A)}${tbl(cur.H)}</div>`;
  box.querySelectorAll(".lv-mini").forEach((b) => b.addEventListener("click", () => { LV.pair = b.dataset.pair.split(",").map(Number); renderLive(); }));
  box.querySelectorAll("tr[data-bd]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest(".name, .tag, a, button")) return;           // the name still opens his player page
    const id = +tr.dataset.bd;
    LV.open = LV.open || new Set();
    if (LV.open.has(id)) LV.open.delete(id); else LV.open.add(id);
    renderLive();
  }));
  const now = Date.now(), anyLive = evs.some((g) => g.state === "in");
  const pre = evs.filter((g) => g.state === "pre"), due = pre.some((g) => g.tip <= now);   // past tip time, not started yet
  const nextTip = pre.map((g) => g.tip).filter((t) => t > now).sort((a, b) => a - b)[0];
  const hm = (t) => new Date(t).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"});
  $("lv-at").textContent = `Updated ${new Date(LV.at).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit", second: "2-digit"})}` +
    (!isToday ? "" : anyLive ? " · updating every 30 s while games are on" : due ? " · waiting for tip-off" :
      nextTip ? ` · updates start at tip-off (${hm(nextTip)})` : evs.length ? " · all games final" : "");
  liveSchedule(!isToday ? 0 : anyLive ? 30e3 : due ? 60e3 : nextTip ? nextTip - now + 30e3 : 0);
}
function liveSchedule(ms) {
  clearTimeout(LV.timer);
  if (!ms) return;
  LV.timer = setTimeout(() => {
    if ($("tab-live").hidden || document.hidden) return liveSchedule(30e3);   // paused while out of view
    liveFetch().then(() => { if (!$("tab-live").hidden) renderLive(); });
  }, ms);
}
function bindLive() {
  $("lv-day").addEventListener("change", (e) => { LV.day = e.target.value; LV.j = null; LV.prev = {}; LV.err = ""; renderLive(); });
  $("lv-now").addEventListener("click", () => { LV.err = ""; LV.lgFail = false; liveFetch().then(renderLive); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && LV.day && LV.j && !$("tab-live").hidden && LV.day === todayET() && Date.now() - LV.at > 25e3) liveFetch().then(renderLive);
  });
}
function showTab(t) {
  if (!TABS.includes(t)) t = "proj";
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  const nav = document.querySelector(".tabs"), on = nav.querySelector('[aria-selected="true"]');
  if (on) nav.scrollLeft += on.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - on.offsetWidth) / 2;   // phones: active tab in view
  TABS.forEach((k) => { $("tab-" + k).hidden = k !== t; });
  if (location.hash !== "#" + t) history.replaceState(null, "", "#" + t);
  if (t === "recap") renderRecap();
  if (t === "wire") renderWaivers();
  if (t === "insea") renderInseason();
  if (t === "week") renderWeek();
  if (t === "live") {                 // back on the tab: read once if the last read is old, then follow the games
    if (LV.j && LV.day === todayET() && Date.now() - LV.at > 25e3) liveFetch().then(renderLive); else renderLive();
  } else liveSchedule(0);
  if (t === "trade") renderTrade();
  if (t === "sched") renderSchedule();
  if (t === "def") renderDefence();
  setTimeout(() => { markSticky(); fitLedes(); });   // a panel just shown has real heights now
}
function renderAll() {
  renderProj();
  if (!$("tab-recap").hidden) renderRecap();
  if (!$("tab-wire").hidden) renderWaivers();
  if (!$("tab-insea").hidden) renderInseason();
  if (!$("tab-week").hidden) renderWeek();
  if (!$("tab-live").hidden) renderLive();
  if (!$("tab-trade").hidden) renderTrade();
}

// ============================================================ PHONES
// Wide tables keep the player column on screen while they scroll sideways
// (the column holding the first row's player name gets .stk); long intros
// clamp to three lines on phones with a More/Less link; each key folds into
// a "Key" line on phones. Re-applied after every render via one observer.
// player thumbnails + team logos on every board, added after each render
// (one pass, idempotent): a .name / .nm with a player id gets a headshot; a
// cell or small label holding a team code ("LAL", "LAL · PF") gets the logo.
// Cards that draw their own pictures (planner, start/sit) and the schedule
// grid are left alone.
const PIC_SKIP = ".sp-card, .ss-card, #sc-table, .sp-alt, .sp-team, #df-table";
function addPics(root) {
  root.querySelectorAll(".name:not([data-pic]), .nm:not([data-pic])").forEach((el) => {
    el.dataset.pic = "1";
    if (el.closest(PIC_SKIP)) return;
    const tr = el.closest("tr[data-id]");
    const id = el.dataset.id || (tr ? tr.dataset.id : "");
    if (!/^\d+$/.test(id || "")) return;
    const img = document.createElement("img");
    img.className = "pth"; img.alt = ""; img.loading = "lazy";
    img.src = `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=64&h=48&scale=crop`;
    img.onerror = () => { img.style.visibility = "hidden"; };
    el.prepend(img);
  });
  root.querySelectorAll("td:not([data-pic]), span.dim:not([data-pic]), span.sub:not([data-pic]), span.sp-tm:not([data-pic])").forEach((el) => {
    el.dataset.pic = "1";
    if (el.children.length || el.closest(PIC_SKIP)) return;
    const m = /^([A-Z]{2,4})(\s*(·|$))/.exec(el.textContent.trim());
    if (!m || !TEAM_NAMES[m[1]]) return;
    el.insertAdjacentHTML("afterbegin", teamLogo(m[1]).replace('class="sp-logo"', 'class="sp-logo tl"'));
  });
}
function markSticky() {
  document.querySelectorAll(".tablewrap table").forEach((tb) => {
    const row = tb.tBodies[0] && [...tb.tBodies[0].rows].find((r) => r.querySelector(".name"));
    if (!row) return;
    const i = [...row.cells].findIndex((c) => c.classList.contains("name") || c.querySelector(".name"));
    if (i < 0) return;
    for (const r of tb.rows) {
      if (r.cells.length !== row.cells.length) continue;   // section / total rows span differently
      r.cells[i].classList.add("stk");
    }
  });
}
function fitLedes() {
  document.querySelectorAll(".lede").forEach((el) => {
    let b = el.nextElementSibling;
    if (!b || !b.classList.contains("ledemore")) {
      b = document.createElement("button");
      b.type = "button"; b.className = "ledemore";
      b.addEventListener("click", () => { el.classList.toggle("open"); fitLedes(); });
      el.after(b);
    }
    const open = el.classList.contains("open");
    const show = open || el.scrollHeight > el.clientHeight + 2;
    if (b.hidden === show) b.hidden = !show;
    const txt = open ? "Less" : "More";
    if (b.textContent !== txt) b.textContent = txt;
  });
}
function initPhone() {
  document.querySelectorAll(".legend").forEach((lg) => {
    const h = document.createElement("button");
    h.type = "button"; h.className = "lg-head"; h.textContent = "Key ▸";
    h.addEventListener("click", () => { h.textContent = lg.classList.toggle("open") ? "Key ▾" : "Key ▸"; });
    lg.prepend(h);
  });
  const nav = document.querySelector(".tabs");
  const edge = () => nav.classList.toggle("end", nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 4);
  nav.addEventListener("scroll", edge, {passive: true});
  let q = 0;
  const run = () => { q = 0; addPics(document.querySelector("main")); markSticky(); fitLedes(); edge(); };
  // a timer, not requestAnimationFrame: frames pause in a hidden tab and the marks would never land
  new MutationObserver(() => { if (!q) q = setTimeout(run); })
    .observe(document.querySelector("main"), {childList: true, subtree: true});
  window.addEventListener("resize", () => { if (!q) q = setTimeout(run); });
  run();
}

// ============================================================ HOVER BOXES
// Every element with a title gets a styled box instead of the browser's plain
// tooltip (multi-line text, placed above or below to stay on screen). On a
// touch screen a tap on a tag or chip shows it instead of opening the row.
function initTips() {
  const tip = document.createElement("div");
  tip.className = "tip"; tip.hidden = true; tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  let cur = null;
  const hide = () => { tip.hidden = true; cur = null; };
  const show = (el) => {
    if (el.hasAttribute("title")) { el.dataset.tip = el.getAttribute("title"); el.removeAttribute("title"); }
    const t = el.dataset.tip;
    if (!t) return;
    cur = el;
    tip.textContent = t;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, m = 8;
    let x = Math.min(Math.max(m, r.left + r.width / 2 - w / 2), window.innerWidth - w - m);
    let y = r.bottom + 6;
    if (y + h > window.innerHeight - m) y = Math.max(m, r.top - h - 6);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  };
  const target = (e) => e.target.closest && e.target.closest("[title],[data-tip]");
  document.addEventListener("mouseover", (e) => {
    const el = target(e);
    if (!el || el.matches("input,select,textarea,option,iframe")) { if (!el) hide(); return; }
    if (el !== cur) show(el);
  });
  document.addEventListener("mouseout", (e) => { if (cur && !(e.relatedTarget && cur.contains(e.relatedTarget))) hide(); });
  document.addEventListener("scroll", hide, true);
  if (window.matchMedia("(hover: none)").matches) {
    document.addEventListener("click", (e) => {
      const el = e.target.closest(".tag, .gch, [data-tip-tap]");
      if (el && (el.hasAttribute("title") || el.dataset.tip)) {
        e.stopPropagation(); e.preventDefault();
        if (cur === el) hide(); else show(el);
      } else hide();
    }, true);
  }
}

// =============================================================== REFRESH
// The button re-reads everything the site publishes (stats, projections,
// the hourly official injury report) and the visitor's live ESPN league.
// New box scores come from the cloud build; if the owner saved a GitHub
// token (League tab), the button also starts that build and reloads the
// data when it has published.
const GH = {repo: "gwhenderson-dev/fantasy-nba", workflow: "refresh.yml", key: "fnba.v2.ghtoken"};
const ghToken = () => { try { return localStorage.getItem(GH.key) || ""; } catch (e) { return ""; } };
const refMsg = (html) => { $("refmsg").innerHTML = html; };
const clock = () => new Date().toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"});
function reloadData() {
  DATA_V = "?t=" + Date.now();
  return fetchData(true).then((d) => {
    applyData(d);
    GAMES = GAMES_P = null; RECAP = RECAP_P = null; LIVE_AT = {};
    Object.keys(LGDATA).forEach((k) => delete LGDATA[k]);
    Object.keys(LGRES).forEach((k) => delete LGRES[k]);
    Object.keys(LOCK).forEach((k) => delete LOCK[k]);
    WL.at = 0;                                          // My week: re-read tonight's lineups and game states
    Object.keys(TIPP).forEach((k) => delete TIPP[k]);
    SP.pick = null; SP.key = null;                     // drop candidates re-picked from the new roster
    Object.assign(WK, {mm: null, mmP: null});
    renderAll();
    loadReturns2().then(renderAll);
    return refreshLeagueData();                        // rosters + adds used, so "Updated" means they are in
  });
}
function startRebuild(tok) {
  const api = `https://api.github.com/repos/${GH.repo}/actions/workflows/${GH.workflow}`;
  const H = {Authorization: "Bearer " + tok, Accept: "application/vnd.github+json"};
  const t0 = Date.now() - 5000;
  return fetch(api + "/dispatches", {method: "POST", headers: H, body: JSON.stringify({ref: "main"})}).then((r) => {
    if (r.status !== 204) throw new Error(r.status === 401 || r.status === 403 ? "the saved GitHub token was refused" : "GitHub answered " + r.status);
    refMsg("Fresh stats: build started &hellip;");
    return new Promise((resolve, reject) => {
      let tries = 0;
      const poll = () => fetch(api + "/runs?event=workflow_dispatch&per_page=1", {headers: H}).then((x) => x.json()).then((j) => {
        const run = (j.workflow_runs || [])[0];
        if (run && Date.parse(run.created_at) >= t0) {
          if (run.status === "completed") {
            if (run.conclusion !== "success") return reject(new Error("the build " + run.conclusion));
            refMsg("Fresh stats: built, publishing &hellip;");
            return setTimeout(resolve, 75000);              // GitHub Pages deploy
          }
          refMsg(`Fresh stats: building (${run.status}) &hellip;`);
        }
        if (++tries > 40) return reject(new Error("the build is taking longer than 13 minutes"));
        setTimeout(poll, 20000);
      }).catch(reject);
      setTimeout(poll, 8000);
    });
  });
}
function bindRefresh() {
  $("refresh").addEventListener("click", () => {
    const btn = $("refresh");
    btn.disabled = true;
    refMsg("Refreshing &hellip;");
    reloadData().then(() => {
      refMsg(`Updated ${clock()}${LGRES[L.id] ? " · rosters &amp; adds" : ""}${OFF.as_of ? " · injuries " + esc(OFF.as_of.slice(11)) : ""}`);
      const tok = ghToken();
      if (!tok) return;
      return startRebuild(tok).then(() => reloadData())
        .then(() => refMsg(`Fresh stats ${clock()} · through ${esc(META.last_game_day || "")}`));
    }).catch((e) => refMsg(`<span class="pos-dn">Refresh failed: ${esc(e.message)}</span>`))
      .finally(() => { btn.disabled = false; });
  });
  const st = () => { $("own-state").textContent = ghToken() ? "Token saved: Refresh also rebuilds." : "No token saved."; };
  $("own-save").addEventListener("click", () => {
    const v = ($("own-tok").value || "").trim();
    if (!v) return;
    try { localStorage.setItem(GH.key, v); } catch (e) { /* storage blocked */ }
    $("own-tok").value = "";
    st();
  });
  $("own-clear").addEventListener("click", () => { try { localStorage.removeItem(GH.key); } catch (e) { /* */ } st(); });
  st();
}

// ================================================================== BOOT
function fetchData(bust) {
  const q = bust ? "?t=" + Date.now() : "";
  return Promise.all([fetch("data/meta.json" + q, NC).then((r) => r.json()), fetch("data/players.json" + q, NC).then((r) => r.json()),
    // refreshed hourly on game days -> always bypass the browser cache
    fetch("data/injuries.json?t=" + Date.now()).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("data/sleeper.json" + q, NC).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
}
// Sleeper's per-game projections (Rotowire): a benchmark shown next to ours, never an input
let SLP = {};
// Sleeper's projected fantasy points for his game on date d, under the active league (null if none)
function slpFP(id, d) {
  const g = (SLP[id] || []).find((x) => x[0] === d);
  return g ? fpg(g.slice(2, 2 + STATS.length), [g[2 + STATS.length] || 0, g[3 + STATS.length] || 0, 0]) : null;
}
function applyData([meta, players, inj, slp]) {
  META = meta; PLAYERS = players; STATS = meta.stats; SLP = slp || {};
  OFF = inj && inj.players ? inj : {players: {}, as_of: null};   // + teams, cleared
  BC = null;
  STATS.forEach((s, i) => { SI[s] = i; });
  BYID = {}; SL2ID = {};
  players.forEach((p) => {
    BYID[p.id] = p; if (p.sl) SL2ID[p.sl] = p.id;
    if (p.xr) { withX(p.s, p.xr); withX(p.ps, p.xr); withX(p.adj, p.xr); }   // expected extras per game
    if (p.xt) withX(p.td, p.xt);                                              // this season's actual, per game
  });
  const last = META.last_game_day || META.asof;
  TEAMLEFT = {};
  Object.entries(META.sched).forEach(([t, g]) => { TEAMLEFT[t] = g.filter((x) => x[0] > last).length; });
  $("asof").textContent = "through " + last;
}
fetchData(false)
  .then((d) => {
    applyData(d);
    STORE = readStore();
    const qTeam = new URLSearchParams(location.search).get("team");
    if (qTeam && /^\d+$/.test(qTeam)) {
      const key = "espn-" + META.league.id;
      if (!STORE.list[key]) { const d = clone(META.league); d.key = key; STORE.list[key] = d; }
      STORE.active = key;
      L = clone(STORE.list[key]); DRAFT = clone(L);
      setMyTeam(STORE.list[key], +qTeam);
      history.replaceState(null, "", location.pathname + location.hash);
    }
    L = clone(STORE.list[STORE.active]);
    DRAFT = clone(L);
    fillLeaguePicker();
    fillTeamPicker();
    renderLeagueForm();
    bindLeague();
    bindProj();
    bindRecap();
    bindWaivers();
    bindPlanner();
    bindInseason();
    bindWeek();
    bindLive();
    bindTrade();
    bindSchedule();
    bindDefence();
    bindRefresh();
    bindWelcome();
    if (!qTeam && !lsGet(WEL_KEY, 0)) openWelcome();
    initTips();
    initPhone();
    // console hooks used to verify the math (harmless for visitors)
    window.FNBA_DEBUG = {live: () => ({LV, renderLive, liveGames}), wl: WL, rcl: RCL, rc: RC, weekVsProj, wkLeft, relg: () => { Object.keys(LGDATA).forEach((k) => delete LGDATA[k]); return espnLeague(L); }, sw: () => ({lg: LGRES[L.id], L, teamWeek, renderWeek, espnBase, startWeek, weekVsProj, rosAt, outAt, espnPeriod, starterSlots, GAMES, BYID, STATS, fpg, todayET}), boosts: () => computeBoosts(), lock: LOCK, sp: SP, rerender: () => renderWaivers(), rosAt: (id, T) => rosAt(BYID[id], T), seasonLine: (id) => seasonLine(BYID[id]), loadGames,
      plan: (o) => { Object.assign(SP, o, {key: null}); const P = planStream();
        const pk = (m) => ({id: m.id, n: m.n, elig: m.elig, w: m.w, val: m.dv.map((x) => x.val), play: m.dv.map((x) => x.play), ok: !!m.ok});
        return {SLOTS: P.SLOTS, nd: P.days.length, addsLeft: P.addsLeft, caps: P.caps, free: P.free, n: SP.n,
          mem: P.mem.map(pk), pool: P.pool.map(pk), before: P.before.map((x) => [x.starts, x.pts]),
          strats: P.strats.map((Q) => ({sig: Q.sig, best: !!Q.best, dSt: Q.dSt, dPts: Q.dPts, obj: Q.obj, moves: Q.moves.map((m, k) => ({t: m.t, add: m.f.id, drop: m.o ? m.o.id : null, prev: m.prev,
            from: m.h.from, to: m.h.to, starts: m.starts, opts: P.options(Q, k).map((x) => [x.c.id, x.n, x.dSt, x.dPts])})), after: Q.after.map((x) => [x.starts, x.pts])})), P}; },
      ss: () => { const {T, i, SLOTS} = SS.last; const one = (m) => { const S = startSit(T, i, SLOTS, m);
          return S.rows.map((o) => ({id: o.r.id, n: o.r.n, elig: o.r.elig, val: o.x.val, ceil: o.x.ceil, var: o.x.var,
            start: o.start, slot: o.slot, cost: o.cost, beat: o.beat, out: o.out ? o.out.map((q) => q.id) : null, noslot: !!o.noslot})); };
        return {SLOTS, day: SS.day, proj: one("proj"), ceil: one("ceil")}; },
      previewTrades: (list) => { PT.key = L.id; PT.trades = list; PT.p = Promise.resolve(list); renderPastTrades(); }};
    bindBoostPanel("wv-boosts");
    bindBoostPanel("is-boosts");
    document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
    // in-page links scroll without touching the hash (the hash names the tab)
    document.querySelectorAll(".toc a").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      const t = document.getElementById(a.getAttribute("href").slice(1));
      if (t) t.scrollIntoView({behavior: "smooth", block: "start"});
    }));
    $("scrim").addEventListener("click", (e) => { if (e.target === $("scrim")) closePlayer(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePlayer(); });
    renderAll();
    showTab((location.hash || "#proj").slice(1));
    refreshLeagueData();
    loadReturns2().then(renderAll);
  })
  .catch((e) => {
    document.querySelector("main").innerHTML = '<div class="msg err">Could not load the data (' + esc(e.message) + ").</div>";
  });
})();
