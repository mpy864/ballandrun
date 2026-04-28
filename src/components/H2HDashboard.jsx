import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase.js';
import AuthBar from './AuthBar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { X, ArrowLeft, Plus, ChevronDown, ChevronUp } from 'lucide-react';


// ─── Constants ────────────────────────────────────────────────────────────────

const PLAYER_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6'];
const MAX_PLAYERS   = 5;
const WINDOWS       = [
  { label: '6M',  months: 6  },
  { label: '12M', months: 12 },
  { label: '18M', months: 18 },
];

const WL_FILTERS = [
  { id: 'rank',       label: 'By rank'   },
  { id: 'tier',       label: 'By tier'   },
  { id: 'nation',     label: 'By nation' },
  { id: 'style',      label: 'By style'  },
  { id: 'grip',       label: 'By grip'   },
];

const RANK_BUCKETS = [
  { label: 'Top 10',   min: 1,   max: 10  },
  { label: '11–25',    min: 11,  max: 25  },
  { label: '26–50',    min: 26,  max: 50  },
  { label: '51–100',   min: 51,  max: 100 },
  { label: '101–200',  min: 101, max: 200 },
  { label: '200+',     min: 201, max: 9999},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcAge(dob) {
  if (!dob) return null;
  const b = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age;
}

function fmtStyle(handedness, grip) {
  const parts = [];
  if (handedness) parts.push(handedness.replace(' Hand',''));
  if (grip) parts.push(grip);
  return parts.join(' · ') || '—';
}

function windowCutoff(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

function cleanRound(round) {
  if (!round || round === 'N/A') return null;
  const rofMatch = round.match(/Round of \d+/i);
  if (rofMatch) return rofMatch[0];
  const low = round.toLowerCase();
  if (low.includes('semifinal') || low.includes('semi-final') || low.includes('semi final')) return 'Semi-Final';
  if (low.includes('quarterfinal') || low.includes('quarter-final') || low.includes('quarter final')) return 'Quarter-Final';
  if (low.includes('final')) return 'Final';
  if (low.includes('group')) return 'Group Stage';
  if (low.includes('qualifying')) return 'Qualifying';
  const parts = round.split(' - ');
  return parts.length > 1 ? parts[parts.length - 2] || null : null;
}

function countDeuceGames(str, isComp1) {
  if (!str || str === 'N/A') return { won: 0, lost: 0 };
  let won = 0, lost = 0;
  for (const g of str.split(',').map(s => s.trim())) {
    const [a, b] = g.split('-').map(Number);
    if (isNaN(a) || isNaN(b)) continue;
    if (Math.min(a, b) >= 10 && Math.abs(a - b) === 2) {
      const [p, o] = isComp1 ? [a, b] : [b, a];
      if (p > o) won++; else lost++;
    }
  }
  return { won, lost };
}

function parsePoints(str, isComp1) {
  if (!str || str === 'N/A') return { won: 0, lost: 0 };
  let won = 0, lost = 0;
  for (const g of str.split(',').map(s => s.trim())) {
    const [a, b] = g.split('-').map(Number);
    if (isNaN(a) || isNaN(b) || (a === 0 && b === 0)) continue;
    const [p, o] = isComp1 ? [a, b] : [b, a];
    won += p; lost += o;
  }
  return { won, lost };
}

const DOM_MONTH = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseDomesticDate(match_datetime, season) {
  if (!match_datetime) return new Date(0);
  try {
    const dayMon = match_datetime.split(',')[0].trim();
    const [dayStr, monStr] = dayMon.split('-');
    const monthNum = DOM_MONTH[monStr];
    if (monthNum === undefined) return new Date(0);
    const baseYear = parseInt(season?.split('-')[0] || '2024');
    // Jan–Mar belong to the second year of the season (e.g. Jan 2026 in season 2025-26)
    const year = monthNum <= 2 ? baseYear + 1 : baseYear;
    return new Date(year, monthNum, parseInt(dayStr));
  } catch(e) { return new Date(0); }
}

const DOM_ROUND_MAP = {
  'FINAL': 'Final', 'SF': 'Semi-Final', 'QF': 'Quarter-Final',
  'R/16': 'Round of 16', 'R/32': 'Round of 32', 'R/64': 'Round of 64',
  'R/128': 'Round of 128',
};

function slugToName(slug) {
  if (!slug) return 'Unknown';
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function parseScores(gameScores, isComp1) {
  if (!gameScores) return { gamesWon: 0, gamesLost: 0 };
  const games = gameScores.split(',').map(g => {
    const [a, b] = g.split('-').map(Number);
    return isComp1 ? { p: a, o: b } : { p: b, o: a };
  }).filter(g => !(g.p === 0 && g.o === 0));
  return {
    gamesWon:  games.filter(g => g.p > g.o).length,
    gamesLost: games.filter(g => g.o > g.p).length,
  };
}

// ─── Build metrics for one player ─────────────────────────────────────────────

function buildPlayerMetrics(
  matches, rankings, events, allPlayers, oppRankMap, pid, windowMonths,
  domMatches = [], domOppProfiles = {}, domOppRankMap = {}, dataSource = 'wtt'
) {
  const cutoff = windowCutoff(windowMonths);
  const playerRank = rankings?.[0]?.rank || 999;
  const pidStr = String(pid);

  // WTT ledger
  const wttLedger = dataSource === 'dom' ? [] : (matches || [])
    .filter(m => { const d = new Date(m.event_date); return !isNaN(d) && d >= cutoff; })
    .map(m => {
      const isComp1 = parseInt(m.comp1_id) === pid;
      const won     = isComp1 ? m.result === 'W' : m.result === 'L';
      const oppId   = parseInt(isComp1 ? m.comp2_id : m.comp1_id);
      const oppP    = allPlayers?.find(p => parseInt(p.ittf_id) === oppId);
      const oppH    = oppRankMap[oppId] || [];
      const matchDate = new Date(m.event_date);
      const oppRank   = oppH.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? 999;
      const playerRankAtMatch = (rankings || []).find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? playerRank;
      const event     = events?.find(e => e.event_id === m.event_id);
      const { gamesWon, gamesLost } = parseScores(m.game_scores, isComp1);
      const totalGames = gamesWon + gamesLost;
      const dg  = countDeuceGames(m.game_scores, isComp1);
      const pts = parsePoints(m.game_scores, isComp1);
      return {
        rawDate: matchDate, won, result: won ? 'W' : 'L', oppId,
        opponent: oppP?.player_name || 'Unknown',
        opponentCountry: oppP?.country_code || null,
        opponentHandedness: oppP?.handedness || null,
        opponentGrip: oppP?.grip || null,
        opponentRank: oppRank, playerRankAtMatch,
        eventTier: event?.tops_grade ?? null,
        eventName: (event?.event_name || 'Unknown').replace(/\s+presented\s+by\s+.*/i, '').trim(),
        round: cleanRound(m.round_phase),
        gamesWon, gamesLost, totalGames,
        pointsWon: pts.won, pointsLost: pts.lost,
        deuceGames: dg,
        isClutch:   won && gamesLost === gamesWon - 1,
        isComeback: (() => {
          if (!won || !m.game_scores) return false;
          const games = m.game_scores.split(',');
          if (!games[0]) return false;
          const [a, b] = games[0].split('-').map(Number);
          return isComp1 ? a < b : b < a;
        })(),
        isStraightWin:  won  && gamesLost === 0 && totalGames >= 3,
        isStraightLoss: !won && gamesWon  === 0 && totalGames >= 3,
        isUpset: won && oppRank < playerRankAtMatch,
        wonGame1: (() => {
          if (!m.game_scores) return null;
          const first = m.game_scores.split(',')[0]?.trim();
          if (!first) return null;
          const [a, b] = first.split('-').map(Number);
          return (isNaN(a) || isNaN(b)) ? null : (isComp1 ? a > b : b > a);
        })(),
        pointDiff: pts.won - pts.lost,
        isDomestic: false,
      };
    });

  // Domestic ledger
  const analyticsRounds = new Set(['FINAL','SF','QF','R/16','R/32','R/64']);
  const domLedger = dataSource === 'wtt' ? [] : (domMatches || [])
    .filter(m => {
      if (!analyticsRounds.has(m.round)) return false;
      return parseDomesticDate(m.match_datetime, m.season) >= cutoff;
    })
    .map(m => {
      const isP1     = m.wtt_player1_id === pidStr;
      const me       = isP1 ? m.player1_name : m.player2_name;
      const opp      = isP1 ? m.player2_name : m.player1_name;
      const won      = m.winner_name === me;
      const oppWttId = isP1 ? m.wtt_player2_id : m.wtt_player1_id;
      const oppP     = oppWttId ? domOppProfiles[oppWttId] : null;
      const oppH     = oppWttId ? (domOppRankMap[oppWttId] || []) : [];
      const rawDate  = parseDomesticDate(m.match_datetime, m.season);
      const opponentRank = oppH[0]?.rank ?? 999;
      const playerRankAtMatch = (rankings || []).find(r => new Date(r.ranking_date) <= rawDate)?.rank ?? playerRank;

      let gW = 0, gL = 0, pW = 0, pL = 0, scoreStr = '';
      if (m.game_scores?.length) {
        const parts = m.game_scores.map(([ws, ls]) => {
          const [ps, os] = won ? [ws, ls] : [ls, ws];
          if (ps > os) gW++; else gL++;
          pW += ps; pL += os;
          return `${ps}-${os}`;
        });
        scoreStr = parts.join(',');
      } else {
        const [pSets, oSets] = won
          ? [m.p1_sets ?? 0, m.p2_sets ?? 0]
          : [m.p2_sets ?? 0, m.p1_sets ?? 0];
        gW = pSets; gL = oSets;
      }
      const totalGames = gW + gL;
      const dg  = scoreStr ? countDeuceGames(scoreStr, true) : { won: 0, lost: 0 };
      const pts = scoreStr ? parsePoints(scoreStr, true) : { won: pW, lost: pL };
      return {
        rawDate, won, result: won ? 'W' : 'L',
        oppId: oppWttId ? parseInt(oppWttId) : null,
        opponent: oppP?.player_name || opp,
        opponentCountry: oppP?.country_code || 'IND',
        opponentHandedness: oppP?.handedness || null,
        opponentGrip: oppP?.grip || null,
        opponentRank, playerRankAtMatch,
        eventTier: 6,
        eventName: slugToName(m.slug),
        round: DOM_ROUND_MAP[m.round] || m.round,
        gamesWon: gW, gamesLost: gL, totalGames,
        pointsWon: pts.won, pointsLost: pts.lost,
        deuceGames: dg,
        isClutch:      won && gL === gW - 1,
        isComeback:    false,
        isStraightWin:  won  && gL === 0 && totalGames >= 3,
        isStraightLoss: !won && gW === 0 && totalGames >= 3,
        isUpset: won && opponentRank < playerRankAtMatch,
        wonGame1: scoreStr ? (() => {
          const first = scoreStr.split(',')[0]?.trim();
          if (!first) return null;
          const [a, b] = first.split('-').map(Number);
          return (isNaN(a) || isNaN(b)) ? null : a > b;
        })() : null,
        pointDiff: pts.won - pts.lost,
        isDomestic: true,
      };
    });

  const ledger = [...wttLedger, ...domLedger].sort((a, b) => b.rawDate - a.rawDate);

  const wins   = ledger.filter(m => m.won);
  const losses = ledger.filter(m => !m.won);
  const total  = wins.length + losses.length;
  const winRate = total > 0 ? (wins.length / total) * 100 : 0;

  const clutchGames = ledger.filter(m => m.gamesLost === m.gamesWon - 1 || m.gamesLost === m.gamesWon + 1);
  const clutchWins  = clutchGames.filter(m => m.won).length;
  const clutchIndex = clutchGames.length > 0 ? (clutchWins / clutchGames.length) * 100 : null;

  const beaten = wins.filter(m => m.opponentRank < 999).map(m => m.opponentRank);
  const avgOppRankBeaten = beaten.length > 0
    ? Math.round(beaten.reduce((s, v) => s + v, 0) / beaten.length) : null;

  const upsetWins = wins.filter(m => m.isUpset).length;
  const upsetYield = wins.length > 0 ? (upsetWins / wins.length) * 100 : 0;

  // WL breakdowns
  const rankBuckets = RANK_BUCKETS.map(b => {
    const bm = ledger.filter(m => m.opponentRank >= b.min && m.opponentRank <= b.max);
    const bw = bm.filter(m => m.won).length;
    const bl = bm.filter(m => !m.won).length;
    const bt = bw + bl;
    return { ...b, wins: bw, losses: bl, total: bt, winPct: bt > 0 ? (bw/bt)*100 : 0 };
  }).filter(b => b.total > 0);

  const tierMap = {};
  for (const m of ledger) {
    const t = m.eventTier != null ? String(m.eventTier) : 'Unknown';
    if (!tierMap[t]) tierMap[t] = { wins: 0, losses: 0 };
    if (m.won) tierMap[t].wins++; else tierMap[t].losses++;
  }
  const tierBuckets = Object.entries(tierMap).map(([tier, t]) => {
    const bt = t.wins + t.losses;
    return { label: tier === 'Unknown' ? 'Unclassified' : `Grade ${tier}`, tier,
      wins: t.wins, losses: t.losses, total: bt, winPct: bt > 0 ? (t.wins/bt)*100 : 0 };
  }).sort((a, b) => a.tier === 'Unknown' ? 1 : b.tier === 'Unknown' ? -1 : parseInt(a.tier)-parseInt(b.tier));

  const nationMap = {};
  for (const m of ledger) {
    const cc = m.opponentCountry; if (!cc) continue;
    if (!nationMap[cc]) nationMap[cc] = { wins: 0, losses: 0 };
    if (m.won) nationMap[cc].wins++; else nationMap[cc].losses++;
  }
  const nationBuckets = Object.entries(nationMap).map(([cc, n]) => {
    const bt = n.wins + n.losses;
    return { label: cc.toUpperCase(), wins: n.wins, losses: n.losses, total: bt, winPct: bt > 0 ? (n.wins/bt)*100 : 0 };
  }).sort((a, b) => b.total - a.total).slice(0, 6);

  const styleMap = {};
  for (const m of ledger) {
    const hand = m.opponentHandedness || 'Unknown';
    const grip = m.opponentGrip || 'Unknown';
    const key  = hand === 'Unknown' && grip === 'Unknown' ? 'Unknown'
      : [hand.replace(' Hand',''), grip].filter(s => s && s !== 'Unknown').join(' · ') || 'Unknown';
    if (!styleMap[key]) styleMap[key] = { wins: 0, losses: 0 };
    if (m.won) styleMap[key].wins++; else styleMap[key].losses++;
  }
  const styleBuckets = Object.entries(styleMap)
    .filter(([k]) => k !== 'Unknown')
    .map(([k, v]) => {
      const bt = v.wins + v.losses;
      return { label: k, wins: v.wins, losses: v.losses, total: bt, winPct: bt > 0 ? (v.wins/bt)*100 : 0 };
    }).sort((a, b) => b.total - a.total);

  const gripMap = {};
  for (const m of ledger) {
    const g = m.opponentGrip || 'Unknown';
    if (!gripMap[g]) gripMap[g] = { wins: 0, losses: 0 };
    if (m.won) gripMap[g].wins++; else gripMap[g].losses++;
  }
  const gripBuckets = Object.entries(gripMap)
    .filter(([k]) => k !== 'Unknown')
    .map(([k, v]) => {
      const bt = v.wins + v.losses;
      return { label: k, wins: v.wins, losses: v.losses, total: bt, winPct: bt > 0 ? (v.wins/bt)*100 : 0 };
    }).sort((a, b) => b.total - a.total);

  // ── New KPIs ──────────────────────────────────────────────────────────────
  // Deuce win rate
  let deuceWon = 0, deuceTotal = 0;
  for (const m of ledger) {
    deuceWon   += m.deuceGames.won;
    deuceTotal += m.deuceGames.won + m.deuceGames.lost;
  }
  const deuceWinRate = deuceTotal > 0 ? (deuceWon / deuceTotal) * 100 : null;

  // Game + Point win rate
  const totalGW = ledger.reduce((s, m) => s + m.gamesWon, 0);
  const totalGL = ledger.reduce((s, m) => s + m.gamesLost, 0);
  const gameWinRate = (totalGW + totalGL) > 0 ? (totalGW / (totalGW + totalGL)) * 100 : null;
  const totalPW = ledger.reduce((s, m) => s + m.pointsWon, 0);
  const totalPL = ledger.reduce((s, m) => s + m.pointsLost, 0);
  const pointWinRate = (totalPW + totalPL) > 0 ? (totalPW / (totalPW + totalPL)) * 100 : null;

  // Finals win rate
  const finalMatches = ledger.filter(m => m.round === 'Final');
  const finalWinRate = finalMatches.length > 0 ? (finalMatches.filter(m => m.won).length / finalMatches.length) * 100 : null;

  // Peer Zone (±20) and Ambition Zone (opponent 20+ higher) — using historical rank
  const histRanked = ledger.filter(m => m.opponentRank !== 999 && m.playerRankAtMatch && m.playerRankAtMatch !== 999);
  const peerMatches     = histRanked.filter(m => Math.abs(m.opponentRank - m.playerRankAtMatch) <= 20);
  const ambitionMatches = histRanked.filter(m => m.playerRankAtMatch - m.opponentRank > 20);
  const peerWinRate     = peerMatches.length     > 0 ? (peerMatches.filter(m => m.won).length     / peerMatches.length)     * 100 : null;
  const ambitionWinRate = ambitionMatches.length > 0 ? (ambitionMatches.filter(m => m.won).length / ambitionMatches.length) * 100 : null;

  // Hold rate: win% vs opponents 20+ ranks below (matches main dashboard formula)
  const vsMuchLower = histRanked.filter(m => m.opponentRank > m.playerRankAtMatch + 20);
  const holdRate    = vsMuchLower.length > 0 ? (vsMuchLower.filter(m => m.won).length / vsMuchLower.length) * 100 : null;

  // Banana skin rate: losses to lower ranked / total losses (matches main dashboard formula)
  const bananaSkins    = losses.filter(m => m.opponentRank !== 999 && m.playerRankAtMatch && m.opponentRank > m.playerRankAtMatch);
  const bananaSkinRate = losses.length > 0 ? (bananaSkins.length / losses.length) * 100 : null;

  // Avg Point Diff
  let ptDiffTotal = 0, ptDiffCount = 0;
  for (const m of ledger) { if (m.pointDiff != null) { ptDiffTotal += m.pointDiff; ptDiffCount++; } }
  const avgPtDiff = ptDiffCount > 0 ? ptDiffTotal / ptDiffCount : 0;

  // Points Per Game
  const totalPtsWonPPG = ledger.reduce((s, m) => s + (m.pointsWon || 0), 0);
  const totalGP = ledger.reduce((s, m) => s + (m.totalGames > 0 ? m.totalGames : 0), 0);
  const pointsPerGame = totalGP > 0 ? totalPtsWonPPG / totalGP : null;

  // Upset Rate (win% vs higher-ranked) & Dominance Rate (win% vs lower-ranked)
  const vsHigher = histRanked.filter(m => m.opponentRank < m.playerRankAtMatch);
  const vsLower  = histRanked.filter(m => m.opponentRank > m.playerRankAtMatch);
  const upsetRate     = vsHigher.length > 0 ? (vsHigher.filter(m => m.won).length / vsHigher.length) * 100 : null;
  const dominanceRate = vsLower.length  > 0 ? (vsLower.filter(m => m.won).length  / vsLower.length)  * 100 : null;

  // Proximity Win Rate (±10 ranks)
  const proximityMatches = histRanked.filter(m => Math.abs(m.opponentRank - m.playerRankAtMatch) <= 10);
  const proximityWinRate = proximityMatches.length > 0 ? (proximityMatches.filter(m => m.won).length / proximityMatches.length) * 100 : null;

  // Lead Protection & Blown Lead
  const wonGame1Matches = ledger.filter(m => m.wonGame1 === true);
  const leadProtectionRate = wonGame1Matches.length > 0 ? (wonGame1Matches.filter(m => m.won).length  / wonGame1Matches.length) * 100 : null;
  const blownLeadRate      = wonGame1Matches.length > 0 ? (wonGame1Matches.filter(m => !m.won).length / wonGame1Matches.length) * 100 : null;

  // Deciding Game Win Rate (5 or 7 games)
  const decidingMatches = ledger.filter(m => m.totalGames === 5 || m.totalGames === 7);
  const decidingWinRate = decidingMatches.length > 0 ? (decidingMatches.filter(m => m.won).length / decidingMatches.length) * 100 : null;

  // Momentum (Hot / Cold Streak)
  const sortedChron = [...ledger].sort((a, b) => a.rawDate - b.rawDate);
  let hotWins = 0, hotTotal = 0, coldWins = 0, coldTotal = 0;
  for (let i = 3; i < sortedChron.length; i++) {
    const prior = sortedChron.slice(i - 3, i);
    const curr  = sortedChron[i];
    if (prior.every(m => m.won))  { hotTotal++;  if (curr.won) hotWins++;  }
    else if (prior.every(m => !m.won)) { coldTotal++; if (curr.won) coldWins++; }
  }
  const momentumHotRate  = hotTotal  >= 3 ? (hotWins  / hotTotal)  * 100 : null;
  const momentumColdRate = coldTotal >= 3 ? (coldWins / coldTotal) * 100 : null;

  // Giant Killer
  const vsTop20 = ledger.filter(m => m.opponentRank !== 999 && m.opponentRank <= 20);
  const vsTop50 = ledger.filter(m => m.opponentRank !== 999 && m.opponentRank <= 50);
  const giantKillerTop20 = vsTop20.length > 0 ? (vsTop20.filter(m => m.won).length / vsTop20.length) * 100 : null;
  const giantKillerTop50 = vsTop50.length > 0 ? (vsTop50.filter(m => m.won).length / vsTop50.length) * 100 : null;

  // Biggest Scalp
  const upsetWinMatches = wins.filter(m => m.opponentRank !== 999 && m.playerRankAtMatch && m.opponentRank < m.playerRankAtMatch);
  const biggestScalpRank = upsetWinMatches.length > 0 ? Math.min(...upsetWinMatches.map(m => m.opponentRank)) : null;

  // Knockout Win Rate (SF + QF) & Group Win Rate
  const knockoutMatches = ledger.filter(m => m.round === 'Semi-Final' || m.round === 'Quarter-Final');
  const EARLY_ROUNDS = new Set(['Round of 16', 'Round of 32', 'Round of 64', 'Round of 128', 'Group Stage']);
  const groupRoundMatches = ledger.filter(m => EARLY_ROUNDS.has(m.round));
  const knockoutWinRate = knockoutMatches.length    > 0 ? (knockoutMatches.filter(m => m.won).length    / knockoutMatches.length)    * 100 : null;
  const groupWinRate    = groupRoundMatches.length  > 0 ? (groupRoundMatches.filter(m => m.won).length  / groupRoundMatches.length)  * 100 : null;

  return {
    total, wins: wins.length, losses: losses.length, winRate,
    clutchIndex, avgOppRankBeaten, upsetYield,
    straightSetsWins:   wins.filter(m => m.isStraightWin).length,
    straightSetsLosses: losses.filter(m => m.isStraightLoss).length,
    comebackWins:       wins.filter(m => m.isComeback).length,
    deuceWinRate, gameWinRate, pointWinRate, finalWinRate,
    peerWinRate, ambitionWinRate, holdRate, bananaSkinRate,
    avgPtDiff, pointsPerGame,
    upsetRate, dominanceRate, proximityWinRate,
    leadProtectionRate, blownLeadRate, decidingWinRate,
    momentumHotRate, momentumColdRate,
    giantKillerTop20, giantKillerTop50, biggestScalpRank,
    knockoutWinRate, groupWinRate,
    rankBuckets, tierBuckets, nationBuckets, styleBuckets, gripBuckets,
    ledger,
  };
}

// ─── Mini bar component ───────────────────────────────────────────────────────

function MiniBar({ wins, losses, color }) {
  const total = wins + losses;
  if (total === 0) return <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>;
  const pct = (wins / total) * 100;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: '#f1f5f9', borderRadius: 2, minWidth: 60 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
        {wins}W/{losses}L
      </span>
    </div>
  );
}

// ─── WL breakdown section ────────────────────────────────────────────────────

function WLBreakdown({ metrics, color, filter, onFilterChange }) {
  if (!metrics) return null;

  const buckets = {
    rank:   metrics.rankBuckets,
    tier:   metrics.tierBuckets,
    nation: metrics.nationBuckets,
    style:  metrics.styleBuckets,
    grip:   metrics.gripBuckets,
  }[filter] || [];

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
        {WL_FILTERS.map(f => (
          <button key={f.id} onClick={() => onFilterChange(f.id)} style={{
            fontSize: 10, padding: '3px 8px', borderRadius: 99, border: '1px solid',
            borderColor: filter === f.id ? color : '#e2e8f0',
            background: filter === f.id ? color : 'white',
            color: filter === f.id ? 'white' : '#64748b',
            cursor: 'pointer', fontWeight: 500,
          }}>{f.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {buckets.length === 0 && <span style={{ fontSize: 11, color: '#94a3b8' }}>No data</span>}
        {buckets.map((b, i) => (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>{b.label}</span>
              <span style={{ fontSize: 11, color: b.winPct >= 50 ? '#059669' : '#dc2626', fontWeight: 600 }}>
                {b.winPct.toFixed(0)}%
              </span>
            </div>
            <MiniBar wins={b.wins} losses={b.losses} color={color} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Rank chart ───────────────────────────────────────────────────────────────

function RankChart({ playersData, windowMonths }) {
  const cutoff = windowCutoff(windowMonths);

  const chartData = useMemo(() => {
    const pointMap = {};
    playersData.forEach(({ pid, rankings, color, name }) => {
      (rankings || []).forEach(r => {
        const d = new Date(r.ranking_date);
        if (d < cutoff) return;
        const key = r.ranking_date;
        if (!pointMap[key]) pointMap[key] = { date: key, x: d.getTime() };
        pointMap[key][pid] = r.rank;
      });
    });
    return Object.values(pointMap).sort((a, b) => a.x - b.x);
  }, [playersData, windowMonths]);

  const fmtDate = (ts) => {
    const d = new Date(ts);
    return `${d.toLocaleString('default', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`;
  };

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="x" type="number" domain={['auto','auto']}
          tickFormatter={fmtDate} tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickCount={5} />
        <YAxis reversed tick={{ fontSize: 10, fill: '#94a3b8' }} />
        <Tooltip
          formatter={(v, name) => [`#${v}`, playersData.find(p => p.pid === parseInt(name))?.name || name]}
          labelFormatter={fmtDate}
          contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
        {playersData.map(({ pid, color }) => (
          <Area key={pid} type="monotone" dataKey={String(pid)}
            stroke={color} fill={color} fillOpacity={0.08}
            strokeWidth={2} dot={false} connectNulls />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── H2H Matrix ──────────────────────────────────────────────────────────────

function H2HMatrix({ playersData }) {
  if (playersData.length < 2) return null;

  // Build matrix: for each pair (A, B), find matches where A played B
  const matrix = {};
  playersData.forEach(a => {
    matrix[a.pid] = {};
    playersData.forEach(b => {
      if (a.pid === b.pid) { matrix[a.pid][b.pid] = null; return; }
      const h2h = (a.matches || []).filter(m => {
        const isComp1 = parseInt(m.comp1_id) === a.pid;
        const oppId   = parseInt(isComp1 ? m.comp2_id : m.comp1_id);
        return oppId === b.pid;
      });
      const wins   = h2h.filter(m => (parseInt(m.comp1_id) === a.pid ? m.result === 'W' : m.result === 'L')).length;
      const losses = h2h.length - wins;
      matrix[a.pid][b.pid] = { wins, losses, total: h2h.length };
    });
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontWeight: 500, fontSize: 11 }}>vs</th>
            {playersData.map((p, i) => (
              <th key={p.pid} style={{ padding: '8px 12px', textAlign: 'center', color: PLAYER_COLORS[i], fontWeight: 600, fontSize: 11 }}>
                {p.name.split(' ')[0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {playersData.map((rowP, ri) => (
            <tr key={rowP.pid} style={{ borderTop: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px 12px', fontWeight: 600, color: PLAYER_COLORS[ri], fontSize: 11 }}>
                {rowP.name.split(' ')[0]}
              </td>
              {playersData.map((colP, ci) => {
                if (rowP.pid === colP.pid) return (
                  <td key={colP.pid} style={{ padding: '8px 12px', textAlign: 'center', background: '#f8fafc', color: '#cbd5e1' }}>—</td>
                );
                const cell = matrix[rowP.pid]?.[colP.pid];
                if (!cell || cell.total === 0) return (
                  <td key={colP.pid} style={{ padding: '8px 12px', textAlign: 'center', color: '#cbd5e1', fontSize: 11 }}>—</td>
                );
                return (
                  <td key={colP.pid} style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <span style={{
                      fontWeight: 700, fontSize: 12,
                      color: cell.wins > cell.losses ? '#059669' : cell.losses > cell.wins ? '#dc2626' : '#64748b',
                    }}>
                      {cell.wins}W/{cell.losses}L
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Coach H2H Selector (Tier 1) ─────────────────────────────────────────────

function CoachH2HSelector({ athletes, fullPlayerList, setSelectedIds, competitorPicks, setCompetitorPick }) {
  const [athleteId, setAthleteId]           = useState(athletes[0]?.player_id ?? null);
  const [opponentSearch, setOpponentSearch] = useState('');
  const [showDrop, setShowDrop]             = useState(false);
  const [opponentId, setOpponentId]         = useState(null);

  const today         = new Date();
  const isFirstOfMonth = today.getDate() === 1;

  // Saved pick for currently selected athlete
  const savedPick = athleteId
    ? competitorPicks.find(p => p.athlete_ittf_id === String(athleteId))
    : null;
  const pickStillValid = savedPick ? new Date(savedPick.valid_until) >= today : false;
  const canChange      = isFirstOfMonth || !pickStillValid; // locked mid-month if a valid pick exists

  // Pre-populate opponent from saved pick whenever athlete changes
  useEffect(() => {
    if (savedPick && pickStillValid) {
      const saved = fullPlayerList.find(p => String(p.player_id) === savedPick.competitor_ittf_id);
      setOpponentId(saved?.player_id ?? null);
    } else {
      setOpponentId(null);
    }
    setOpponentSearch('');
  }, [athleteId, competitorPicks.length, fullPlayerList.length]);

  const selectedOpponent = fullPlayerList.find(p => p.player_id === opponentId);

  const opponentResults = canChange && opponentSearch.length > 1
    ? fullPlayerList
        .filter(p => p.player_id !== athleteId &&
                     p.player_name.toLowerCase().includes(opponentSearch.toLowerCase()))
        .slice(0, 8)
    : [];

  useEffect(() => {
    if (athleteId && opponentId) setSelectedIds([athleteId, opponentId]);
    else if (athleteId)          setSelectedIds([athleteId]);
    else                         setSelectedIds([]);
  }, [athleteId, opponentId]);

  async function pickOpponent(p) {
    setOpponentId(p.player_id);
    setOpponentSearch('');
    setShowDrop(false);
    await setCompetitorPick(String(athleteId), String(p.player_id));
  }

  const nextReset = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
          Scout an opponent
        </p>
        {pickStillValid && !canChange && (
          <span style={{ fontSize: 10, color: '#94a3b8' }}>Resets {nextReset}</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Athlete dropdown */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>Your athlete</label>
          <select
            value={athleteId ?? ''}
            onChange={e => { setAthleteId(Number(e.target.value)); setOpponentId(null); setOpponentSearch(''); }}
            style={{
              width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0',
              borderRadius: 8, fontSize: 13, color: '#1e293b', background: 'white',
              outline: 'none', cursor: 'pointer', boxSizing: 'border-box',
            }}
          >
            {athletes.map(p => (
              <option key={p.player_id} value={p.player_id}>
                {p.player_name} · #{p.rank}
              </option>
            ))}
          </select>
        </div>

        {/* Opponent — locked mid-month if pick exists, open on 1st or when expired */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>
            Opponent to scout
            {!canChange && <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>(locked until {nextReset})</span>}
          </label>
          <div style={{ position: 'relative' }}>
            {(selectedOpponent && (!canChange || !opponentSearch)) ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '9px 12px',
                border: `1.5px solid ${canChange ? '#6366f1' : '#e2e8f0'}`,
                borderRadius: 8,
                background: canChange ? '#f5f3ff' : '#f8fafc',
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                  {selectedOpponent.player_name} · #{selectedOpponent.rank}
                </span>
                {canChange && (
                  <button onClick={() => setOpponentId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'flex' }}>
                    <X size={13} />
                  </button>
                )}
              </div>
            ) : canChange ? (
              <input
                placeholder="Search any player…"
                value={opponentSearch}
                onChange={e => { setOpponentSearch(e.target.value); setShowDrop(true); }}
                onFocus={() => setShowDrop(true)}
                onBlur={() => setTimeout(() => setShowDrop(false), 150)}
                style={{
                  width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0',
                  borderRadius: 8, fontSize: 13, color: '#1e293b', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            ) : (
              <div style={{ padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, color: '#94a3b8', background: '#f8fafc' }}>
                No opponent picked yet
              </div>
            )}
            {showDrop && opponentResults.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                background: 'white', border: '1px solid #e2e8f0', borderRadius: 8,
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)', marginTop: 4, overflow: 'hidden',
              }}>
                {opponentResults.map(p => (
                  <button key={p.player_id} onClick={() => pickOpponent(p)} style={{
                    width: '100%', textAlign: 'left', padding: '9px 14px',
                    border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: 13, color: '#1e293b', borderBottom: '1px solid #f8fafc',
                    display: 'flex', justifyContent: 'space-between',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    <span>{p.player_name}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{p.country_code} · #{p.rank}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function H2HDashboard() {
  const { isCoach, allowedIttfIds, clubAthletes, competitorPicks, setCompetitorPick } = useAuth();
  const [allPlayers, setAllPlayers]     = useState([]);
  const [fullPlayerList, setFullPlayerList] = useState([]);
  const [selectedIds, setSelectedIds]   = useState([]);
  const [searchTerm, setSearchTerm]     = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [windowMonths, setWindowMonths] = useState(6);
  const [playerData, setPlayerData]     = useState({});
  const [loading, setLoading]           = useState(true);
  const [fetching, setFetching]         = useState(false);
  const [expandedSection, setExpandedSection] = useState('stats');
  const [wlFilter, setWlFilter]               = useState('rank');
  const [dataSource, setDataSource]           = useState('wtt');

  // Load global top-500 player list
  useEffect(() => {
    (async () => {
      try {
        const { data: latestRow } = await supabase
          .from('rankings_singles_normalized')
          .select('ranking_date').order('ranking_date', { ascending: false }).limit(1);
        const latestDate = latestRow?.[0]?.ranking_date;
        if (!latestDate) { setLoading(false); return; }

        const { data: rankRows } = await supabase
          .from('rankings_singles_normalized')
          .select('player_id,rank')
          .eq('ranking_date', latestDate)
          .lte('rank', 500)
          .order('rank', { ascending: true })
          .limit(1100);

        const ids = (rankRows || []).map(r => r.player_id);
        const rankMap = {};
        for (const r of (rankRows || [])) rankMap[r.player_id] = r.rank;

        const normGender = g => {
          if (!g) return '';
          const l = g.toLowerCase();
          if (l === 'm' || l === 'male' || l === 'men') return 'M';
          if (l === 'w' || l === 'f' || l === 'female' || l === 'women') return 'W';
          return g;
        };

        let profileRows = [];
        for (let i = 0; i < ids.length; i += 500) {
          const batch = ids.slice(i, i + 500);
          const { data: batchData } = await supabase
            .from('wtt_players')
            .select('ittf_id,player_name,country_code,dob,handedness,grip,gender')
            .in('ittf_id', batch).limit(510);
          profileRows = profileRows.concat(batchData || []);
        }

        const merged = profileRows
          .filter(p => rankMap[p.ittf_id])
          .map(p => {
            const g = normGender(p.gender);
            return {
              player_id:    p.ittf_id,
              player_name:  p.player_name,
              rank:         Number(rankMap[p.ittf_id]),
              gender:       g,
              gender_label: g === 'M' ? 'Men' : g === 'W' ? 'Women' : '',
              country_code: p.country_code || '',
            };
          })
          .sort((a, b) => a.rank - b.rank);

        setFullPlayerList(merged);

        // Club users (Tier 1) can only see their athletes + picked competitors
        const visible = allowedIttfIds
          ? merged.filter(p => allowedIttfIds.includes(String(p.player_id)))
          : merged;

        setAllPlayers(visible);

        // Auto-populate club athletes as selected players for Tier 1
        if (isCoach && clubAthletes.length > 0) {
          const athleteIds = visible
            .filter(p => clubAthletes.includes(String(p.player_id)))
            .map(p => p.player_id)
            .slice(0, MAX_PLAYERS);
          setSelectedIds(athleteIds);
        }
      } catch (e) { console.error('Error loading players:', e); }
      setLoading(false);
    })();
  }, []);

  // Re-filter when profile loads
  useEffect(() => {
    if (fullPlayerList.length === 0) return;
    if (isCoach) {
      // Coaches get full list — they search any opponent freely
      setAllPlayers(fullPlayerList);
    } else {
      const visible = allowedIttfIds
        ? fullPlayerList.filter(p => allowedIttfIds.includes(String(p.player_id)))
        : fullPlayerList;
      setAllPlayers(visible);
    }
  }, [fullPlayerList, allowedIttfIds, isCoach]);

  // Fetch data for newly added players
  useEffect(() => {
    const missing = selectedIds.filter(id => {
      if (!playerData[id]) return true;
      // Re-fetch if Indian player was cached before domestic support was added
      const isInd = allPlayers.find(p => p.player_id === id)?.country_code === 'IND';
      return isInd && playerData[id].domMatches === undefined;
    });
    if (missing.length === 0) return;

    setFetching(true);
    (async () => {
      for (const pid of missing) {
        try {
          const cutoff18m = new Date();
          cutoff18m.setMonth(cutoff18m.getMonth() - 18);
          const co = cutoff18m.toISOString().split('T')[0];
          const pidStr = String(pid);
          const isIndian = allPlayers.find(p => p.player_id === pid)?.country_code === 'IND';

          const [
            { data: matches },
            { data: rankings },
            { data: events },
          ] = await Promise.all([
            supabase.from('wtt_matches_singles')
              .select('match_id,comp1_id,comp2_id,result,event_date,event_id,game_scores,round_phase')
              .or(`comp1_id.eq.${pid},comp2_id.eq.${pid}`)
              .gte('event_date', co)
              .order('event_date', { ascending: false }).limit(500),
            supabase.from('rankings_singles_normalized')
              .select('rank,ranking_date,points')
              .eq('player_id', pid)
              .gte('ranking_date', co)
              .order('ranking_date', { ascending: false }).limit(100),
            supabase.from('wtt_events_graded')
              .select('event_id,event_name,event_tier,tops_grade'),
          ]);

          // Fetch WTT opponent data
          const oppIds = [...new Set((matches || []).map(m =>
            parseInt(m.comp1_id) === pid ? parseInt(m.comp2_id) : parseInt(m.comp1_id)
          ))];

          const { data: opponents } = await supabase
            .from('wtt_players')
            .select('ittf_id,player_name,country_code,dob,handedness,grip')
            .in('ittf_id', oppIds);

          const { data: oppRanks } = await supabase
            .from('rankings_singles_normalized')
            .select('player_id,rank,ranking_date')
            .in('player_id', oppIds)
            .gte('ranking_date', co)
            .order('ranking_date', { ascending: false })
            .limit(50000);

          const oppRankMap = {};
          for (const r of (oppRanks || [])) {
            const key = parseInt(r.player_id);
            if (!oppRankMap[key]) oppRankMap[key] = [];
            oppRankMap[key].push(r);
          }

          const { data: profile } = await supabase
            .from('wtt_players')
            .select('dob,handedness,grip')
            .eq('ittf_id', pid)
            .single();

          // Fetch domestic matches (Indian players only)
          let domMatches = [], domOppProfiles = {}, domOppRankMap = {};
          if (isIndian) {
            const { data: domData } = await supabase
              .from('ttfi_domestic_matches')
              .select('season,slug,event_name,round,player1_name,player2_name,winner_name,score_raw,p1_sets,p2_sets,game_scores,match_datetime,wtt_player1_id,wtt_player2_id')
              .or(`wtt_player1_id.eq.${pidStr},wtt_player2_id.eq.${pidStr}`)
              .neq('round', 'R/256')
              .ilike('event_name', '%Singles%')
              .order('season', { ascending: false });
            domMatches = domData || [];

            const domOppIds = [...new Set(domMatches
              .map(m => m.wtt_player1_id === pidStr ? m.wtt_player2_id : m.wtt_player1_id)
              .filter(id => id && id !== pidStr)
              .map(id => parseInt(id))
            )];

            if (domOppIds.length > 0) {
              const { data: domOpps } = await supabase
                .from('wtt_players').select('ittf_id,player_name,country_code,dob,handedness,grip')
                .in('ittf_id', domOppIds);
              for (const p of (domOpps || [])) domOppProfiles[String(p.ittf_id)] = p;

              const { data: domOppRankData } = await supabase
                .from('rankings_singles_normalized').select('player_id,rank,ranking_date')
                .in('player_id', domOppIds)
                .gte('ranking_date', co)
                .order('ranking_date', { ascending: false }).limit(20000);
              for (const r of (domOppRankData || [])) {
                const key = String(r.player_id);
                if (!domOppRankMap[key]) domOppRankMap[key] = [];
                domOppRankMap[key].push(r);
              }
            }
          }

          setPlayerData(prev => ({
            ...prev,
            [pid]: { matches, rankings, events, opponents, oppRankMap, profile, domMatches, domOppProfiles, domOppRankMap },
          }));
        } catch (e) {
          console.error(`Error fetching ${pid}:`, e);
        }
      }
      setFetching(false);
    })();
  }, [selectedIds, allPlayers]);

  const addPlayer = (pid) => {
    if (selectedIds.includes(pid) || selectedIds.length >= MAX_PLAYERS) return;
    setSelectedIds(prev => [...prev, pid]);
    setSearchTerm('');
    setShowDropdown(false);
  };

  const removePlayer = (pid) => {
    setSelectedIds(prev => prev.filter(id => id !== pid));
  };

  const filteredSearch = allPlayers.filter(p =>
    !selectedIds.includes(p.player_id) &&
    p.player_name.toLowerCase().includes(searchTerm.toLowerCase())
  ).slice(0, 8);

  // Build metrics for each selected player per window
  const playersWithMetrics = useMemo(() => {
    return selectedIds.map((pid, i) => {
      const info  = allPlayers.find(p => p.player_id === pid);
      const data  = playerData[pid];
      const color = PLAYER_COLORS[i];
      if (!data) return { pid, name: info?.player_name || '...', color, info, data: null, metrics: null, matches: [] };
      const metrics = buildPlayerMetrics(
        data.matches, data.rankings, data.events, data.opponents, data.oppRankMap, pid, windowMonths,
        data.domMatches || [], data.domOppProfiles || {}, data.domOppRankMap || {}, dataSource
      );
      return { pid, name: info?.player_name || '...', color, info, data, metrics, matches: data.matches || [] };
    });
  }, [selectedIds, playerData, windowMonths, allPlayers, dataSource]);

  const hasData = playersWithMetrics.some(p => p.metrics);
  const hasAnyIndian = playersWithMetrics.some(p => p.info?.country_code === 'IND');

  // ─── Stat rows config (order mirrors main dashboard DNA sections for easy audit) ─
  const STAT_ROWS = [
    // — Info —
    { isSection: true,  label: 'Info' },
    { label: 'World Rank',              fmt: p => p.info?.rank ? `#${p.info.rank}` : '—' },
    { label: 'Style',                   fmt: p => p.data?.profile ? fmtStyle(p.data.profile.handedness, p.data.profile.grip) : '—' },
    { label: 'Age',                     fmt: p => p.data?.profile?.dob ? `${calcAge(p.data.profile.dob)}` : '—' },
    // — Outcomes —
    { isSection: true,  label: 'Outcomes' },
    { label: 'Win Rate',                isNorthStar: true, nsColor: '#10b981', fmt: p => p.metrics ? `${p.metrics.winRate.toFixed(1)}%` : '—',                                                                   numFn: p => p.metrics?.winRate              ?? -1,    higher: true  },
    { label: 'Matches',                 fmt: p => p.metrics ? `${p.metrics.total}` : '—',                                                                                 numFn: p => p.metrics?.total                ?? -1,    higher: true  },
    { label: 'Game Win Rate',           fmt: p => p.metrics?.gameWinRate        != null ? `${p.metrics.gameWinRate.toFixed(1)}%`        : '—',                             numFn: p => p.metrics?.gameWinRate          ?? -1,    higher: true  },
    { label: 'Point Win Rate',          fmt: p => p.metrics?.pointWinRate       != null ? `${p.metrics.pointWinRate.toFixed(1)}%`       : '—',                             numFn: p => p.metrics?.pointWinRate         ?? -1,    higher: true  },
    { label: 'Avg Point Diff',          fmt: p => p.metrics?.avgPtDiff          != null ? `${p.metrics.avgPtDiff >= 0 ? '+' : ''}${p.metrics.avgPtDiff.toFixed(2)}` : '—', numFn: p => p.metrics?.avgPtDiff            ?? -999,  higher: true  },
    { label: 'Points Per Game',         fmt: p => p.metrics?.pointsPerGame      != null ? `${p.metrics.pointsPerGame.toFixed(1)}`       : '—',                             numFn: p => p.metrics?.pointsPerGame        ?? -1,    higher: true  },
    { label: 'Avg Opp Rank Beaten',     fmt: p => p.metrics?.avgOppRankBeaten   ? `#${p.metrics.avgOppRankBeaten}` : '—',                                                 numFn: p => p.metrics?.avgOppRankBeaten     ?? 9999,  higher: false },
    { label: 'Straight-Set Wins',       fmt: p => p.metrics ? `${p.metrics.straightSetsWins}` : '—',                                                                      numFn: p => p.metrics?.straightSetsWins     ?? -1,    higher: true  },
    { label: 'Straight-Set Losses',     fmt: p => p.metrics ? `${p.metrics.straightSetsLosses}` : '—',                                                                    numFn: p => p.metrics?.straightSetsLosses   ?? -1,    higher: false },
    // — Ambition — Playing Up —
    { isSection: true,  label: 'Ambition — Playing Up' },
    { label: 'Ambition Zone Win Rate',  fmt: p => p.metrics?.ambitionWinRate    != null ? `${p.metrics.ambitionWinRate.toFixed(1)}%`    : '—',                             numFn: p => p.metrics?.ambitionWinRate      ?? -1,    higher: true  },
    { label: 'Upset Rate',              isNorthStar: true, nsColor: '#6366f1', fmt: p => p.metrics?.upsetRate          != null ? `${p.metrics.upsetRate.toFixed(1)}%`          : '—',                             numFn: p => p.metrics?.upsetRate            ?? -1,    higher: true  },
    { label: 'Upset Yield',             fmt: p => p.metrics ? `${p.metrics.upsetYield.toFixed(1)}%` : '—',                                                                numFn: p => p.metrics?.upsetYield           ?? -1,    higher: true  },
    { label: 'Biggest Rank Scalp',      fmt: p => p.metrics?.biggestScalpRank   != null ? `#${p.metrics.biggestScalpRank}` : '—',                                         numFn: p => p.metrics?.biggestScalpRank     ?? 9999,  higher: false },
    { label: 'Giant Killer (Top 20)',   fmt: p => p.metrics?.giantKillerTop20   != null ? `${p.metrics.giantKillerTop20.toFixed(1)}%`   : '—',                             numFn: p => p.metrics?.giantKillerTop20     ?? -1,    higher: true  },
    { label: 'Giant Killer (Top 50)',   fmt: p => p.metrics?.giantKillerTop50   != null ? `${p.metrics.giantKillerTop50.toFixed(1)}%`   : '—',                             numFn: p => p.metrics?.giantKillerTop50     ?? -1,    higher: true  },
    // — Consistency — Holding Ground —
    { isSection: true,  label: 'Consistency — Holding Ground' },
    { label: 'Dominance Rate',          isNorthStar: true, nsColor: '#f59e0b', fmt: p => p.metrics?.dominanceRate      != null ? `${p.metrics.dominanceRate.toFixed(1)}%`      : '—',                             numFn: p => p.metrics?.dominanceRate        ?? -1,    higher: true  },
    { label: 'Hold Rate',               fmt: p => p.metrics?.holdRate           != null ? `${p.metrics.holdRate.toFixed(1)}%`           : '—',                             numFn: p => p.metrics?.holdRate             ?? -1,    higher: true  },
    { label: 'Banana Skin Rate',        fmt: p => p.metrics?.bananaSkinRate     != null ? `${p.metrics.bananaSkinRate.toFixed(1)}%`     : '—',                             numFn: p => p.metrics?.bananaSkinRate       ?? -1,    higher: false },
    { label: 'Peer Zone Win Rate',      fmt: p => p.metrics?.peerWinRate        != null ? `${p.metrics.peerWinRate.toFixed(1)}%`        : '—',                             numFn: p => p.metrics?.peerWinRate          ?? -1,    higher: true  },
    { label: 'Proximity Win Rate',      fmt: p => p.metrics?.proximityWinRate   != null ? `${p.metrics.proximityWinRate.toFixed(1)}%`   : '—',                             numFn: p => p.metrics?.proximityWinRate     ?? -1,    higher: true  },
    { label: 'Lead Protection Rate',    fmt: p => p.metrics?.leadProtectionRate != null ? `${p.metrics.leadProtectionRate.toFixed(1)}%` : '—',                             numFn: p => p.metrics?.leadProtectionRate   ?? -1,    higher: true  },
    { label: 'Blown Lead Rate',         fmt: p => p.metrics?.blownLeadRate      != null ? `${p.metrics.blownLeadRate.toFixed(1)}%`      : '—',                             numFn: p => p.metrics?.blownLeadRate        ?? -1,    higher: false },
    // — Mental Game — Under Pressure —
    { isSection: true,  label: 'Mental Game — Under Pressure' },
    { label: 'Clutch Index',            isNorthStar: true, nsColor: '#ef4444', fmt: p => p.metrics?.clutchIndex        != null ? `${p.metrics.clutchIndex.toFixed(1)}%`        : '—',                             numFn: p => p.metrics?.clutchIndex          ?? -1,    higher: true  },
    { label: 'Comeback Wins',           fmt: p => p.metrics ? `${p.metrics.comebackWins}` : '—',                                                                          numFn: p => p.metrics?.comebackWins         ?? -1,    higher: true  },
    { label: 'Deciding Game Win Rate',  fmt: p => p.metrics?.decidingWinRate    != null ? `${p.metrics.decidingWinRate.toFixed(1)}%`    : '—',                             numFn: p => p.metrics?.decidingWinRate      ?? -1,    higher: true  },
    { label: 'Deuce Win Rate',          fmt: p => p.metrics?.deuceWinRate       != null ? `${p.metrics.deuceWinRate.toFixed(1)}%`       : '—',                             numFn: p => p.metrics?.deuceWinRate         ?? -1,    higher: true  },
    { label: 'Momentum — Hot Streak',   fmt: p => p.metrics?.momentumHotRate    != null ? `${p.metrics.momentumHotRate.toFixed(1)}%`    : '—',                             numFn: p => p.metrics?.momentumHotRate      ?? -1,    higher: true  },
    { label: 'Momentum — Cold Streak',  fmt: p => p.metrics?.momentumColdRate   != null ? `${p.metrics.momentumColdRate.toFixed(1)}%`   : '—',                             numFn: p => p.metrics?.momentumColdRate     ?? -1,    higher: true  },
    // — Tournament Depth —
    { isSection: true,  label: 'Tournament Depth' },
    { label: 'Early Rounds Win Rate',   fmt: p => p.metrics?.groupWinRate       != null ? `${p.metrics.groupWinRate.toFixed(1)}%`       : '—',                             numFn: p => p.metrics?.groupWinRate         ?? -1,    higher: true  },
    { label: 'QF / SF Win Rate',        isNorthStar: true, nsColor: '#3b82f6', fmt: p => p.metrics?.knockoutWinRate    != null ? `${p.metrics.knockoutWinRate.toFixed(1)}%`    : '—',                             numFn: p => p.metrics?.knockoutWinRate      ?? -1,    higher: true  },
    { label: 'Finals Win Rate',         fmt: p => p.metrics?.finalWinRate       != null ? `${p.metrics.finalWinRate.toFixed(1)}%`       : '—',                             numFn: p => p.metrics?.finalWinRate         ?? -1,    higher: true  },
  ];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', fontFamily: 'Sora, sans-serif', position: 'relative', zIndex: 4 }}>
      <AuthBar />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13, textDecoration: 'none', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Player dashboard
          </a>
          <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            TOPS · Compare
          </p>
        </div>

        {/* ── Coach selector ── */}
        {isCoach && (
          <CoachH2HSelector
            athletes={allPlayers.filter(p => clubAthletes.includes(String(p.player_id)))}
            fullPlayerList={fullPlayerList}
            setSelectedIds={setSelectedIds}
            competitorPicks={competitorPicks}
            setCompetitorPick={setCompetitorPick}
          />
        )}

        {/* ── Org/Admin player selector ── */}
        {!isCoach && <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
          <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Select players (up to {MAX_PLAYERS})
          </p>

          {/* Selected player pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: selectedIds.length > 0 ? 10 : 0 }}>
            {playersWithMetrics.map((p, i) => (
              <div key={p.pid} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: `${PLAYER_COLORS[i]}15`, border: `1px solid ${PLAYER_COLORS[i]}40`,
                borderRadius: 99, padding: '4px 10px 4px 8px',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: PLAYER_COLORS[i] }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{p.name}</span>
                <button onClick={() => removePlayer(p.pid)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'flex' }}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* Search input */}
          {selectedIds.length < MAX_PLAYERS && (
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', background: '#fafafa' }}>
                <Plus size={13} color="#94a3b8" />
                <input
                  placeholder="Add player…"
                  value={searchTerm}
                  onChange={e => { setSearchTerm(e.target.value); setShowDropdown(true); }}
                  onFocus={() => setShowDropdown(true)}
                  style={{ border: 'none', background: 'none', outline: 'none', fontSize: 13, flex: 1, color: '#1e293b' }}
                />
              </div>
              {showDropdown && searchTerm && filteredSearch.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                  background: 'white', border: '1px solid #e2e8f0', borderRadius: 8,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.08)', marginTop: 4, overflow: 'hidden',
                }}>
                  {filteredSearch.map(p => (
                    <button key={p.player_id} onClick={() => addPlayer(p.player_id)} style={{
                      width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none',
                      background: 'none', cursor: 'pointer', fontSize: 13, color: '#1e293b',
                      borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <span>{p.player_name}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{p.country_code} · {p.gender_label} · #{p.rank}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>}

        {/* ── Empty state ── */}
        {selectedIds.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
            <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Add players to compare</p>
            <p style={{ fontSize: 13 }}>Select up to 5 players to see side-by-side stats, H2H records and rank trajectories</p>
          </div>
        )}

        {/* ── Loading ── */}
        {fetching && (
          <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 13 }}>
            Loading player data…
          </div>
        )}

        {/* ── Window toggle + Data source toggle ── */}
        {hasData && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            {hasAnyIndian ? (
              <div style={{ display: 'flex', gap: 4 }}>
                {[{ id: 'wtt', label: 'WTT' }, { id: 'dom', label: 'DOM' }, { id: 'both', label: 'Both' }].map(o => (
                  <button key={o.id} onClick={() => setDataSource(o.id)} style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                    border: '1px solid', cursor: 'pointer',
                    borderColor: dataSource === o.id ? (o.id === 'dom' ? '#7c3aed' : '#1e293b') : '#e2e8f0',
                    background: dataSource === o.id ? (o.id === 'dom' ? '#7c3aed' : '#1e293b') : 'white',
                    color: dataSource === o.id ? 'white' : '#64748b',
                  }}>{o.label}</button>
                ))}
              </div>
            ) : <div />}
            <div style={{ display: 'flex', gap: 4 }}>
              {WINDOWS.map(w => (
                <button key={w.months} onClick={() => setWindowMonths(w.months)} style={{
                  fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                  border: '1px solid', cursor: 'pointer',
                  borderColor: windowMonths === w.months ? '#1e293b' : '#e2e8f0',
                  background: windowMonths === w.months ? '#1e293b' : 'white',
                  color: windowMonths === w.months ? 'white' : '#64748b',
                }}>{w.label}</button>
              ))}
            </div>
          </div>
        )}

        {/* ── Stats comparison table ── */}
        {hasData && (
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <button onClick={() => setExpandedSection(s => s === 'stats' ? null : 'stats')} style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: expandedSection === 'stats' ? '1px solid #f1f5f9' : 'none',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stats comparison</span>
              {expandedSection === 'stats' ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
            </button>
            {expandedSection === 'stats' && (
              <>
                {/* ── North Star Scorecard ── */}
                {playersWithMetrics.length >= 2 && playersWithMetrics.some(p => p.metrics) && (() => {
                  const NS = [
                    { label: 'Win Rate',   get: m => m?.winRate,        fmt: v => `${v.toFixed(0)}%`,  higher: true, color: '#10b981' },
                    { label: 'Upset Rate', get: m => m?.upsetRate,       fmt: v => v != null ? `${v.toFixed(0)}%` : '—', higher: true, color: '#6366f1' },
                    { label: 'Dominance',  get: m => m?.dominanceRate,   fmt: v => v != null ? `${v.toFixed(0)}%` : '—', higher: true, color: '#f59e0b' },
                    { label: 'Clutch',     get: m => m?.clutchIndex,     fmt: v => v != null ? `${v.toFixed(0)}%` : '—', higher: true, color: '#ef4444' },
                    { label: 'QF / SF',    get: m => m?.knockoutWinRate, fmt: v => v != null ? `${v.toFixed(0)}%` : '—', higher: true, color: '#3b82f6' },
                  ];
                  return (
                    <div style={{ padding: '14px 16px 12px', borderBottom: '2px solid #e2e8f0', background: '#fafbff' }}>
                      <p style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>North Star Scorecard</p>
                      <div style={{ display: 'flex' }}>
                        {NS.map((ns, nsi) => {
                          const vals = playersWithMetrics.map(p => ns.get(p.metrics) ?? null);
                          const nonNull = vals.filter(v => v != null);
                          const best = nonNull.length > 1 ? (ns.higher ? Math.max(...nonNull) : Math.min(...nonNull)) : null;
                          return (
                            <div key={ns.label} style={{ flex: 1, textAlign: 'center', borderRight: nsi < NS.length - 1 ? '1px solid #e2e8f0' : 'none', padding: '0 6px' }}>
                              <p style={{ fontSize: 8, fontWeight: 700, color: ns.color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{ns.label}</p>
                              {playersWithMetrics.map((p, i) => {
                                const v = ns.get(p.metrics);
                                const isBest = v != null && v === best;
                                return (
                                  <p key={p.pid} style={{ fontSize: isBest ? 18 : 13, fontWeight: isBest ? 800 : 500, color: isBest ? PLAYER_COLORS[i] : '#cbd5e1', lineHeight: 1.2, marginBottom: 3 }}>
                                    {v != null ? ns.fmt(v) : '—'}
                                  </p>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 14, marginTop: 12, justifyContent: 'center' }}>
                        {playersWithMetrics.map((p, i) => (
                          <div key={p.pid} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: PLAYER_COLORS[i] }} />
                            <span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>{p.name.split(' ')[0]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* ── Full stats table ── */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 500, width: 172 }}>Metric</th>
                        {playersWithMetrics.map((p, i) => (
                          <th key={p.pid} style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: PLAYER_COLORS[i] }}>
                            {p.name.split(' ')[0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {STAT_ROWS.map((row, ri) => {
                        if (row.isSection) {
                          return (
                            <tr key={ri} style={{ background: '#f8fafc', borderTop: ri > 0 ? '2px solid #e2e8f0' : 'none', borderBottom: '1px solid #e2e8f0' }}>
                              <td colSpan={1 + playersWithMetrics.length} style={{ padding: '7px 16px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                {row.label}
                              </td>
                            </tr>
                          );
                        }

                        const numVals = row.numFn ? playersWithMetrics.map(p => row.numFn(p)) : null;
                        const bestVal = numVals ? (row.higher !== false ? Math.max(...numVals.filter(v => v >= 0)) : Math.min(...numVals.filter(v => v >= 0 && v < 9999))) : null;
                        const isNS    = row.isNorthStar;
                        const nsColor = row.nsColor || '#6366f1';

                        return (
                          <tr key={ri} style={{ borderBottom: '1px solid #f8fafc', background: isNS ? `${nsColor}07` : 'white' }}>
                            <td style={{ padding: isNS ? '11px 16px' : '9px 16px', fontSize: isNS ? 12 : 11, color: isNS ? '#1e293b' : '#64748b', fontWeight: isNS ? 700 : 500, borderLeft: isNS ? `3px solid ${nsColor}` : '3px solid transparent' }}>
                              {row.label}
                            </td>
                            {playersWithMetrics.map((p, i) => {
                              const val    = row.fmt(p);
                              const numVal = row.numFn ? row.numFn(p) : null;
                              const isBest = numVal != null && numVal === bestVal && numVal >= 0 && numVal < 9999 && playersWithMetrics.length > 1;
                              return (
                                <td key={p.pid} style={{ padding: isNS ? '11px 14px' : '9px 14px', textAlign: 'center' }}>
                                  <span style={{
                                    fontSize: isNS ? 16 : 13,
                                    fontWeight: isBest ? 700 : (isNS ? 600 : 500),
                                    color: isBest ? PLAYER_COLORS[i] : (isNS ? '#334155' : '#475569'),
                                    background: isBest ? `${PLAYER_COLORS[i]}18` : 'none',
                                    padding: isBest ? '3px 10px' : 0,
                                    borderRadius: isBest ? 8 : 0,
                                    display: isBest ? 'inline-block' : 'inline',
                                  }}>{val}</span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── H2H Matrix ── */}
        {hasData && playersWithMetrics.length >= 2 && (
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <button onClick={() => setExpandedSection(s => s === 'h2h' ? null : 'h2h')} style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: expandedSection === 'h2h' ? '1px solid #f1f5f9' : 'none',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Head to head</span>
              {expandedSection === 'h2h' ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
            </button>
            {expandedSection === 'h2h' && (
              <div style={{ padding: '4px 0 8px' }}>
                <H2HMatrix playersData={playersWithMetrics} />
                <p style={{ fontSize: 10, color: '#94a3b8', padding: '8px 16px 4px' }}>
                  All-time records across all available match data
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Rank trajectory ── */}
        {hasData && (
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <button onClick={() => setExpandedSection(s => s === 'rank' ? null : 'rank')} style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: expandedSection === 'rank' ? '1px solid #f1f5f9' : 'none',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Rank trajectory</span>
              {expandedSection === 'rank' ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
            </button>
            {expandedSection === 'rank' && (
              <div style={{ padding: '16px' }}>
                {/* Legend */}
                <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                  {playersWithMetrics.map((p, i) => (
                    <div key={p.pid} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 16, height: 2, background: PLAYER_COLORS[i], borderRadius: 1 }} />
                      <span style={{ fontSize: 11, color: '#64748b' }}>{p.name.split(' ')[0]}</span>
                    </div>
                  ))}
                </div>
                <RankChart
                  playersData={playersWithMetrics.filter(p => p.data).map(p => ({
                    pid: p.pid, name: p.name, color: p.color, rankings: p.data?.rankings,
                  }))}
                  windowMonths={windowMonths}
                />
                <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 6, textAlign: 'right' }}>Lower = better rank</p>
              </div>
            )}
          </div>
        )}

        {/* ── W/L Breakdown ── */}
        {hasData && (
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <button onClick={() => setExpandedSection(s => s === 'wl' ? null : 'wl')} style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: expandedSection === 'wl' ? '1px solid #f1f5f9' : 'none',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Win / Loss breakdown</span>
              {expandedSection === 'wl' ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
            </button>
            {expandedSection === 'wl' && (
              <div style={{ padding: 16, display: 'grid', gridTemplateColumns: `repeat(${Math.min(playersWithMetrics.length, 3)}, 1fr)`, gap: 20 }}>
                {playersWithMetrics.map((p, i) => (
                  <div key={p.pid}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: PLAYER_COLORS[i], marginBottom: 10 }}>
                      {p.name.split(' ')[0]}
                    </p>
                    <WLBreakdown metrics={p.metrics} color={PLAYER_COLORS[i]} filter={wlFilter} onFilterChange={setWlFilter} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
