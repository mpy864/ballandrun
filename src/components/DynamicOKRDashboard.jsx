import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import AuthBar from './AuthBar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import {
  ChevronDown, ChevronUp, Search, Star, Zap, Activity, ArrowRight
} from 'lucide-react';


function parseScoresForPlayer(str, isComp1) {
  if (!str || str === 'N/A')
    return { gamesWon: 0, gamesLost: 0, pointsWon: 0, pointsLost: 0, totalGames: 0 };
  let gW = 0, gL = 0, pW = 0, pL = 0;
  for (const g of str.split(',').map(s => s.trim())) {
    const [a, b] = g.split('-').map(Number);
    if (isNaN(a) || isNaN(b)) continue;
    if (a === 0 && b === 0) continue;
    const [p, o] = isComp1 ? [a, b] : [b, a];
    pW += p; pL += o;
    if (p > o) gW++; else gL++;
  }
  return { gamesWon: gW, gamesLost: gL, pointsWon: pW, pointsLost: pL, totalGames: gW + gL };
}

function parseGame1Won(str, isComp1) {
  if (!str || str === 'N/A') return null;
  const first = str.split(',')[0]?.trim();
  if (!first) return null;
  const [a, b] = first.split('-').map(Number);
  if (isNaN(a) || isNaN(b)) return null;
  const [p, o] = isComp1 ? [a, b] : [b, a];
  return p > o;
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

function checkComeback(str, isComp1, won) {
  if (!won || !str || str === 'N/A') return false;
  const games = str.split(',').map(s => s.trim());
  if (games.length < 2) return false;
  const [a, b] = games[0].split('-').map(Number);
  if (isNaN(a) || isNaN(b)) return false;
  return (isComp1 ? a : b) < (isComp1 ? b : a);
}

function fmtMonthYear(date) {
  if (!date || isNaN(date)) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function cleanCompetitionName(name) {
  if (!name) return 'Unknown';
  return name.replace(/\s+presented\s+by\s+.*/i, '').trim();
}

function cleanRound(round) {
  if (!round || round === 'N/A') return null;
  const rofMatch = round.match(/Round of \d+/i);
  if (rofMatch) return rofMatch[0];
  const low = round.toLowerCase();
  // Check semi/quarter BEFORE final — WTT DB uses no-hyphen variants ("Semifinal", "Quarterfinal")
  if (low.includes('semifinal') || low.includes('semi-final') || low.includes('semi final')) return 'Semi-Final';
  if (low.includes('quarterfinal') || low.includes('quarter-final') || low.includes('quarter final')) return 'Quarter-Final';
  if (low.includes('final')) return 'Final';
  if (low.includes('group')) return 'Group Stage';
  if (low.includes('qualifying')) return 'Qualifying';
  const parts = round.split(' - ');
  return parts.length > 1 ? parts[parts.length - 2] || null : null;
}

function parseDisplayGames(str, isComp1) {
  if (!str || str === 'N/A') return [];
  return str.split(',').map(s => s.trim()).filter(g => {
    const [a, b] = g.split('-').map(Number);
    return !isNaN(a) && !isNaN(b) && !(a === 0 && b === 0);
  }).map(g => {
    const [a, b] = g.split('-').map(Number);
    const pScore = isComp1 ? a : b;
    const oScore = isComp1 ? b : a;
    return { pScore, oScore, pWon: pScore > oScore };
  });
}

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
  if (!handedness && !grip) return null;
  const parts = [];
  if (handedness) parts.push(handedness.replace(' Hand', ''));
  if (grip) parts.push(grip);
  return parts.join(' · ');
}

const MONTH_MAP = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};

function parseDomesticDate(match_datetime, season) {
  if (!match_datetime) return new Date(0);
  try {
    const dayMon = match_datetime.split(',')[0].trim();
    const [dayStr, monStr] = dayMon.split('-');
    const monthNum = MONTH_MAP[monStr];
    if (monthNum === undefined) return new Date(0);
    const baseYear = parseInt(season?.split('-')[0] || '2024');
    const year = monthNum <= 2 ? baseYear + 1 : baseYear;
    return new Date(year, monthNum, parseInt(dayStr));
  } catch(e) { return new Date(0); }
}

function slugToName(slug) {
  try {
    return decodeURIComponent(slug)
      .replace(/-+/g, ' ')
      .replace(/utt /gi, '')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim()
      .substring(0, 55);
  } catch(e) { return slug; }
}

const DOM_ROUND_MAP = {
  'FINAL': 'Final', 'SF': 'Semi-Final', 'QF': 'Quarter-Final',
  'R/16': 'Round of 16', 'R/32': 'Round of 32',
  'R/64': 'Round of 64', 'R/128': 'Round of 128',
};

// ─── Round depth helpers (module-level so available everywhere) ───────────────

const ROUND_DEPTH = {
  'Final': 0, 'Semi-Final': 1, 'Quarter-Final': 2,
  'Round of 16': 3, 'Round of 32': 4, 'Round of 64': 5,
  'Round of 128': 6, 'Group Stage': 7,
};

function cleanRoundForDepth(r) {
  if (!r) return null;
  if (r === 'SF'    || r.includes('Semi'))    return 'Semi-Final';
  if (r === 'QF'    || r.includes('Quarter')) return 'Quarter-Final';
  if (r === 'FINAL' || (r.includes('Final') && !r.includes('Semi') && !r.includes('Quarter'))) return 'Final';
  if (r === 'R/16'  || r.includes('Round of 16'))  return 'Round of 16';
  if (r === 'R/32'  || r.includes('Round of 32'))  return 'Round of 32';
  if (r === 'R/64'  || r.includes('Round of 64'))  return 'Round of 64';
  if (r === 'R/128' || r.includes('Round of 128')) return 'Round of 128';
  if (r.includes('Group')) return 'Group Stage';
  return null;
}

const Q_START = new Set([1, 4, 7, 10]);

function buildRankChartData(rankingHistory, windowMonths) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - windowMonths);
  cutoff.setHours(0, 0, 0, 0);
  const sorted = [...rankingHistory]
    .filter(r => new Date(r.ranking_date) >= cutoff)
    .sort((a, b) => new Date(a.ranking_date) - new Date(b.ranking_date));
  if (!sorted.length) return { data: [], ticks: [] };
  const data = sorted.map(r => {
    const d = new Date(r.ranking_date);
    return { x: d.getTime(), fullDate: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), rank: r.rank };
  });
  const ticks = [];
  const seen = new Set();
  for (const pt of data) {
    const d = new Date(pt.x);
    const mo = d.getMonth() + 1;
    const key = `${d.getFullYear()}-${mo}`;
    if (windowMonths === 6) {
      if (!seen.has(key)) { seen.add(key); ticks.push(pt.x); }
    } else {
      if (Q_START.has(mo) && !seen.has(key)) { seen.add(key); ticks.push(pt.x); }
    }
  }
  return { data, ticks };
}

function computeWindowData(matchLedger, rankingHistory, windowMonths, playerCurrentRank) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - windowMonths);
  cutoff.setHours(0, 0, 0, 0);
  const filtered = matchLedger.filter(m => m.rawDate >= cutoff);
  const wins   = filtered.filter(m => m.result === 'W');
  const losses = filtered.filter(m => m.result === 'L');
  const total  = filtered.length;

  const winRate     = total > 0 ? (wins.length / total) * 100 : 0;
  const upsetYield  = wins.length > 0 ? (wins.filter(m => m.isUpset).length / wins.length) * 100 : 0;
  // Clutch Index = win rate in deciding-game matches (3-2 or 4-3), both wins and losses
  const clutchGames = filtered.filter(m => m.gamesLost === m.gamesWon - 1 || m.gamesLost === m.gamesWon + 1);
  const clutchIndex = clutchGames.length > 0 ? (clutchGames.filter(m => m.result === 'W').length / clutchGames.length) * 100 : null;

  let td = 0, dc = 0;
  for (const m of filtered) { if (m.pointDiff != null) { td += m.pointDiff; dc++; } }
  const avgPtDiff = dc > 0 ? td / dc : 0;

  const rankAtStart = rankingHistory.find(r => new Date(r.ranking_date) <= cutoff)?.rank;
  const rankChange  = rankAtStart ? rankAtStart - playerCurrentRank : 0;

  const beaten = wins.filter(m => m.opponentRank < 999).map(m => m.opponentRank);
  const avgOppRankBeaten = beaten.length > 0
    ? Math.round(beaten.reduce((s, v) => s + v, 0) / beaten.length) : null;

  const straightSetsWins   = wins.filter(m => m.isStraightWin).length;
  const straightSetsLosses = losses.filter(m => m.isStraightLoss).length;
  const comebackWins       = wins.filter(m => m.isComeback).length;

  // --- Performance vs Worse-Ranked ---
  // All comparisons use playerRankAtMatch (rank at the time of the match), not current rank
  const ranked = filtered.filter(m => m.opponentRank !== 999 && m.playerRankAtMatch && m.playerRankAtMatch !== 999);
  const vsLower  = ranked.filter(m => m.opponentRank > m.playerRankAtMatch);
  const vsHigher = ranked.filter(m => m.opponentRank < m.playerRankAtMatch);
  const vsLowerWins   = vsLower.filter(m => m.result === 'W').length;
  const vsHigherWins  = vsHigher.filter(m => m.result === 'W').length;

  const dominanceRate  = vsLower.length  > 0 ? (vsLowerWins  / vsLower.length)  * 100 : null;
  const upsetRate      = vsHigher.length > 0 ? (vsHigherWins / vsHigher.length) * 100 : null;
  const bananaSkinMatches = losses.filter(m => m.opponentRank !== 999 && m.playerRankAtMatch && m.opponentRank > m.playerRankAtMatch);
  const bananaSkinRate = losses.length > 0 ? (bananaSkinMatches.length / losses.length) * 100 : 0;

  // Hold Rate: win% vs players ranked 20+ below at match time
  const vsMuchLower     = ranked.filter(m => m.opponentRank > m.playerRankAtMatch + 20);
  const holdRate        = vsMuchLower.length > 0 ? (vsMuchLower.filter(m => m.result === 'W').length / vsMuchLower.length) * 100 : null;

  // --- Pressure & Context ---
  // Rank Proximity Win Rate (opponent within ±10 ranks at match time)
  const vsProximity      = ranked.filter(m => Math.abs(m.opponentRank - m.playerRankAtMatch) <= 10);
  const proximityWinRate = vsProximity.length > 0 ? (vsProximity.filter(m => m.result === 'W').length / vsProximity.length) * 100 : null;

  // Comfort Zone Index: how much better vs weaker than vs stronger (ratio)
  const comfortZoneIndex = (dominanceRate !== null && upsetRate !== null && upsetRate > 0)
    ? +(dominanceRate / upsetRate).toFixed(2) : null;

  // --- Historical Rank-Based Peer & Ambition Zones ---
  // Uses BOTH player and opponent rank at the time of the match (not current rank)
  const historicalRanked = filtered.filter(m => m.opponentRank !== 999 && m.playerRankAtMatch && m.playerRankAtMatch !== 999);
  const peerMatches      = historicalRanked.filter(m => Math.abs(m.opponentRank - m.playerRankAtMatch) <= 20);
  const ambitionMatches  = historicalRanked.filter(m => m.playerRankAtMatch - m.opponentRank > 20); // opponent 20+ higher ranked
  const peerWins         = peerMatches.filter(m => m.result === 'W').length;
  const ambitionWins     = ambitionMatches.filter(m => m.result === 'W').length;
  const peerWinRate      = peerMatches.length > 0 ? (peerWins / peerMatches.length) * 100 : null;
  const ambitionWinRate  = ambitionMatches.length > 0 ? (ambitionWins / ambitionMatches.length) * 100 : null;

  // Momentum Sensitivity: win rate entering match on 3-win vs 3-loss streak
  const sortedChron = [...filtered].sort((a, b) => a.rawDate - b.rawDate);
  let hotWins = 0, hotTotal = 0, coldWins = 0, coldTotal = 0;
  const hotMatches = [], coldMatches = [];
  for (let i = 3; i < sortedChron.length; i++) {
    const prior = sortedChron.slice(i - 3, i);
    const curr  = sortedChron[i];
    if (prior.every(m => m.result === 'W')) {
      hotTotal++; hotMatches.push(curr);
      if (curr.result === 'W') hotWins++;
    } else if (prior.every(m => m.result === 'L')) {
      coldTotal++; coldMatches.push(curr);
      if (curr.result === 'W') coldWins++;
    }
  }
  const momentumHotRate  = hotTotal  >= 3 ? (hotWins  / hotTotal)  * 100 : null;
  const momentumColdRate = coldTotal >= 3 ? (coldWins / coldTotal) * 100 : null;

  // --- Current Form (last 10 matches by date) ---
  const sortedDesc = [...filtered].sort((a, b) => b.rawDate - a.rawDate);
  const currentForm = sortedDesc.slice(0, 10).map(m => m.result);

  // --- Points Per Game ---
  let totalPtsWon = 0, totalGamesPlayed = 0;
  for (const m of filtered) {
    if (m.totalGames > 0) { totalPtsWon += (m.pointsWon || 0); totalGamesPlayed += m.totalGames; }
  }
  const pointsPerGame = totalGamesPlayed > 0 ? totalPtsWon / totalGamesPlayed : null;

  // --- Giant Killer Index ---
  const vsTop20 = filtered.filter(m => m.opponentRank !== 999 && m.opponentRank <= 20);
  const vsTop50 = filtered.filter(m => m.opponentRank !== 999 && m.opponentRank <= 50);
  const giantKillerTop20 = vsTop20.length > 0 ? (vsTop20.filter(m => m.result === 'W').length / vsTop20.length) * 100 : null;
  const giantKillerTop50 = vsTop50.length > 0 ? (vsTop50.filter(m => m.result === 'W').length / vsTop50.length) * 100 : null;

  // --- Biggest Rank Scalp ---
  const upsetWinMatches = wins.filter(m => m.opponentRank !== 999 && m.playerRankAtMatch && m.opponentRank < m.playerRankAtMatch);
  const biggestScalpRank = upsetWinMatches.length > 0 ? Math.min(...upsetWinMatches.map(m => m.opponentRank)) : null;
  const biggestScalpMatch = biggestScalpRank !== null ? [upsetWinMatches.find(m => m.opponentRank === biggestScalpRank)] : [];

  // --- Lead Protection & Blown Lead ---
  const wonGame1Matches = filtered.filter(m => m.wonGame1 === true);
  const leadProtectionRate = wonGame1Matches.length > 0 ? (wonGame1Matches.filter(m => m.result === 'W').length / wonGame1Matches.length) * 100 : null;
  const blownLeadMatches   = wonGame1Matches.filter(m => m.result === 'L');
  const blownLeadRate      = wonGame1Matches.length > 0 ? (blownLeadMatches.length / wonGame1Matches.length) * 100 : null;

  // --- Deciding Game Win Rate (matches going to game 5 or 7) ---
  const decidingMatches = filtered.filter(m => m.totalGames === 5 || m.totalGames === 7);
  const decidingWinRate = decidingMatches.length > 0 ? (decidingMatches.filter(m => m.result === 'W').length / decidingMatches.length) * 100 : null;

  // --- Deuce Win Rate ---
  let deuceWon = 0, deuceTotal = 0;
  const deuceMatches = [];
  for (const m of filtered) {
    if (m.deuceGames) {
      const d = m.deuceGames.won + m.deuceGames.lost;
      if (d > 0) { deuceMatches.push(m); deuceWon += m.deuceGames.won; deuceTotal += d; }
    }
  }
  const deuceWinRate = deuceTotal > 0 ? (deuceWon / deuceTotal) * 100 : null;

  // --- Tournament Depth ---
  // Normalise round string (handles raw WTT round_phase like "Round 1 - Semi-Final")
  const normaliseRound = r => {
    if (!r || r === 'N/A') return null;
    const cr = cleanRound(r);                    // re-use existing parser
    if (cr) return cr;
    const low = r.toLowerCase();
    if (low.includes('final') && !low.includes('semi') && !low.includes('quarter')) return 'Final';
    if (low.includes('semi'))    return 'Semi-Final';
    if (low.includes('quarter')) return 'Quarter-Final';
    if (low.includes('group'))   return 'Group Stage';
    return r;
  };

  const ROUND_DEPTH  = { 'Final': 7, 'Semi-Final': 6, 'Quarter-Final': 5, 'Round of 16': 4, 'Round of 32': 3, 'Round of 64': 2, 'Round of 128': 1, 'Group Stage': 1 };
  const DEPTH_LABEL  = { 7: 'Final', 6: 'SF', 5: 'QF', 4: 'R/16', 3: 'R/32', 2: 'R/64', 1: 'Group Stage' };
  const SFQF_SET  = new Set(['Semi-Final', 'Quarter-Final']);  // mutually exclusive from Finals
  const EARLY_SET = new Set(['Round of 16', 'Round of 32', 'Round of 64', 'Round of 128', 'Group Stage']);

  const normRound      = m => normaliseRound(m.round);
  const finalsMatches   = filtered.filter(m => normRound(m) === 'Final');
  const knockoutMatches = filtered.filter(m => SFQF_SET.has(normRound(m)));   // QF + SF only
  const groupMatches    = filtered.filter(m => { const nr = normRound(m); return nr && EARLY_SET.has(nr); });

  const finalsWinRate   = finalsMatches.length   > 0 ? (finalsMatches.filter(m => m.result === 'W').length   / finalsMatches.length)   * 100 : null;
  const knockoutWinRate = knockoutMatches.length  > 0 ? (knockoutMatches.filter(m => m.result === 'W').length / knockoutMatches.length)  * 100 : null;
  const groupWinRate    = groupMatches.length     > 0 ? (groupMatches.filter(m => m.result === 'W').length    / groupMatches.length)     * 100 : null;

  const tournamentDepths = {};
  const tournamentGrade  = {};
  for (const m of filtered) {
    const depth = ROUND_DEPTH[normRound(m)];
    if (depth) {
      const key = m.tournamentKey;
      if (!tournamentDepths[key] || depth > tournamentDepths[key]) {
        tournamentDepths[key] = depth;
        tournamentGrade[key]  = m.eventTier != null ? String(m.eventTier) : 'Unknown';
      }
    }
  }
  const depthValues   = Object.values(tournamentDepths);
  const avgRoundDepth = depthValues.length > 0 ? depthValues.reduce((s, v) => s + v, 0) / depthValues.length : null;
  const avgRoundLabel = avgRoundDepth !== null ? (DEPTH_LABEL[Math.round(avgRoundDepth)] || `Rd ${avgRoundDepth.toFixed(1)}`) : null;

  // Avg round by event grade
  const gradeDepthMap = {};
  for (const [key, depth] of Object.entries(tournamentDepths)) {
    const grade = tournamentGrade[key] || 'Unknown';
    if (!gradeDepthMap[grade]) gradeDepthMap[grade] = [];
    gradeDepthMap[grade].push(depth);
  }
  const avgRoundByGrade = Object.entries(gradeDepthMap)
    .filter(([g]) => g !== 'Unknown')
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([grade, vals]) => {
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      return { grade, avg, label: DEPTH_LABEL[Math.round(avg)] || `Rd ${avg.toFixed(1)}`, count: vals.length };
    });

  const rankBuckets = [
    { label: 'Top 20',      min: 0,   max: 20   },
    { label: 'Rank 21–50',  min: 21,  max: 50   },
    { label: 'Rank 51–100', min: 51,  max: 100  },
    { label: 'Rank 100+',   min: 101, max: 9999 },
  ].map(b => {
    const bm = filtered.filter(m => m.opponentRank >= b.min && m.opponentRank <= b.max);
    const bw = bm.filter(m => m.result === 'W').length;
    const bl = bm.filter(m => m.result === 'L').length;
    const bt = bw + bl;
    return { ...b, wins: bw, losses: bl, total: bt, winPct: bt > 0 ? (bw / bt) * 100 : 0, matches: bm };
  });

  const tierMap = {};
  for (const m of filtered) {
    const t = m.eventTier != null ? String(m.eventTier) : 'Unknown';
    if (!tierMap[t]) tierMap[t] = { wins: 0, losses: 0, matches: [] };
    if (m.result === 'W') tierMap[t].wins++; else tierMap[t].losses++;
    tierMap[t].matches.push(m);
  }
  const tierBuckets = Object.entries(tierMap).map(([tier, t]) => {
    const bt = t.wins + t.losses;
    return { label: tier === 'Unknown' ? 'Unclassified' : `Grade ${tier}`, tier,
      wins: t.wins, losses: t.losses, total: bt,
      winPct: bt > 0 ? (t.wins / bt) * 100 : 0, matches: t.matches };
  }).sort((a, b) => a.tier === 'Unknown' ? 1 : b.tier === 'Unknown' ? -1 : parseInt(a.tier) - parseInt(b.tier));

  const cmap = {};
  for (const m of filtered) {
    if (!cmap[m.opponent]) cmap[m.opponent] = { name: m.opponent, wins: 0, losses: 0, currentRank: m.opponentCurrentRank, matches: [] };
    if (m.result === 'W') cmap[m.opponent].wins++; else cmap[m.opponent].losses++;
    cmap[m.opponent].matches.push(m);
  }
  const topCompetitors = Object.values(cmap)
    .map(c => { const bt = c.wins + c.losses; return { ...c, total: bt, winPct: bt > 0 ? (c.wins / bt) * 100 : 0 }; })
    .sort((a, b) => b.total - a.total).slice(0, 5);

  const nmap = {};
  for (const m of filtered) {
    const cc = m.opponentCountry; if (!cc) continue;
    if (!nmap[cc]) nmap[cc] = { country: cc, wins: 0, losses: 0, matches: [] };
    if (m.result === 'W') nmap[cc].wins++; else nmap[cc].losses++;
    nmap[cc].matches.push(m);
  }
  const topNations = Object.values(nmap)
    .map(n => { const bt = n.wins + n.losses; return { ...n, total: bt, winPct: bt > 0 ? (n.wins / bt) * 100 : 0 }; })
    .sort((a, b) => b.total - a.total).slice(0, 8);

  const stylemap = {};
  for (const m of filtered) {
    const hand = m.opponentHandedness || 'Unknown';
    const grip = m.opponentGrip || 'Unknown';
    const key = hand === 'Unknown' && grip === 'Unknown' ? 'Unknown'
      : [hand.replace(' Hand',''), grip].filter(s => s && s !== 'Unknown').join(' · ') || 'Unknown';
    if (!stylemap[key]) stylemap[key] = { style: key, wins: 0, losses: 0, matches: [] };
    if (m.result === 'W') stylemap[key].wins++; else stylemap[key].losses++;
    stylemap[key].matches.push(m);
  }
  const styleGroups = Object.values(stylemap)
    .map(s => { const bt = s.wins + s.losses; return { ...s, total: bt, winPct: bt > 0 ? (s.wins / bt) * 100 : 0 }; })
    .sort((a, b) => b.total - a.total);

  const gripmap = {};
  for (const m of filtered) {
    const grip = m.opponentGrip || 'Unknown';
    if (!gripmap[grip]) gripmap[grip] = { grip, wins: 0, losses: 0, matches: [] };
    if (m.result === 'W') gripmap[grip].wins++; else gripmap[grip].losses++;
    gripmap[grip].matches.push(m);
  }
  const gripGroups = Object.values(gripmap)
    .map(g => { const bt = g.wins + g.losses; return { ...g, total: bt, winPct: bt > 0 ? (g.wins / bt) * 100 : 0 }; })
    .sort((a, b) => b.total - a.total);

  return {
    winRate, upsetYield, clutchIndex, avgPtDiff, rankChange,
    matchCount: total, wins: wins.length, losses: losses.length,
    straightSetsWins, straightSetsLosses, comebackWins, avgOppRankBeaten,
    rankBuckets, tierBuckets, topCompetitors, topNations, styleGroups, gripGroups,
    dnaGroups: {
      straightWins:   wins.filter(m => m.isStraightWin),
      straightLosses: losses.filter(m => m.isStraightLoss),
      comebacks:      wins.filter(m => m.isComeback),
      clutch:         clutchGames,
    },
    currentForm, pointsPerGame,
    rankContext: {
      dominanceRate, bananaSkinRate, holdRate, upsetRate,
      vsLowerMatches: vsLower, vsHigherMatches: vsHigher, bananaSkinMatches, holdMatches: vsMuchLower,
      vsLowerCount: vsLower.length, vsHigherCount: vsHigher.length,
      proximityWinRate, comfortZoneIndex,
      vsProximityMatches: vsProximity,
      vsRankedMatches: [...vsLower, ...vsHigher].sort((a, b) => b.rawDate - a.rawDate),
      peerWinRate, peerMatches, ambitionWinRate, ambitionMatches,
      momentumHotRate, momentumColdRate, hotTotal, coldTotal, hotMatches, coldMatches,
      giantKillerTop20, giantKillerTop50, vsTop20, vsTop50,
      biggestScalpRank, biggestScalpMatch,
      leadProtectionRate, blownLeadRate, blownLeadMatches, wonGame1Matches,
      decidingWinRate, decidingMatches, deuceWinRate, deuceTotal, deuceMatches,
      finalsWinRate, knockoutWinRate, groupWinRate,
      finalsMatches, knockoutMatches, groupMatches,
      avgRoundLabel, depthValues, avgRoundByGrade,
    },
    allMatches: filtered,
  };
}

function nsNarrative(key, value) {
  if (value == null) return null;
  const v = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(v)) return null;
  switch (key) {
    case 'winrate':
      return v >= 65 ? `Winning ${v.toFixed(0)}% — dominant across this period`
           : v >= 50 ? `Above 50% — winning more than losing across this window`
           : v >= 40 ? `Below breakeven — more losses than wins in this period`
           :           `Under 40% — a difficult stretch to understand and address`;
    case 'upsetrate':
      return v >= 40 ? `Beating ${v.toFixed(0)}% of higher-ranked opponents — a genuine giant-killer`
           : v >= 25 ? `Punching above weight in roughly 1 of every 4 higher-ranked contests`
           : v >= 10 ? `Occasionally threatening stronger opposition — ambition is developing`
           :           `Rarely capitalising against higher-ranked players`;
    case 'dominance':
      return v >= 80 ? `${v.toFixed(0)}% against lower-ranked opponents — a rock-solid baseline`
           : v >= 60 ? `Holding ground in the majority of expected wins`
           : v >= 40 ? `Dropping too many must-win matches — consistency is a concern`
           :           `Losing the majority of expected wins — a reliability issue`;
    case 'clutch':
      return v >= 65 ? `Converting ${v.toFixed(0)}% of deciding matches — a closer who delivers`
           : v >= 50 ? `Slightly ahead in five-setters — composed when it counts`
           : v >= 35 ? `Losing the edge in tight matches — mental game to develop`
           :           `Below 35% in deciding matches — pressure a current challenge`;
    case 'knockout':
      return v === 0  ? `No knockout wins yet — deep runs are the next milestone`
           : v >= 60  ? `${v.toFixed(0)}% in QF/SF — a genuine late-stage threat`
           : v >= 40  ? `Close to half of knockout opportunities converted`
           :            `Below 50% in knockouts — exits before the business end`;
    default: return null;
  }
}

function computeVerdict(w) {
  if (w.matchCount < 5) return { text: 'Insufficient data', tone: 'gray' };
  const up = w.rankChange > 0, strong = w.winRate >= 50;
  if (up && strong)   return { text: `Ascending — up ${w.rankChange} places`,                    tone: 'green' };
  if (!up && !strong) return { text: 'Declining — rank and win rate both falling',                tone: 'red'   };
  if (up && !strong)  return { text: `Quietly rising — rank up ${w.rankChange} on quality wins`, tone: 'blue'  };
  return                     { text: 'Plateau — results stable, no ranking movement',            tone: 'amber' };
}

const TONE = {
  green: { text: 'text-emerald-700', bg: 'bg-emerald-50',  dot: '#10b981' },
  red:   { text: 'text-red-600',     bg: 'bg-red-50',      dot: '#ef4444' },
  blue:  { text: 'text-sky-700',     bg: 'bg-sky-50',      dot: '#3b82f6' },
  amber: { text: 'text-amber-700',   bg: 'bg-amber-50',    dot: '#f59e0b' },
  gray:  { text: 'text-slate-500',   bg: 'bg-slate-100',   dot: '#94a3b8' },
};

const TR_STYLE = { cursor: 'pointer' };

function MatchRow({ match: m }) {
  const [open, setOpen] = useState(false);
  const isWin    = m.result === 'W';
  const scoreStr = `${m.gamesWon}-${m.gamesLost}`;
  const comp     = cleanCompetitionName(m.tournament);
  const round    = cleanRound(m.round);
  const games    = parseDisplayGames(m.score, m.isComp1);
  const isUnknown = !m.opponent || m.opponent === 'Unknown';
  const hasDetail = !isUnknown;
  const row1Bg   = open ? { backgroundColor: 'rgba(239,246,255,0.6)' } : {};
  const row2Bg   = { backgroundColor: 'var(--row2-bg, #f8fafc)' };

  return (
    <>
      <tr onClick={() => hasDetail && setOpen(o => !o)}
        style={{ ...TR_STYLE, borderBottom: open ? 'none' : undefined, ...row1Bg }}
        className={`border-b border-slate-100 ${hasDetail ? 'hover:bg-blue-50/20' : ''} transition-colors`}>
        <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {m.isDomestic && (
              <span style={{ fontSize: 8, fontWeight: 700, color: '#7c3aed', background: '#ede9fe',
                padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>DOM</span>
            )}
            <span style={{ fontSize: 13, fontWeight: 500,
              color: isUnknown ? '#94a3b8' : 'var(--color-text-primary)',
              fontStyle: isUnknown ? 'italic' : 'normal',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isUnknown ? 'Opponent unavailable' : m.opponent}
            </span>
          </div>
        </td>
        <td style={{ padding: '10px 14px', verticalAlign: 'middle', textAlign: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)',
            display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isUnknown ? '—' : comp}
          </span>
        </td>
        <td style={{ padding: '10px 14px', verticalAlign: 'middle', textAlign: 'right', whiteSpace: 'nowrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {m.isUpset    && <Star size={10} style={{ color: '#10b981' }} />}
            {m.isClutch   && <Zap  size={10} style={{ color: '#f59e0b' }} />}
            {m.isComeback && <span style={{ fontSize: 9, color: '#0ea5e9', fontWeight: 700 }}>↩</span>}
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
              minWidth: 34, textAlign: 'center',
              background: isWin ? '#d1fae5' : '#fee2e2',
              color: isWin ? '#065f46' : '#991b1b' }}>{scoreStr}</span>
            {hasDetail && (open
              ? <ChevronUp size={11} style={{ color: '#94a3b8' }} />
              : <ChevronDown size={11} style={{ color: '#94a3b8' }} />)}
            {!hasDetail && <span style={{ display: 'inline-block', width: 11 }} />}
          </span>
        </td>
      </tr>
      {open && (
        <tr style={row2Bg} className="border-b-0">
          <td style={{ padding: '5px 14px 2px', verticalAlign: 'middle' }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {m.opponentRank !== 999 && `#${m.opponentRank}`}
              {m.opponentRank !== 999 && m.opponentCountry && ' · '}
              {m.opponentCountry && m.opponentCountry.toUpperCase()}
            </span>
          </td>
          <td style={{ padding: '5px 14px 2px', verticalAlign: 'middle', textAlign: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {round && `${round} · `}{fmtMonthYear(m.rawDate)}
            </span>
          </td>
          <td style={{ padding: '5px 14px 2px', verticalAlign: 'middle', textAlign: 'right', whiteSpace: 'nowrap' }}>
            <span style={{ display: 'inline-flex', gap: 6, fontSize: 10, fontWeight: 600 }}>
              {m.isUpset    && <span style={{ color: '#059669', display:'flex', alignItems:'center', gap:2 }}><Star size={9} />Upset</span>}
              {m.isClutch   && <span style={{ color: '#b45309', display:'flex', alignItems:'center', gap:2 }}><Zap size={9} />Clutch</span>}
              {m.isComeback && <span style={{ color: '#0284c7' }}>↩ Comeback</span>}
            </span>
          </td>
        </tr>
      )}
      {open && (
        <tr style={{ ...row2Bg, borderBottom: '0.5px solid #f1f5f9' }}>
          <td colSpan={3} style={{ padding: '3px 14px 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {[calcAge(m.opponentDob) ? `Age ${calcAge(m.opponentDob)}` : null,
                  fmtStyle(m.opponentHandedness, m.opponentGrip)].filter(Boolean).join(' · ')}
              </span>
              <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {games.length > 0
                  ? games.map((g, i) => (
                    <span key={i} style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                      background: g.pWon ? '#d1fae5' : '#fee2e2', color: g.pWon ? '#065f46' : '#991b1b' }}>
                      {g.pScore}–{g.oScore}
                    </span>
                  ))
                  : <span style={{ fontSize: 11, color: '#cbd5e1' }}>No score data</span>}
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MatchList({ matches }) {
  if (!matches?.length)
    return <p className="text-xs text-slate-400 px-4 py-3">No matches in this window.</p>;
  return (
    <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
      <colgroup>
        <col style={{ width: '28%' }} /><col style={{ width: '40%' }} /><col style={{ width: '32%' }} />
      </colgroup>
      <tbody>{matches.map((m, i) => <MatchRow key={i} match={m} />)}</tbody>
    </table>
  );
}

function WLBarRows({ label, sublabel, wins, losses, winPct, isOpen, onToggle, children }) {
  const total = wins + losses;
  const HL = isOpen ? { backgroundColor: 'rgba(239,246,255,0.5)' } : {};
  return (
    <>
      <tr onClick={() => total > 0 && onToggle()}
        style={{ cursor: total > 0 ? 'pointer' : 'default', borderBottom: '0.5px solid #f1f5f9', ...HL }}
        className="transition-colors hover:bg-slate-50/60">
        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>{label}</td>
        <td style={{ padding: '10px 14px', fontSize: 10, color: '#94a3b8' }}>{sublabel || ''}</td>
        <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
          {total > 0 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: '#059669' }}>{wins}W</span>
                <span style={{ color: '#94a3b8' }}> / </span>
                <span style={{ fontWeight: 600, color: '#f87171' }}>{losses}L</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 36, textAlign: 'right',
                color: winPct >= 50 ? '#059669' : '#f87171' }}>{winPct.toFixed(0)}%</span>
              {isOpen ? <ChevronUp size={13} style={{ color: '#94a3b8' }} /> : <ChevronDown size={13} style={{ color: '#94a3b8' }} />}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>No matches</span>
          )}
        </td>
      </tr>
      {total > 0 && (
        <tr style={{ borderBottom: isOpen ? 'none' : '0.5px solid #f1f5f9', ...HL }}>
          <td colSpan={3} style={{ padding: '0 14px 8px' }}>
            <div style={{ height: 6, borderRadius: 99, background: '#f1f5f9', overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${winPct}%`, background: '#34d399', transition: 'width 0.5s' }} />
              <div style={{ width: `${100 - winPct}%`, background: '#fca5a5', transition: 'width 0.5s' }} />
            </div>
          </td>
        </tr>
      )}
      {isOpen && children}
    </>
  );
}

function WindowToggle({ value, onChange }) {
  return (
    <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
      {['6M', '12M', '18M'].map(w => (
        <button key={w} onClick={() => onChange(w)}
          className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
            value === w ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
          {w}
        </button>
      ))}
    </div>
  );
}

function DataSourceToggle({ value, onChange, showDomestic }) {
  const opts = [
    { id: 'wtt',      label: 'WTT' },
    ...(showDomestic ? [
      { id: 'domestic', label: 'DOM' },
      { id: 'both',     label: 'BOTH' },
    ] : []),
  ];
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-slate-400 uppercase tracking-wider mr-1">Data</span>
      <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
        {opts.map(o => (
          <button key={o.id} onClick={() => onChange(o.id)}
            className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
              value === o.id
                ? o.id === 'domestic' ? 'bg-violet-600 text-white shadow-sm'
                  : o.id === 'both' ? 'bg-slate-800 text-white shadow-sm'
                  : 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-400 hover:text-slate-600'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── TournamentFormTab ────────────────────────────────────────────────────────
// ROUND_DEPTH and cleanRoundForDepth are module-level — always in scope

function TournamentFormTab({ matchLedger, showAll, onToggleAll }) {
  const groups = useMemo(() => {
    const map = {};
    for (const m of matchLedger) {
      const key = m.isDomestic ? `dom__${m.tournamentKey}` : `wtt__${m.tournamentKey}`;
      if (!map[key]) map[key] = {
        key, name: cleanCompetitionName(m.tournament), isDomestic: m.isDomestic,
        matches: [], latestDate: new Date(0), deepest: null, deepestOrder: 999,
      };
      map[key].matches.push(m);
      if (m.rawDate > map[key].latestDate) map[key].latestDate = m.rawDate;
      const cleaned = cleanRoundForDepth(m.round);
      const rOrder  = ROUND_DEPTH[cleaned] ?? 99;
      if (rOrder < map[key].deepestOrder) {
        map[key].deepest      = cleaned;
        map[key].deepestOrder = rOrder;
      }
    }
    return Object.values(map).sort((a, b) => b.latestDate - a.latestDate);
  }, [matchLedger]);

  const display = showAll ? groups : groups.slice(0, 5);

  if (groups.length === 0)
    return <p className="text-sm text-slate-400 px-5 py-4">No matches found.</p>;

  const depthBadgeStyle = (deepest) => ({
    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
    background:
      deepest === 'Final'         ? '#fef3c7' :
      deepest === 'Semi-Final'    ? '#ede9fe' :
      deepest === 'Quarter-Final' ? '#e0f2fe' :
      deepest === 'Round of 16'   ? '#d1fae5' : '#f1f5f9',
    color:
      deepest === 'Final'         ? '#92400e' :
      deepest === 'Semi-Final'    ? '#5b21b6' :
      deepest === 'Quarter-Final' ? '#0369a1' :
      deepest === 'Round of 16'   ? '#065f46' : '#64748b',
  });

  return (
    <div className="slide divide-y divide-slate-100">
      {display.map(g => {
        const wins   = g.matches.filter(m => m.result === 'W').length;
        const losses = g.matches.filter(m => m.result === 'L').length;
        const sorted = [...g.matches].sort((a, b) => {
          const da = ROUND_DEPTH[cleanRoundForDepth(a.round)] ?? 99;
          const db = ROUND_DEPTH[cleanRoundForDepth(b.round)] ?? 99;
          return da - db;
        });
        return (
          <details key={g.key} className="group">
            <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-slate-50 list-none">
              <div className="flex items-center gap-2 min-w-0">
                {g.isDomestic && (
                  <span style={{ fontSize: 8, fontWeight: 700, color: '#7c3aed', background: '#ede9fe',
                    padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>DOM</span>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{g.name}</div>
                  <div className="text-xs text-slate-400">{fmtMonthYear(g.latestDate)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                {g.deepest && <span style={depthBadgeStyle(g.deepest)}>{g.deepest}</span>}
                <span className="text-xs text-slate-500">
                  <span className="text-emerald-600 font-semibold">{wins}W</span>
                  <span className="text-slate-300"> / </span>
                  <span className="text-red-400 font-semibold">{losses}L</span>
                </span>
                <ChevronDown size={13} className="text-slate-400 group-open:rotate-180 transition-transform" />
              </div>
            </summary>
            <div className="bg-slate-50 border-t border-slate-100">
              <MatchList matches={sorted} />
            </div>
          </details>
        );
      })}
      {groups.length > 5 && (
        <div className="px-5 py-3">
          <button onClick={onToggleAll}
            className="text-sm text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1">
            {showAll
              ? <><ChevronUp size={13} /> Show less</>
              : <><ChevronDown size={13} /> Show all {groups.length} tournaments</>}
          </button>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: 'rank',        label: 'Rank'        },
  { id: 'winloss',     label: 'Win/Loss'    },
  { id: 'performance', label: 'Performance' },
  { id: 'form',        label: 'Form'        },
  { id: 'benchmark',   label: 'Benchmark'   },
];

const YOUTH_DISCIPLINES = [
  { code: 'MS', label: 'Boys Singles',  table: 'singles' },
  { code: 'WS', label: 'Girls Singles', table: 'singles' },
  { code: 'MD', label: 'Boys Doubles',  table: 'doubles' },
  { code: 'WD', label: 'Girls Doubles', table: 'doubles' },
  { code: 'XD', label: 'Mixed Doubles', table: 'doubles' },
];

const BM_METRICS = [
  // ── Win Rates ──────────────────────────────────────────────────────────────
  { group: 'Win Rates' },
  {
    key: 'win_rate', label: 'Overall', fmt: v => `${Math.round(v * 100)}%`,
    domain: [0.2, 1.0], higher_better: true,
    tooltip: 'Win % across all matches in the window — every event type included (Grand Smash, Champions, Contender, ITTF Opens, Continental, etc.)',
  },
  {
    key: 'win_rate_top50', label: 'vs Top 50', fmt: v => `${Math.round(v * 100)}%`,
    domain: [0, 0.65], higher_better: true,
    tooltip: 'Win % only against opponents ranked ≤50 at the time of the match (using historical ranking, not current rank).',
  },
  {
    key: 'win_rate_top100', label: 'vs Top 100', fmt: v => `${Math.round(v * 100)}%`,
    domain: [0, 0.9], higher_better: true,
    tooltip: 'Win % only against opponents ranked ≤100 at the time of the match. Includes all Top-50 matches.',
  },

  // ── Activity ───────────────────────────────────────────────────────────────
  { group: 'Activity (All Events)' },
  {
    key: 'matches_played', label: 'Matches', fmt: v => `${Math.round(v)}`,
    domain: [0, 70], higher_better: true,
    tooltip: 'Total international matches played in the window across all event tiers.',
  },
  {
    key: 'total_competitions', label: 'Competitions', fmt: v => `${Math.round(v)}`,
    domain: [0, 30], higher_better: true,
    tooltip: 'Total distinct tournaments entered in the window across all event tiers.',
  },

  // ── Opponent Quality ───────────────────────────────────────────────────────
  { group: 'Opponent Quality' },
  {
    key: 'avg_opp_rank', label: 'Avg Opp Rank (Schedule)', fmt: v => `#${Math.round(v)}`,
    domain: [20, 250], higher_better: false,
    tooltip: 'Average rank of all opponents faced (win or loss). Lower = tougher schedule.',
  },
  {
    key: 'avg_opp_rank_beaten', label: 'Avg Opp Rank Beaten', fmt: v => `#${Math.round(v)}`,
    domain: [20, 250], higher_better: false,
    tooltip: 'Average rank of opponents the player actually beat. Lower = beating higher-ranked players.',
  },

  // ── Elite Events ───────────────────────────────────────────────────────────
  { group: 'Elite Events (Grand Smash / WTTC / Olympics / Champions / Continental)' },
  {
    key: 'elite_event_pct', label: 'Share of matches', fmt: v => `${Math.round(v * 100)}%`,
    domain: [0, 0.9], higher_better: true,
    tooltip: 'Fraction of all matches played that were in elite-tier events.',
  },
  {
    key: 'elite_matches', label: 'Matches', fmt: v => `${Math.round(v)}`,
    domain: [0, 50], higher_better: true,
    tooltip: 'Number of individual matches played in elite-tier events.',
  },
  {
    key: 'elite_competitions', label: 'Competitions', fmt: v => `${Math.round(v)}`,
    domain: [0, 15], higher_better: true,
    tooltip: 'Number of distinct elite-tier tournaments entered.',
  },

  // ── WTT Star Contender ────────────────────────────────────────────────────
  { group: 'WTT Star Contender' },
  {
    key: 'star_contender_pct', label: 'Share of matches', fmt: v => `${Math.round(v * 100)}%`,
    domain: [0, 0.6], higher_better: false,
    tooltip: 'Fraction of matches in WTT Star Contender events.',
  },
  {
    key: 'star_contender_matches', label: 'Matches', fmt: v => `${Math.round(v)}`,
    domain: [0, 30], higher_better: false,
    tooltip: 'Number of individual matches played in WTT Star Contender events.',
  },
  {
    key: 'star_contender_competitions', label: 'Competitions', fmt: v => `${Math.round(v)}`,
    domain: [0, 10], higher_better: false,
    tooltip: 'Number of distinct WTT Star Contender tournaments entered.',
  },

  // ── WTT Contender ─────────────────────────────────────────────────────────
  { group: 'WTT Contender' },
  {
    key: 'contender_pct', label: 'Share of matches', fmt: v => `${Math.round(v * 100)}%`,
    domain: [0, 0.5], higher_better: false,
    tooltip: 'Fraction of matches in WTT Contender events. High % = player is not regularly competing at top-level events.',
  },
  {
    key: 'contender_matches', label: 'Matches', fmt: v => `${Math.round(v)}`,
    domain: [0, 20], higher_better: false,
    tooltip: 'Number of individual matches played in WTT Contender events.',
  },
  {
    key: 'contender_competitions', label: 'Competitions', fmt: v => `${Math.round(v)}`,
    domain: [0, 8], higher_better: false,
    tooltip: 'Number of distinct WTT Contender tournaments entered.',
  },

  // ── Rankings ──────────────────────────────────────────────────────────────
  { group: 'Rankings' },
  {
    key: 'avg_rank_in_window', label: 'Avg Rank', fmt: v => `#${Math.round(v)}`,
    domain: [1, 200], higher_better: false,
    tooltip: 'Average world ranking across all ranking weeks in the window. Captures consistency over the period.',
  },
  {
    key: 'rank_best', label: 'Peak Rank', fmt: v => `#${Math.round(v)}`,
    domain: [1, 150], higher_better: false,
    tooltip: 'Best (lowest) ranking number achieved at any point in the window.',
  },
  {
    key: 'rank_change', label: 'Rank Improvement', fmt: v => v >= 0 ? `+${Math.round(v)}` : `${Math.round(v)}`,
    domain: [-30, 80], higher_better: true,
    tooltip: 'Rank at start of window minus current rank. Positive = moved up. Negative = dropped.',
  },
];

export default function DynamicOKRDashboard() {
  const { allowedIttfIds } = useAuth();
  const [allPlayersMerged, setAllPlayersMerged] = useState([]);
  const [players, setPlayers]               = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerMetrics, setPlayerMetrics]   = useState(null);
  const [playerName, setPlayerName]         = useState('');
  const [playerProfile, setPlayerProfile]   = useState(null);
  const [loading, setLoading]               = useState(true);
  const [fetching, setFetching]             = useState(false);
  const [error, setError]                   = useState(null);
  const [searchTerm, setSearchTerm]         = useState('');
  const [searchOpen, setSearchOpen]         = useState(false);
  const [filterGender, setFilterGender]     = useState('');
  const [filterRank, setFilterRank]         = useState('');
  const [filterCountry, setFilterCountry]   = useState('');
  const [filterAge, setFilterAge]           = useState('');
  const [filterStyle, setFilterStyle]       = useState('');
  const [filterGrip, setFilterGrip]         = useState('');
  const searchRef                           = useRef(null);
  const [activeTab, setActiveTab]           = useState('rank');
  const [dataSource, setDataSource]         = useState('wtt');
  const [rankWindow, setRankWindow]         = useState('6M');
  const [winWindow, setWinWindow]           = useState('6M');
  const [dnaWindow, setDnaWindow]           = useState('6M');
  const [wlFilter, setWlFilter]             = useState('rank');
  const [openRankBar, setOpenRankBar]       = useState(null);
  const [openTierBar, setOpenTierBar]       = useState(null);
  const [openCompBar, setOpenCompBar]       = useState(null);
  const [openNationBar, setOpenNationBar]   = useState(null);
  const [openDna, setOpenDna]               = useState(null);
  const [openRankCtx, setOpenRankCtx]       = useState(null);
  const [openPerfSections, setOpenPerfSections] = useState(new Set());
  const [formShowAll, setFormShowAll]       = useState(false);
  const [bmWindow, setBmWindow]             = useState(12);
  const [bmProfile, setBmProfile]           = useState(null);
  const [bmMyStats, setBmMyStats]           = useState(null);
  const [bmElitePlayers, setBmElitePlayers] = useState([]);
  const [bmLoading, setBmLoading]           = useState(false);
  const [youthAgeGroup, setYouthAgeGroup]   = useState('U17');
  const [youthDiscipline, setYouthDiscipline] = useState('MS');
  const [youthRows, setYouthRows]           = useState([]);
  const [youthLoading, setYouthLoading]     = useState(false);
  const tabContentRef = useRef(null);

  const switchTab = (id) => {
    setActiveTab(id);
  };

  const changeDataSource = (ds) => {
    setDataSource(ds);
    setOpenRankBar(null); setOpenTierBar(null);
    setOpenCompBar(null); setOpenNationBar(null);
    setOpenDna(null);
  };

  useEffect(() => {
    (async () => {
      try {
        // Get latest ranking date
        const { data: latestRow } = await supabase
          .from('rankings_singles_normalized')
          .select('ranking_date').order('ranking_date', { ascending: false }).limit(1);
        const latestDate = latestRow?.[0]?.ranking_date;
        if (!latestDate) throw new Error('No ranking data found');

        // Fetch top 500 ranked players (men + women combined, both use rank 1-500 in their own series)
        const { data: rankRows, error: re } = await supabase
          .from('rankings_singles_normalized')
          .select('player_id,rank')
          .eq('ranking_date', latestDate)
          .lte('rank', 500)
          .order('rank', { ascending: true })
          .limit(1100); // up to 500 men + 500 women
        if (re) throw re;

        const ids = (rankRows || []).map(r => r.player_id);
        const rankMap = {};
        for (const r of (rankRows || [])) rankMap[r.player_id] = r.rank;

        // Fetch player profiles for those IDs (fetch in two batches if needed to avoid URL limits)
        const batchSize = 500;
        let profileRows = [];
        for (let i = 0; i < ids.length; i += batchSize) {
          const batch = ids.slice(i, i + batchSize);
          const { data: batchData, error: pe } = await supabase
            .from('wtt_players')
            .select('ittf_id,player_name,country_code,dob,handedness,grip,gender')
            .in('ittf_id', batch)
            .limit(batchSize + 10);
          if (pe) throw pe;
          profileRows = profileRows.concat(batchData || []);
        }

        const normGender = g => {
          if (!g) return '';
          const l = g.toLowerCase();
          if (l === 'm' || l === 'male' || l === 'men') return 'M';
          if (l === 'w' || l === 'f' || l === 'female' || l === 'women') return 'W';
          return g;
        };

        const merged = profileRows
          .filter(p => rankMap[p.ittf_id])
          .map(p => {
            const g = normGender(p.gender);
            return {
              player_id:    p.ittf_id,
              player_name:  p.player_name,
              rank:         Number(rankMap[p.ittf_id]),
              gender:       g,
              gender_label: g === 'M' ? 'Men' : g === 'W' ? 'Women' : (p.gender || ''),
              country_code: p.country_code || '',
              dob:          p.dob || null,
              handedness:   p.handedness || '',
              grip:         p.grip || '',
            };
          })
          .sort((a, b) => a.rank - b.rank);

        setAllPlayersMerged(merged);
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    })();
  }, []);

  // Filter players reactively whenever the full list or allowedIttfIds changes
  useEffect(() => {
    if (allPlayersMerged.length === 0) return;
    const visible = allowedIttfIds
      ? allPlayersMerged.filter(p => allowedIttfIds.includes(String(p.player_id)))
      : allPlayersMerged;
    setPlayers(visible);
    setSelectedPlayer(p => {
      if (!p) {
        const first = visible.find(pl => pl.gender === 'M') || visible[0];
        return first?.player_id ?? null;
      }
      if (allowedIttfIds && !allowedIttfIds.includes(String(p))) {
        const first = visible.find(pl => pl.gender === 'M') || visible[0];
        return first?.player_id ?? null;
      }
      return p;
    });
  }, [allPlayersMerged, allowedIttfIds]);

  useEffect(() => {
    const handleClickOutside = e => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!selectedPlayer) return;
    (async () => {
      setFetching(true); setError(null);
      setOpenRankBar(null); setOpenTierBar(null);
      setOpenCompBar(null); setOpenNationBar(null);
      setOpenDna(null); setFormShowAll(false);
      setPlayerProfile(null);
      try {
        const [
          { data: matches,  error: e1 },
          { data: rankings, error: e2 },
          { data: events,   error: e3 },
        ] = await Promise.all([
          supabase.from('wtt_matches_singles')
            .select('match_id,comp1_id,comp2_id,result,event_date,event_id,round_phase,game_scores')
            .or(`comp1_id.eq.${selectedPlayer},comp2_id.eq.${selectedPlayer}`)
            .order('event_date', { ascending: false }).limit(500),
          supabase.from('rankings_singles_normalized')
            .select('rank,ranking_date,points').eq('player_id', selectedPlayer)
            .order('ranking_date', { ascending: false }).limit(200),
          supabase.from('wtt_events_graded').select('event_id,event_name,event_tier,tops_grade'),
        ]);
        if (e1) throw e1; if (e2) throw e2; if (e3) throw e3;

        const pid    = parseInt(selectedPlayer);
        const pidStr = String(selectedPlayer);

        const oppIds = [...new Set((matches || []).map(m =>
          parseInt(m.comp1_id) === pid ? parseInt(m.comp2_id) : parseInt(m.comp1_id)
        ))];

        const { data: allPlayers, error: e4 } = await supabase
          .from('wtt_players').select('ittf_id,player_name,country_code,dob,handedness,grip')
          .in('ittf_id', oppIds);
        if (e4) throw e4;

        const { data: profileData } = await supabase
          .from('wtt_players').select('dob,handedness,grip')
          .eq('ittf_id', selectedPlayer).single();
        setPlayerProfile(profileData || null);

        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - 18);
        const { data: oppRanks, error: e5 } = await supabase
          .from('rankings_singles_normalized').select('player_id,rank,ranking_date')
          .in('player_id', oppIds)
          .gte('ranking_date', cutoffDate.toISOString().split('T')[0])
          .order('ranking_date', { ascending: false }).limit(50000);
        if (e5) throw e5;

        const oppRankMap = {};
        for (const r of (oppRanks || [])) {
          const key = parseInt(r.player_id);
          if (!oppRankMap[key]) oppRankMap[key] = [];
          oppRankMap[key].push(r);
        }

        const { data: domMatches } = await supabase
          .from('ttfi_domestic_matches')
          .select('season,slug,event_name,round,player1_name,player2_name,winner_name,score_raw,p1_sets,p2_sets,game_scores,match_datetime,wtt_player1_id,wtt_player2_id')
          .or(`wtt_player1_id.eq.${selectedPlayer},wtt_player2_id.eq.${selectedPlayer}`)
          .neq('round', 'R/256')
          .ilike('event_name', '%Singles%')
          .order('season', { ascending: false });

        const domOppIds = [...new Set((domMatches || [])
          .map(m => m.wtt_player1_id === pidStr ? m.wtt_player2_id : m.wtt_player1_id)
          .filter(id => id && id !== pidStr)
          .map(id => parseInt(id))
        )];

        let domOppProfiles = {};
        if (domOppIds.length > 0) {
          const { data: domOpps } = await supabase
            .from('wtt_players').select('ittf_id,player_name,country_code,dob,handedness,grip')
            .in('ittf_id', domOppIds);
          for (const p of (domOpps || [])) domOppProfiles[String(p.ittf_id)] = p;
        }

        let domOppRankMap = {};
        if (domOppIds.length > 0) {
          const { data: domOppRanks } = await supabase
            .from('rankings_singles_normalized').select('player_id,rank,ranking_date')
            .in('player_id', domOppIds)
            .gte('ranking_date', cutoffDate.toISOString().split('T')[0])
            .order('ranking_date', { ascending: false }).limit(20000);
          for (const r of (domOppRanks || [])) {
            const key = String(r.player_id);
            if (!domOppRankMap[key]) domOppRankMap[key] = [];
            domOppRankMap[key].push(r);
          }
        }

        setPlayerMetrics(buildMetrics(
          matches, rankings, events, allPlayers, oppRankMap,
          selectedPlayer, domMatches || [], domOppProfiles, domOppRankMap
        ));
      } catch (err) { setError(err.message); }
      finally { setFetching(false); }
    })();
  }, [selectedPlayer]);

  useEffect(() => {
    if (activeTab !== 'benchmark' || !selectedPlayer) return;
    const playerGender = players.find(p => p.player_id === selectedPlayer)?.gender;
    if (!playerGender) return;
    let cancelled = false;
    setBmLoading(true);
    (async () => {
      try {
        const [profileRes, eliteRes] = await Promise.all([
          supabase.from('elite_benchmark_profile')
            .select('*').eq('gender', playerGender).eq('window_months', bmWindow),
          supabase.from('player_benchmark_stats')
            .select('*').eq('gender', playerGender).eq('window_months', bmWindow)
            .eq('is_elite', true).order('current_rank', { ascending: true }).limit(200),
        ]);
        if (cancelled) return;
        const profileMap = {};
        for (const row of (profileRes.data || [])) profileMap[row.metric] = row;
        setBmProfile(Object.keys(profileMap).length > 0 ? profileMap : null);
        setBmElitePlayers(eliteRes.data || []);
        // Compute player's own stats live from already-loaded match data
        if (playerMetrics) {
          setBmMyStats(computeLiveBenchmarkStats(
            playerMetrics.wttLedger,
            playerMetrics.rankingHistory,
            bmWindow,
            playerMetrics.ranking,
          ));
        }
      } finally {
        if (!cancelled) setBmLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, selectedPlayer, bmWindow, players, playerMetrics]);

  useEffect(() => {
    let cancelled = false;
    setYouthLoading(true);
    setYouthRows([]);
    const disc = YOUTH_DISCIPLINES.find(d => d.code === youthDiscipline);
    const isDoubles = disc?.table === 'doubles';
    (async () => {
      try {
        const table = isDoubles ? 'youth_rankings_doubles' : 'youth_rankings_singles';
        // Fetch latest week first, then query only that week
        const { data: latestRow } = await supabase.from(table)
          .select('ranking_year, ranking_week')
          .eq('age_category', youthAgeGroup)
          .eq('sub_event', youthDiscipline)
          .order('ranking_year', { ascending: false })
          .order('ranking_week', { ascending: false })
          .limit(1);
        const latest = latestRow?.[0];
        if (!latest) { if (!cancelled) { setYouthRows([]); setYouthLoading(false); } return; }
        const { data } = await supabase.from(table)
          .select('*')
          .eq('age_category', youthAgeGroup)
          .eq('sub_event', youthDiscipline)
          .eq('ranking_year', latest.ranking_year)
          .eq('ranking_week', latest.ranking_week)
          .order('age_cat_rank', { ascending: true })
          .limit(100);
        if (!cancelled) setYouthRows(data || []);
      } finally {
        if (!cancelled) setYouthLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [youthAgeGroup, youthDiscipline]);

  function computeLiveBenchmarkStats(wttLedger, rankingHistory, windowMonths, currentRank) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - windowMonths);
    cutoff.setHours(0, 0, 0, 0);
    const filtered = wttLedger.filter(m => m.rawDate >= cutoff);

    const ELITE_TIERS = new Set(['1', '2', '3', '5']);
    const STAR_TIERS  = new Set(['4']);
    const CONT_TIERS  = new Set(['6']);

    const played = filtered.length;
    if (played === 0) return null;

    const wins = filtered.filter(m => m.result === 'W');

    // Win rates
    const win_rate = wins.length / played;
    const vsTop50  = filtered.filter(m => m.opponentRank <= 50);
    const vsTop100 = filtered.filter(m => m.opponentRank <= 100);
    const win_rate_top50  = vsTop50.length  > 0 ? vsTop50.filter(m => m.result === 'W').length  / vsTop50.length  : null;
    const win_rate_top100 = vsTop100.length > 0 ? vsTop100.filter(m => m.result === 'W').length / vsTop100.length : null;

    // Opponent quality
    const oppRanks       = filtered.filter(m => m.opponentRank < 999).map(m => m.opponentRank);
    const oppRanksBeat   = wins.filter(m => m.opponentRank < 999).map(m => m.opponentRank);
    const avg_opp_rank        = oppRanks.length   > 0 ? oppRanks.reduce((s, v) => s + v, 0)     / oppRanks.length   : null;
    const avg_opp_rank_beaten = oppRanksBeat.length > 0 ? oppRanksBeat.reduce((s, v) => s + v, 0) / oppRanksBeat.length : null;

    // Event tier breakdown
    const eliteM  = filtered.filter(m => ELITE_TIERS.has(m.eventTierStr));
    const starM   = filtered.filter(m => STAR_TIERS.has(m.eventTierStr));
    const contM   = filtered.filter(m => CONT_TIERS.has(m.eventTierStr));
    const elite_matches              = eliteM.length;
    const star_contender_matches     = starM.length;
    const contender_matches          = contM.length;
    const elite_event_pct            = played > 0 ? elite_matches / played : null;
    const star_contender_pct         = played > 0 ? star_contender_matches / played : null;
    const contender_pct              = played > 0 ? contender_matches / played : null;

    // Competitions (distinct tournament keys)
    const allEvents   = new Set(filtered.map(m => m.tournamentKey));
    const eliteEvents = new Set(eliteM.map(m => m.tournamentKey));
    const starEvents  = new Set(starM.map(m => m.tournamentKey));
    const contEvents  = new Set(contM.map(m => m.tournamentKey));
    const total_competitions              = allEvents.size;
    const elite_competitions             = eliteEvents.size;
    const star_contender_competitions    = starEvents.size;
    const contender_competitions         = contEvents.size;

    // Rankings in window
    const ranksInWindow = (rankingHistory || [])
      .filter(r => new Date(r.ranking_date) >= cutoff)
      .map(r => r.rank);
    const avg_rank_in_window = ranksInWindow.length > 0
      ? ranksInWindow.reduce((s, v) => s + v, 0) / ranksInWindow.length : null;
    const rank_best = ranksInWindow.length > 0 ? Math.min(...ranksInWindow) : null;
    const rankAtStart = (rankingHistory || []).find(r => new Date(r.ranking_date) <= cutoff)?.rank;
    const rank_change = rankAtStart != null ? rankAtStart - currentRank : null;

    return {
      matches_played:            played,
      total_competitions,
      win_rate,
      win_rate_top50,
      win_rate_top100,
      matches_top50:             vsTop50.length,
      matches_top100:            vsTop100.length,
      avg_opp_rank,
      avg_opp_rank_beaten,
      elite_event_pct,
      elite_matches,
      elite_competitions,
      star_contender_pct,
      star_contender_matches,
      star_contender_competitions,
      contender_pct,
      contender_matches,
      contender_competitions,
      avg_rank_in_window,
      rank_best,
      rank_change,
    };
  }

  function buildMetrics(matches, rankings, events, allPlayers, oppRankMap,
                        playerId, domMatches, domOppProfiles, domOppRankMap) {
    const pid    = parseInt(playerId);
    const pidStr = String(playerId);
    const playerCurrentRank = rankings?.[0]?.rank || 999;

    const wttLedger = (matches || []).map(m => {
      const isComp1 = parseInt(m.comp1_id) === pid;
      const won     = isComp1 ? m.result === 'W' : m.result === 'L';
      const oppId   = parseInt(isComp1 ? m.comp2_id : m.comp1_id);
      const oppP    = allPlayers?.find(p => parseInt(p.ittf_id) === oppId);
      const oppH    = oppRankMap[oppId] || [];
      const matchDate = new Date(m.event_date);
      const opponentRank        = oppH.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? 999;
      const opponentCurrentRank = oppH[0]?.rank ?? 999;
      const playerRankAtMatch   = rankings?.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? playerCurrentRank;
      const { gamesWon, gamesLost, pointsWon, pointsLost, totalGames } =
        parseScoresForPlayer(m.game_scores, isComp1);
      const pointDiff = totalGames > 0 ? (pointsWon - pointsLost) / totalGames : null;
      const eventInfo = events?.find(e => e.event_id === m.event_id);
      return {
        rawDate: matchDate,
        opponent: oppP?.player_name || 'Unknown',
        opponentCountry: oppP?.country_code || null,
        opponentDob: oppP?.dob || null,
        opponentHandedness: oppP?.handedness || null,
        opponentGrip: oppP?.grip || null,
        opponentRank, opponentCurrentRank, playerRankAtMatch,
        tournament: eventInfo?.event_name || 'Unknown',
        tournamentKey: String(m.event_id),
        eventTier: eventInfo?.tops_grade ?? null,
        eventTierStr: eventInfo?.event_tier ?? null,
        round: m.round_phase || 'N/A',
        score: m.game_scores || 'N/A',
        result: won ? 'W' : 'L',
        isComp1,
        isUpset:       won && opponentRank < playerRankAtMatch,
        isClutch:      won && gamesLost === gamesWon - 1,
        isStraightWin: won && gamesLost === 0 && totalGames >= 3,
        isStraightLoss:!won && gamesWon === 0 && totalGames >= 3,
        isComeback:    checkComeback(m.game_scores, isComp1, won),
        gamesWon, gamesLost, totalGames, pointsWon, pointDiff,
        wonGame1:   parseGame1Won(m.game_scores, isComp1),
        deuceGames: countDeuceGames(m.game_scores, isComp1),
        isDomestic: false,
      };
    });

    const analyticsRounds = new Set(['FINAL','SF','QF','R/16','R/32','R/64']);
    const domLedger = (domMatches || [])
      .filter(m => analyticsRounds.has(m.round))
      .map(m => {
        const isP1     = m.wtt_player1_id === pidStr;
        const me       = isP1 ? m.player1_name : m.player2_name;
        const opp      = isP1 ? m.player2_name : m.player1_name;
        const won      = m.winner_name === me;
        const oppWttId = isP1 ? m.wtt_player2_id : m.wtt_player1_id;
        const oppP     = oppWttId ? domOppProfiles[oppWttId] : null;
        const oppH     = oppWttId ? (domOppRankMap[oppWttId] || []) : [];
        const rawDate  = parseDomesticDate(m.match_datetime, m.season);
        const opponentRank        = oppH[0]?.rank ?? 999;
        const opponentCurrentRank = oppH[0]?.rank ?? 999;
        const playerRankAtMatch   = rankings?.find(r => new Date(r.ranking_date) <= rawDate)?.rank ?? playerCurrentRank;

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
        const pointDiff  = totalGames > 0 ? (pW - pL) / totalGames : null;

        return {
          rawDate,
          opponent: oppP?.player_name || opp,
          opponentCountry: oppP?.country_code || 'IND',
          opponentDob: oppP?.dob || null,
          opponentHandedness: oppP?.handedness || null,
          opponentGrip: oppP?.grip || null,
          opponentRank, opponentCurrentRank, playerRankAtMatch,
          tournament: slugToName(m.slug),
          tournamentKey: `${m.season}__${m.slug}`,
          eventTier: 6,
          round: DOM_ROUND_MAP[m.round] || m.round,
          score: scoreStr,
          result: won ? 'W' : 'L',
          isComp1: true,
          isUpset:       won && opponentRank < playerRankAtMatch,
          isClutch:      won && gL === gW - 1,
          isStraightWin: won && gL === 0 && totalGames >= 3,
          isStraightLoss:!won && gW === 0 && totalGames >= 3,
          isComeback:    false,
          gamesWon: gW, gamesLost: gL, totalGames, pointsWon: pW, pointDiff,
          wonGame1:   scoreStr ? parseGame1Won(scoreStr, true) : null,
          deuceGames: scoreStr ? countDeuceGames(scoreStr, true) : { won: 0, lost: 0 },
          isDomestic: true,
        };
      });

    const allMatchesSorted = [...wttLedger, ...domLedger].sort((a, b) => b.rawDate - a.rawDate);
    const makeWindows = (ledger) => ({
      '6M':  computeWindowData(ledger, rankings || [], 6,  playerCurrentRank),
      '12M': computeWindowData(ledger, rankings || [], 12, playerCurrentRank),
      '18M': computeWindowData(ledger, rankings || [], 18, playerCurrentRank),
    });

    return {
      ranking: playerCurrentRank,
      rankingHistory: rankings || [],
      wttLedger:   wttLedger.sort((a, b) => b.rawDate - a.rawDate),
      domLedger:   domLedger.sort((a, b) => b.rawDate - a.rawDate),
      bothLedger:  allMatchesSorted,
      wttWindows:  makeWindows(wttLedger),
      domWindows:  makeWindows(domLedger),
      bothWindows: makeWindows(allMatchesSorted),
    };
  }

  const activeLedger = useMemo(() => {
    if (!playerMetrics) return [];
    if (dataSource === 'domestic') return playerMetrics.domLedger;
    if (dataSource === 'both')     return playerMetrics.bothLedger;
    return playerMetrics.wttLedger;
  }, [playerMetrics, dataSource]);

  const activeWindows = useMemo(() => {
    if (!playerMetrics) return null;
    if (dataSource === 'domestic') return playerMetrics.domWindows;
    if (dataSource === 'both')     return playerMetrics.bothWindows;
    return playerMetrics.wttWindows;
  }, [playerMetrics, dataSource]);

  const w6           = activeWindows?.['6M'];
  const win          = activeWindows?.[winWindow];
  const dna          = activeWindows?.[dnaWindow];
  const rankWindowData = activeWindows?.[rankWindow];

  const verdict = useMemo(() => {
    if (!playerMetrics) return null;
    return computeVerdict(playerMetrics.wttWindows['6M']);
  }, [playerMetrics]);

  const rankChartData = useMemo(() => {
    if (!playerMetrics?.rankingHistory) return { data: [], ticks: [] };
    return buildRankChartData(playerMetrics.rankingHistory, parseInt(rankWindow));
  }, [playerMetrics, rankWindow]);

  const chartRanks = rankChartData.data.map(d => d.rank).filter(Boolean);
  const peakRank   = chartRanks.length ? Math.min(...chartRanks) : null;
  const startRank  = rankWindowData && playerMetrics
    ? playerMetrics.ranking + rankWindowData.rankChange : null;

  const RANK_RANGES = { '1-50': [1,50], '51-100': [51,100], '101-200': [101,200], '201-500': [201,500] };

  const countries = useMemo(() => {
    const seen = new Set();
    return players
      .filter(p => p.country_code && !seen.has(p.country_code) && seen.add(p.country_code))
      .map(p => p.country_code)
      .sort();
  }, [players]);

  const filteredPlayers = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return players.filter(p => {
      if (term && !p.player_name.toLowerCase().includes(term)) return false;
      if (filterGender  && p.gender !== filterGender) return false;
      if (filterRank)   { const [mn, mx] = RANK_RANGES[filterRank]; if (p.rank < mn || p.rank > mx) return false; }
      if (filterCountry && p.country_code !== filterCountry) return false;
      if (filterAge) {
        const age = calcAge(p.dob);
        if (filterAge === 'u21' && (!age || age >= 21)) return false;
        if (filterAge === 'u25' && (!age || age >= 25)) return false;
      }
      if (filterStyle && p.handedness !== filterStyle) return false;
      if (filterGrip  && p.grip       !== filterGrip)  return false;
      return true;
    });
  }, [players, searchTerm, filterGender, filterRank, filterCountry, filterAge, filterStyle, filterGrip]);

  const activePlayerObj = players.find(p => p.player_id === selectedPlayer);
  const isIndian = activePlayerObj?.country_code === 'IND';
  const clearFilters = () => {
    setFilterGender(''); setFilterRank(''); setFilterCountry('');
    setFilterAge(''); setFilterStyle(''); setFilterGrip('');
    setSearchTerm('');
  };

  const WL_FILTERS = [
    { id: 'rank',       label: 'By opponent rank' },
    { id: 'tier',       label: 'By event tier'    },
    { id: 'competitor', label: 'Top opponents'    },
    { id: 'nation',     label: 'By nation'        },
    { id: 'style',      label: 'By style'         },
    { id: 'grip',       label: 'By grip'          },
  ];

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex items-center gap-2 text-slate-400">
        <Activity size={16} className="animate-pulse" />
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap');
        .okr * { font-family: 'Sora', sans-serif; }
        .slide { animation: sl 0.15s ease-out; }
        @keyframes sl { from { opacity:0; transform:translateY(-3px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      <AuthBar />
      <div className="okr min-h-screen" style={{ position: 'relative', zIndex: 4 }}>
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">TOPS · Table Tennis</p>
            <div className="flex items-center gap-3">
              {selectedPlayer && playerMetrics && (
                <DataSourceToggle value={dataSource} onChange={changeDataSource} showDomestic={isIndian} />
              )}
              <a href="/h2h" className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1">
                Compare players <ArrowRight size={11} />
              </a>
            </div>
          </div>

          {/* ── Player Search + Filters ── */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Search bar */}
            <div className="relative" ref={searchRef}>
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
              <input
                type="text"
                placeholder="Search player by name…"
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                className="w-full pl-9 pr-4 py-3 text-sm focus:outline-none bg-transparent border-b border-slate-100"
              />
              {/* Autocomplete dropdown */}
              {searchOpen && (
                <div className="absolute left-0 right-0 top-full bg-white border border-slate-200 rounded-b-xl shadow-lg z-50 max-h-56 overflow-y-auto">
                  {!searchTerm && <p className="px-4 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-50">Top ranked players</p>}
                  {filteredPlayers.slice(0, 15).map(p => (
                    <button key={p.player_id}
                      onMouseDown={() => {
                        setSelectedPlayer(p.player_id); setPlayerName(p.player_name);
                        setSearchTerm(p.player_name); setSearchOpen(false);
                        setActiveTab('rank'); setDataSource('wtt');
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left">
                      <span className="text-[10px] font-bold text-slate-400 w-8 shrink-0">#{p.rank}</span>
                      <span className="text-sm text-slate-800 flex-1">{p.player_name}</span>
                      <span className="text-[10px] text-slate-400">{p.country_code} · {p.gender_label}</span>
                    </button>
                  ))}
                  {filteredPlayers.length === 0 && (
                    <p className="px-4 py-3 text-sm text-slate-400">No players found</p>
                  )}
                  {filteredPlayers.length > 15 && (
                    <p className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">{filteredPlayers.length - 15} more — refine filters</p>
                  )}
                </div>
              )}
            </div>

            {/* Filter chips */}
            <div className="px-3 py-2.5 flex gap-1.5 flex-wrap items-center border-b border-slate-100">
              {/* Gender */}
              {['M','W'].map(g => (
                <button key={g} onClick={() => setFilterGender(filterGender === g ? '' : g)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${filterGender === g ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                  {g === 'M' ? 'Men' : 'Women'}
                </button>
              ))}
              <span className="w-px h-4 bg-slate-200 mx-0.5" />
              {/* Rank range */}
              {Object.keys(RANK_RANGES).map(r => (
                <button key={r} onClick={() => setFilterRank(filterRank === r ? '' : r)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${filterRank === r ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                  #{r}
                </button>
              ))}
              <span className="w-px h-4 bg-slate-200 mx-0.5" />
              {/* Country */}
              <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)}
                className={`text-xs px-2 py-1 rounded-full border transition-all focus:outline-none ${filterCountry ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>
                <option value="">Country</option>
                {countries.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {/* Age */}
              <select value={filterAge} onChange={e => setFilterAge(e.target.value)}
                className={`text-xs px-2 py-1 rounded-full border transition-all focus:outline-none ${filterAge ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>
                <option value="">Age</option>
                <option value="u21">Under 21</option>
                <option value="u25">Under 25</option>
              </select>
              {/* Style */}
              <select value={filterStyle} onChange={e => setFilterStyle(e.target.value)}
                className={`text-xs px-2 py-1 rounded-full border transition-all focus:outline-none ${filterStyle ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>
                <option value="">Style</option>
                <option value="Right Hand">Right Hand</option>
                <option value="Left Hand">Left Hand</option>
              </select>
              {/* Grip */}
              <select value={filterGrip} onChange={e => setFilterGrip(e.target.value)}
                className={`text-xs px-2 py-1 rounded-full border transition-all focus:outline-none ${filterGrip ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>
                <option value="">Grip</option>
                <option value="Shakehand">Shakehand</option>
                <option value="Penhold">Penhold</option>
              </select>
              {/* Clear */}
              {(filterGender || filterRank || filterCountry || filterAge || filterStyle || filterGrip || searchTerm) && (
                <button onClick={clearFilters} className="text-xs px-2.5 py-1 rounded-full border border-red-200 text-red-400 hover:bg-red-50 ml-auto">
                  Clear
                </button>
              )}
            </div>

            {/* Result count + current selection */}
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="text-xs text-slate-400">{filteredPlayers.length} player{filteredPlayers.length !== 1 ? 's' : ''}</span>
              {selectedPlayer && activePlayerObj && (
                <span className="text-xs text-slate-600 font-medium">
                  Selected: <span className="text-slate-800">#{activePlayerObj.rank} {activePlayerObj.player_name}</span>
                  <span className="text-slate-400"> · {activePlayerObj.country_code}</span>
                </span>
              )}
            </div>
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          {fetching && (
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-blue-500 text-sm flex items-center gap-2">
              <Activity size={13} className="animate-pulse" /> Computing metrics…
            </div>
          )}

          {selectedPlayer && playerMetrics && w6 && (
            <>
              {verdict && (() => {
                const t = TONE[verdict.tone];
                return (
                  <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl ${t.bg}`}>
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: t.dot }} />
                    <p className={`text-sm font-medium ${t.text}`}>
                      <span className="font-semibold">{playerName}</span>
                      <span className="font-normal"> · World </span>
                      <span className="font-semibold">#{playerMetrics.ranking}</span>
                      <span className="font-normal"> · {verdict.text}</span>
                    </p>
                  </div>
                );
              })()}

              <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-base font-semibold text-slate-800">{playerName}</p>
                    <p className="text-xs text-slate-400 mt-0.5 uppercase tracking-wide">
                      {players.find(p => p.player_id === selectedPlayer)?.gender_label}
                      {calcAge(playerProfile?.dob) && ` · Age ${calcAge(playerProfile?.dob)}`}
                      {fmtStyle(playerProfile?.handedness, playerProfile?.grip) && ` · ${fmtStyle(playerProfile?.handedness, playerProfile?.grip)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-6 flex-wrap">
                    {[
                      { label: 'World rank',    value: `#${playerMetrics.ranking}` },
                      { label: 'Win rate (6M)', value: `${w6.winRate.toFixed(1)}%` },
                      { label: 'Matches (6M)',  value: `${w6.matchCount}` },
                    ].map(s => (
                      <div key={s.label} className="text-center">
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">{s.label}</p>
                        <p className="text-xl font-bold text-slate-800">{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex border-b border-slate-100">
                  {TABS.map(tab => (
                    <button key={tab.id} onClick={() => switchTab(tab.id)}
                      className={`flex-1 py-3.5 text-sm font-medium transition-all relative ${
                        activeTab === tab.id ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
                      {tab.label}
                      {activeTab === tab.id && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-800 rounded-full" />
                      )}
                    </button>
                  ))}
                </div>

                <div ref={tabContentRef}>

                  {activeTab === 'rank' && (
                    <div className="p-5 space-y-4 slide">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-500 font-medium">Is this player improving?</p>
                        <WindowToggle value={rankWindow} onChange={setRankWindow} />
                      </div>
                      <div className="flex items-center gap-5 flex-wrap">
                        <div className="text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">{rankWindow} ago</p>
                          <p className="text-xl font-bold text-slate-700">
                            {startRank && startRank < 999 ? `#${startRank}` : '—'}
                          </p>
                        </div>
                        <ArrowRight size={14} className={
                          rankWindowData?.rankChange > 0 ? 'text-emerald-400'
                          : rankWindowData?.rankChange < 0 ? 'text-red-300' : 'text-slate-200'} />
                        <div className="text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">Today</p>
                          <p className="text-xl font-bold text-slate-800">#{playerMetrics.ranking}</p>
                        </div>
                        {peakRank && (
                          <div className="text-center ml-3">
                            <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">Period peak</p>
                            <p className="text-xl font-bold text-blue-500">#{peakRank}</p>
                          </div>
                        )}
                        <div className="ml-auto">
                          {(() => {
                            const rc = rankWindowData?.rankChange ?? 0;
                            if (rc > 0) return <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700">↑ Improving</span>;
                            if (rc < 0) return <span className="text-xs font-semibold px-3 py-1 rounded-full bg-red-50 text-red-500">↓ Declining</span>;
                            return <span className="text-xs font-semibold px-3 py-1 rounded-full bg-slate-100 text-slate-500">— Stable</span>;
                          })()}
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4">
                        {rankChartData.data.length > 1 ? (
                          <ResponsiveContainer width="100%" height={200}>
                            <AreaChart data={rankChartData.data} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
                              <defs>
                                <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.12} />
                                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                              <XAxis dataKey="x" type="number" scale="time"
                                domain={['dataMin', 'dataMax']} ticks={rankChartData.ticks}
                                tickFormatter={ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                                tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                              <YAxis reversed domain={['dataMin - 2', 'dataMax + 2']}
                                tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                                tickFormatter={v => `#${Math.round(v)}`} allowDecimals={false} />
                              <Tooltip
                                cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
                                contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: 12, padding: '6px 10px' }}
                                labelFormatter={(_l, p) => p?.[0]?.payload?.fullDate || ''}
                                formatter={(v) => [`#${v}`, 'Rank']} />
                              {peakRank && (
                                <ReferenceLine y={peakRank} stroke="#10b981" strokeDasharray="4 4" strokeWidth={1.5}
                                  label={{ value: `Peak #${peakRank}`, position: 'insideTopRight', fontSize: 9, fill: '#10b981' }} />
                              )}
                              <Area type="monotone" dataKey="rank" stroke="#3b82f6" strokeWidth={2}
                                fill="url(#rg)" dot={false}
                                activeDot={{ r: 4, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                                isAnimationActive={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
                            Not enough data for {rankWindow} window
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeTab === 'winloss' && win && (
                    <div className="p-5 space-y-4 slide">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-500 font-medium">Where are they winning and losing?</p>
                        <WindowToggle value={winWindow} onChange={v => {
                          setWinWindow(v);
                          setOpenRankBar(null); setOpenTierBar(null);
                          setOpenCompBar(null); setOpenNationBar(null);
                        }} />
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {WL_FILTERS.map(f => (
                          <button key={f.id} onClick={() => {
                            setWlFilter(f.id);
                            setOpenRankBar(null); setOpenTierBar(null);
                            setOpenCompBar(null); setOpenNationBar(null);
                          }}
                            className={`text-xs font-medium px-3 py-1 rounded-full border transition-all ${
                              wlFilter === f.id
                                ? 'border-slate-700 bg-slate-800 text-white'
                                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                            {f.label}
                          </button>
                        ))}
                      </div>
                      <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                          <colgroup>
                            <col style={{ width: '28%' }} /><col style={{ width: '40%' }} /><col style={{ width: '32%' }} />
                          </colgroup>
                          <tbody>
                            <tr style={{ borderBottom: '0.5px solid #e2e8f0', background: '#f8fafc' }}>
                              <td style={{ padding: '10px 14px', verticalAlign: 'top' }}>
                                <p style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Overall</p>
                                <p style={{ fontSize: 13, fontWeight: 600 }}>
                                  <span style={{ color: '#059669' }}>{win.wins}W</span>
                                  <span style={{ color: '#94a3b8' }}> / </span>
                                  <span style={{ color: '#f87171' }}>{win.losses}L</span>
                                  <span style={{ color: '#64748b', marginLeft: 4 }}>· {win.winRate.toFixed(1)}%</span>
                                </p>
                              </td>
                              <td style={{ padding: '10px 14px', verticalAlign: 'top', textAlign: 'center' }}>
                                <p style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Upset yield</p>
                                <p style={{ fontSize: 13, fontWeight: 600 }}>
                                  {win.upsetYield.toFixed(1)}%
                                  <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8', marginLeft: 4 }}>of wins vs higher-ranked</span>
                                </p>
                              </td>
                              <td style={{ padding: '10px 14px', verticalAlign: 'top', textAlign: 'right' }}>
                                <p style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Avg opp rank beaten</p>
                                <p style={{ fontSize: 13, fontWeight: 600 }}>{win.avgOppRankBeaten ? `#${win.avgOppRankBeaten}` : '—'}</p>
                              </td>
                            </tr>
                            {wlFilter === 'rank' && win.rankBuckets.map(b => (
                              <WLBarRows key={b.label} label={b.label} wins={b.wins} losses={b.losses} winPct={b.winPct}
                                isOpen={openRankBar === b.label}
                                onToggle={() => setOpenRankBar(openRankBar === b.label ? null : b.label)}>
                                {b.matches.map((m, i) => <MatchRow key={i} match={m} />)}
                              </WLBarRows>
                            ))}
                            {wlFilter === 'tier' && (
                              win.tierBuckets.length === 0
                                ? <tr><td colSpan={3} style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>No tier data.</td></tr>
                                : <>
                                  {win.tierBuckets.map(b => {
                                    const TIER_DESC = {
                                      '1': 'Olympics, Worlds, Grand Smash',
                                      '2': 'Asian Games, WTT Champions, World Cup',
                                      '3': 'WTT Star Contender, Commonwealth',
                                      '4': 'WTT Contender, South Asian',
                                      '5': 'WTT Feeder',
                                      '6': 'TTFI Nationals, Ranking, Khelo India',
                                    };
                                    return (
                                      <WLBarRows key={b.tier} label={b.label} sublabel={TIER_DESC[b.tier]}
                                        wins={b.wins} losses={b.losses} winPct={b.winPct}
                                        isOpen={openTierBar === b.tier}
                                        onToggle={() => setOpenTierBar(openTierBar === b.tier ? null : b.tier)}>
                                        {b.matches.map((m, i) => <MatchRow key={i} match={m} />)}
                                      </WLBarRows>
                                    );
                                  })}
                                </>
                            )}
                            {wlFilter === 'competitor' && (
                              win.topCompetitors.length === 0
                                ? <tr><td colSpan={3} style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>No data.</td></tr>
                                : win.topCompetitors.map(c => (
                                  <WLBarRows key={c.name}
                                    label={`${c.name}${c.currentRank < 999 ? ` · #${c.currentRank}` : ''}`}
                                    wins={c.wins} losses={c.losses} winPct={c.winPct}
                                    isOpen={openCompBar === c.name}
                                    onToggle={() => setOpenCompBar(openCompBar === c.name ? null : c.name)}>
                                    {c.matches.map((m, i) => <MatchRow key={i} match={m} />)}
                                  </WLBarRows>
                                ))
                            )}
                            {wlFilter === 'nation' && (
                              win.topNations.length === 0
                                ? <tr><td colSpan={3} style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>No nation data.</td></tr>
                                : win.topNations.map(n => (
                                  <WLBarRows key={n.country} label={n.country.toUpperCase()} wins={n.wins} losses={n.losses} winPct={n.winPct}
                                    isOpen={openNationBar === n.country}
                                    onToggle={() => setOpenNationBar(openNationBar === n.country ? null : n.country)}>
                                    {n.matches.map((m, i) => <MatchRow key={i} match={m} />)}
                                  </WLBarRows>
                                ))
                            )}
                            {wlFilter === 'style' && win.styleGroups.filter(s => s.style !== 'Unknown').map(s => (
                              <WLBarRows key={s.style} label={s.style} wins={s.wins} losses={s.losses} winPct={s.winPct}
                                isOpen={openNationBar === s.style}
                                onToggle={() => setOpenNationBar(openNationBar === s.style ? null : s.style)}>
                                {s.matches.map((m, i) => <MatchRow key={i} match={m} />)}
                              </WLBarRows>
                            ))}
                            {wlFilter === 'grip' && win.gripGroups.filter(g => g.grip !== 'Unknown').map(g => (
                              <WLBarRows key={g.grip} label={g.grip} wins={g.wins} losses={g.losses} winPct={g.winPct}
                                isOpen={openNationBar === g.grip}
                                onToggle={() => setOpenNationBar(openNationBar === g.grip ? null : g.grip)}>
                                {g.matches.map((m, i) => <MatchRow key={i} match={m} />)}
                              </WLBarRows>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {activeTab === 'performance' && dna && (
                    <div className="p-5 space-y-3 slide">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">Performance Insights</p>
                        <WindowToggle value={dnaWindow} onChange={v => { setDnaWindow(v); setOpenDna(null); setOpenRankCtx(null); setOpenPerfSections(new Set()); }} />
                      </div>

                      {(() => {
                        const rc = dna.rankContext;
                        const DNA_KEYS = new Set(['clutch','straightWins','straightLosses','comebacks','winrate','avgptdiff','ppg','form']);

                        const allSections = [
                          {
                            key: 'outcomes',
                            heading: 'Outcomes',
                            summary: `${dna.winRate.toFixed(1)}% win rate · ${dna.wins}W ${dna.losses}L · form: ${(dna.currentForm||[]).slice(0,5).join(' ')}`,
                            items: [
                              { key: 'winrate',        label: 'Win Rate',            northStar: true, narrative: nsNarrative('winrate', dna.winRate), desc: `${dna.wins}W · ${dna.losses}L · ${dna.matchCount} matches`,        value: `${dna.winRate.toFixed(1)}%`,                                    accent: dna.winRate >= 50 ? '#10b981' : '#f87171', matches: [] },
                              { key: 'avgptdiff',      label: 'Avg Point Diff',      desc: 'Average point margin per game',                                     value: `${dna.avgPtDiff >= 0 ? '+' : ''}${dna.avgPtDiff.toFixed(2)}`,  accent: dna.avgPtDiff >= 0 ? '#10b981' : '#f87171', matches: [] },
                              { key: 'ppg',            label: 'Points Per Game',     desc: 'Avg points scored per game (attack volume)',                         value: dna.pointsPerGame !== null ? dna.pointsPerGame.toFixed(1) : '—', accent: '#6366f1', matches: [] },
                              { key: 'avgopp',         label: 'Avg Opp Rank Beaten', desc: 'Average world rank of all opponents defeated — quality of wins',    value: dna.avgOppRankBeaten ? `#${dna.avgOppRankBeaten}` : '—',        accent: '#6366f1', matches: [] },
                              { key: 'straightWins',   label: 'Straight-Set Wins',   desc: 'Won without dropping a game — dominant victories',                  value: `${dna.straightSetsWins}`,   sub: dna.wins > 0 ? `${((dna.straightSetsWins/dna.wins)*100).toFixed(0)}% of wins` : null,     accent: '#10b981', matches: dna.dnaGroups.straightWins },
                              { key: 'straightLosses', label: 'Straight-Set Losses', desc: 'Lost without winning a game — complete capitulations',              value: `${dna.straightSetsLosses}`, sub: dna.losses > 0 ? `${((dna.straightSetsLosses/dna.losses)*100).toFixed(0)}% of losses` : null, accent: '#f87171', matches: dna.dnaGroups.straightLosses },
                              { key: 'form',           label: 'Current Form',        desc: `Last ${(dna.currentForm||[]).length} matches`,                      value: (() => { const f = dna.currentForm||[]; const w = f.filter(r=>r==='W').length; return `${w}W ${f.length-w}L`; })(), sub: (dna.currentForm||[]).join(' '), accent: (() => { const f = dna.currentForm||[]; const w = f.filter(r=>r==='W').length; return w/Math.max(f.length,1) >= 0.5 ? '#10b981' : '#f87171'; })(), matches: [] },
                            ],
                          },
                          ...(rc ? [{
                            key: 'ambition',
                            heading: 'Ambition — Playing Up',
                            summary: `Upset Rate ${rc.upsetRate !== null ? rc.upsetRate.toFixed(0)+'%' : '—'} · Upset Yield ${dna.upsetYield.toFixed(0)}% · Best scalp ${rc.biggestScalpRank ? '#'+rc.biggestScalpRank : '—'}`,
                            items: [
                              { key: 'ambitionzone',  label: 'Ambition Zone Win Rate', desc: `Win % vs opponents ranked 20+ above at match time · ${rc.ambitionMatches.length} matches — true underdog battles`, value: rc.ambitionWinRate !== null ? `${rc.ambitionWinRate.toFixed(1)}%` : '—', accent: rc.ambitionWinRate !== null && rc.ambitionWinRate >= 25 ? '#10b981' : '#94a3b8', matches: rc.ambitionMatches },
                              { key: 'upsetrate',    label: 'Upset Rate',        northStar: true, narrative: nsNarrative('upsetrate', rc.upsetRate), desc: `Win % vs higher-ranked opponents · ${rc.vsHigherCount} matches`,  value: rc.upsetRate !== null ? `${rc.upsetRate.toFixed(1)}%` : '—',   accent: rc.upsetRate !== null && rc.upsetRate >= 30 ? '#10b981' : '#94a3b8', matches: rc.vsHigherMatches },
                              { key: 'upsetyield',   label: 'Upset Yield',       desc: '% of total wins that came against higher-ranked opponents',        value: `${dna.upsetYield.toFixed(1)}%`,                               accent: dna.upsetYield >= 25 ? '#10b981' : '#94a3b8',                      matches: dna.allMatches.filter(m => m.isUpset) },
                              { key: 'biggestscalp', label: 'Best Single Upset Win',desc: 'Best single upset win — highest-ranked opponent beaten',           value: rc.biggestScalpRank ? `#${rc.biggestScalpRank}` : '—',         accent: '#8b5cf6',                                                          matches: rc.biggestScalpMatch },
                            ],
                          }] : []),
                          ...(rc ? [{
                            key: 'consistency',
                            heading: 'Consistency — Holding Ground',
                            summary: `Win Rate ±20 ranks ${rc.peerWinRate !== null ? rc.peerWinRate.toFixed(0)+'%' : '—'} · Game 1 Win % ${rc.leadProtectionRate !== null ? rc.leadProtectionRate.toFixed(0)+'%' : '—'} · Loss vs Lower ${rc.bananaSkinRate.toFixed(0)}%`,
                            items: [
                              { key: 'dominance',   label: 'Dominance Rate',       desc: `Win % as favourite vs lower-ranked · ${rc.vsLowerCount} matches`,                              value: rc.dominanceRate !== null ? `${rc.dominanceRate.toFixed(1)}%` : '—',         accent: rc.dominanceRate !== null && rc.dominanceRate >= 70 ? '#10b981' : '#f59e0b',          matches: rc.vsLowerMatches },
                              { key: 'hold',        label: 'Hold Rate',            desc: 'Win % vs players ranked 20+ below — must-win territory',                                       value: rc.holdRate !== null ? `${rc.holdRate.toFixed(1)}%` : '—',                   accent: rc.holdRate !== null && rc.holdRate >= 80 ? '#10b981' : '#f59e0b',                    matches: rc.holdMatches },
                              { key: 'bananaskin',  label: 'Loss Rate with players lower ranked', desc: `Shock losses to lower-ranked · ${rc.bananaSkinMatches.length} of ${dna.losses} losses`,      value: `${rc.bananaSkinRate.toFixed(1)}%`,                                           accent: rc.bananaSkinRate > 30 ? '#f87171' : '#94a3b8',                                      matches: rc.bananaSkinMatches },
                              { key: 'peerzone',    label: 'Win Rate ±20 ranks',   northStar: true, narrative: nsNarrative('peerzone', rc.peerWinRate), desc: `Win % vs opponents within ±20 ranks at match time · ${rc.peerMatches.length} matches — rank-adjusted close battles`, value: rc.peerWinRate !== null ? `${rc.peerWinRate.toFixed(1)}%` : '—', accent: rc.peerWinRate !== null && rc.peerWinRate >= 50 ? '#10b981' : '#f87171', matches: rc.peerMatches },
                              { key: 'proximity',   label: 'Rate ±10 ranks',       desc: `Win % vs opponents within ±10 ranks · ${rc.vsProximityMatches.length} matches`,              value: rc.proximityWinRate !== null ? `${rc.proximityWinRate.toFixed(1)}%` : '—',     accent: rc.proximityWinRate !== null && rc.proximityWinRate >= 50 ? '#10b981' : '#f87171',    matches: rc.vsProximityMatches },
                              { key: 'leadprotect', label: 'Win % in matches where game 1 was won', desc: `Win % in matches where game 1 was won · ${rc.wonGame1Matches.length} such matches`,          value: rc.leadProtectionRate !== null ? `${rc.leadProtectionRate.toFixed(1)}%` : '—', accent: rc.leadProtectionRate !== null && rc.leadProtectionRate >= 75 ? '#10b981' : '#f59e0b', matches: rc.wonGame1Matches.filter(m => m.result === 'W') },
                              { key: 'comfort',     label: 'Comfort Zone Index',   desc: rc.comfortZoneIndex !== null ? `Win% vs lower-ranked ÷ win% vs higher-ranked. 1.0× = balanced; above 1.5× = relies on weaker opponents. · ${rc.comfortZoneIndex === 0 ? 'All wins came against higher-ranked opponents — drops expected wins' : rc.comfortZoneIndex > 1.5 ? 'Over-reliant on weaker opponents' : rc.comfortZoneIndex < 1.1 ? 'Balanced across all ranks' : 'Moderate rank dependency'}` : 'Win% vs lower-ranked ÷ win% vs higher-ranked — insufficient data across both groups', value: rc.comfortZoneIndex !== null ? `${rc.comfortZoneIndex.toFixed(2)}×` : '—', accent: rc.comfortZoneIndex !== null && rc.comfortZoneIndex <= 1.3 ? '#10b981' : '#f59e0b', matches: rc.vsRankedMatches || [] },
                            ],
                          }] : []),
                          {
                            key: 'mental',
                            heading: 'Mental Game — Under Pressure',
                            summary: `Clutch ${dna.clutchIndex != null ? dna.clutchIndex.toFixed(0)+'%' : '—'} · Deciding game ${rc?.decidingWinRate != null ? rc.decidingWinRate.toFixed(0)+'%' : '—'} · ${dna.comebackWins} comebacks`,
                            items: [
                              { key: 'clutch',        label: 'Clutch Index',           northStar: true, narrative: nsNarrative('clutch', dna.clutchIndex), desc: 'Win rate in deciding-game matches (3-2 or 4-3)',                                                                                                                               value: dna.clutchIndex != null ? `${dna.clutchIndex.toFixed(1)}%` : '—', sub: `${dna.dnaGroups.clutch.length} deciding matches`,                                                       accent: '#f59e0b', matches: dna.dnaGroups.clutch },
                              { key: 'comebacks',     label: 'Comeback Wins',          desc: 'Won after losing game 1 — mental resilience',                                                                                                                                          value: `${dna.comebackWins}`,            sub: dna.wins > 0 ? `${((dna.comebackWins/dna.wins)*100).toFixed(0)}% of wins` : null,               accent: '#38bdf8', matches: dna.dnaGroups.comebacks },
                              ...(rc ? [
                                { key: 'deciding',      label: 'Deciding Game Win Rate',desc: `Win % in matches going to game 5 or 7 · ${rc.decidingMatches.length} matches`,                                                                                                       value: rc.decidingWinRate !== null ? `${rc.decidingWinRate.toFixed(1)}%` : '—',  accent: rc.decidingWinRate !== null && rc.decidingWinRate >= 50 ? '#10b981' : '#f87171', matches: rc.decidingMatches },
                                { key: 'deuce',         label: 'Deuce Win Rate',        desc: `Win % in games reaching 10–10 · ${rc.deuceTotal} deuce games across ${rc.deuceMatches?.length ?? 0} matches`,                                                                                                                       value: rc.deuceWinRate !== null ? `${rc.deuceWinRate.toFixed(1)}%` : '—',        accent: rc.deuceWinRate !== null && rc.deuceWinRate >= 50 ? '#10b981' : '#f87171',     matches: rc.deuceMatches || [] },
                                { key: 'momentum-hot',  label: 'Momentum — Hot Streak', desc: `Win % entering match on a 3-win streak · ${rc.hotTotal >= 3 ? rc.hotTotal+' situations' : 'insufficient data'}`,                                                                    value: rc.momentumHotRate !== null ? `${rc.momentumHotRate.toFixed(1)}%` : '—',  accent: rc.momentumHotRate !== null && rc.momentumHotRate >= 60 ? '#10b981' : '#94a3b8', matches: rc.hotMatches },
                                { key: 'momentum-cold', label: 'Momentum — Cold Streak',desc: `Win % entering match on a 3-loss streak · ${rc.coldTotal >= 3 ? rc.coldTotal+' situations' : 'insufficient data'}`,                                                                 value: rc.momentumColdRate !== null ? `${rc.momentumColdRate.toFixed(1)}%` : '—', accent: rc.momentumColdRate !== null && rc.momentumColdRate >= 40 ? '#38bdf8' : '#f87171', matches: rc.coldMatches },
                              ] : []),
                            ],
                          },
                          ...(rc ? [{
                            key: 'tournament',
                            heading: 'Tournament Depth',
                            summary: `Early rounds ${rc.groupWinRate !== null ? rc.groupWinRate.toFixed(0)+'%' : '—'} · QF/SF ${rc.knockoutWinRate !== null ? rc.knockoutWinRate.toFixed(0)+'%' : '—'} · Finals ${rc.finalsWinRate !== null ? rc.finalsWinRate.toFixed(0)+'%' : '—'}`,
                            items: [
                              { key: 'groupstage', label: 'Early Rounds Win Rate', desc: `Win % in group stage & rounds before QF · ${rc.groupMatches.length} matches`,    value: rc.groupWinRate !== null ? `${rc.groupWinRate.toFixed(1)}%` : '—',    accent: rc.groupWinRate !== null && rc.groupWinRate >= 60 ? '#10b981' : '#f59e0b',    matches: rc.groupMatches },
                              { key: 'knockout',   label: 'QF / SF Win Rate',      northStar: true, narrative: nsNarrative('knockout', rc.knockoutWinRate), desc: `Win % in quarter-finals and semi-finals · ${rc.knockoutMatches.length} matches`,  value: rc.knockoutWinRate !== null ? `${rc.knockoutWinRate.toFixed(1)}%` : '—', accent: rc.knockoutWinRate !== null && rc.knockoutWinRate >= 50 ? '#10b981' : '#f59e0b', matches: rc.knockoutMatches },
                              { key: 'finals',     label: 'Finals Win Rate',       desc: `Win % when reaching a final · ${rc.finalsMatches.length} finals`,                value: rc.finalsWinRate !== null ? `${rc.finalsWinRate.toFixed(1)}%` : '—',   accent: rc.finalsWinRate !== null && rc.finalsWinRate >= 50 ? '#10b981' : '#f87171',  matches: rc.finalsMatches },
                              { key: 'avground',   label: 'Avg Round Reached',     desc: `Average deepest stage reached per tournament · ${rc.depthValues.length} tournaments`, value: rc.avgRoundLabel || '—', accent: '#6366f1', matches: [], customContent: rc.avgRoundByGrade?.length > 0 ? rc.avgRoundByGrade : null },
                            ],
                          }] : []),
                        ];

                        const toggleSection = (key) => {
                          setOpenPerfSections(prev => {
                            const next = new Set(prev);
                            next.has(key) ? next.delete(key) : next.add(key);
                            return next;
                          });
                          setOpenDna(null);
                          setOpenRankCtx(null);
                        };

                        const toggleItem = (key) => {
                          if (DNA_KEYS.has(key)) {
                            setOpenDna(prev => prev === key ? null : key);
                          } else {
                            setOpenRankCtx(prev => prev === key ? null : key);
                          }
                        };

                        const isItemOpen = (key) => openDna === key || openRankCtx === key;

                        return allSections.map(section => {
                          const isOpen = openPerfSections.has(section.key);
                          return (
                            <div key={section.key} className="border border-slate-200 rounded-xl overflow-hidden">
                              {/* Section header — always visible */}
                              <button
                                onClick={() => toggleSection(section.key)}
                                className={`w-full flex items-center justify-between px-4 py-3.5 text-left transition-colors ${isOpen ? 'bg-slate-50 border-b border-slate-100' : 'hover:bg-slate-50/60'}`}>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-slate-800">{section.heading}</p>
                                  {!isOpen && <p className="text-xs text-slate-400 mt-0.5">{section.summary}</p>}
                                </div>
                                {!isOpen && (() => {
                                  const ns = section.items.find(it => it.northStar);
                                  if (!ns || ns.value === '—') return null;
                                  return (
                                    <span style={{ fontSize: 22, fontWeight: 800, color: ns.accent, marginRight: 10, lineHeight: 1 }}>
                                      {ns.value}
                                    </span>
                                  );
                                })()}
                                {isOpen ? <ChevronUp size={15} className="text-slate-400 shrink-0" /> : <ChevronDown size={15} className="text-slate-400 shrink-0" />}
                              </button>

                              {/* Metric rows — visible when section is open */}
                              {isOpen && (
                                <div className="divide-y divide-slate-100">
                                  {section.items.map(item => {
                                    const hasContent = item.matches.length > 0 || !!item.customContent;
                                    const GRADE_DESC = { '1':'Olympics, Worlds, Grand Smash', '2':'Asian Games, WTT Champions, World Cup', '3':'WTT Star Contender, Commonwealth', '4':'WTT Contender, South Asian', '5':'WTT Feeder', '6':'TTFI Nationals, Ranking, Khelo India' };

                                    if (item.northStar) {
                                      return (
                                        <div key={item.key} style={{ borderBottom: '1px solid #e8edf4' }}>
                                          <button
                                            onClick={() => hasContent && toggleItem(item.key)}
                                            style={{ width: '100%', textAlign: 'left', border: 'none', cursor: hasContent ? 'pointer' : 'default', background: `${item.accent}09`, display: 'block', padding: '16px 16px 14px' }}>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                              <div style={{ flex: 1, minWidth: 0 }}>
                                                <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 800, color: item.accent, textTransform: 'uppercase', letterSpacing: '0.1em', background: `${item.accent}1a`, padding: '2px 7px', borderRadius: 4, marginBottom: 6 }}>North Star</span>
                                                <p style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 3 }}>{item.label}</p>
                                                {item.narrative && <p style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', marginBottom: 3 }}>{item.narrative}</p>}
                                                <p style={{ fontSize: 11, color: '#94a3b8' }}>{item.desc}</p>
                                              </div>
                                              <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                                <div>
                                                  <p style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, color: item.accent }}>{item.value}</p>
                                                  {item.sub && <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{item.sub}</p>}
                                                </div>
                                                {hasContent && (isItemOpen(item.key) ? <ChevronUp size={13} style={{ color: '#94a3b8', flexShrink: 0 }} /> : <ChevronDown size={13} style={{ color: '#94a3b8', flexShrink: 0 }} />)}
                                              </div>
                                            </div>
                                          </button>
                                          {isItemOpen(item.key) && item.matches.length > 0 && (
                                            <div className="slide border-t border-slate-100 bg-slate-50/40">
                                              <MatchList matches={item.matches} />
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }

                                    return (
                                      <div key={item.key}>
                                        <button
                                          onClick={() => hasContent && toggleItem(item.key)}
                                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${isItemOpen(item.key) ? 'bg-blue-50/30' : hasContent ? 'hover:bg-slate-50/70' : ''}`}>
                                          <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 99, background: item.accent, flexShrink: 0 }} />
                                          <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-slate-800">{item.label}</p>
                                            <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                                          </div>
                                          <div className="text-right shrink-0">
                                            <p className="text-base font-bold" style={{ color: item.accent }}>{item.value}</p>
                                            {item.sub && <p className="text-[11px] text-slate-400 mt-0.5">{item.sub}</p>}
                                          </div>
                                          {hasContent
                                            ? isItemOpen(item.key) ? <ChevronUp size={13} className="text-slate-400 shrink-0" /> : <ChevronDown size={13} className="text-slate-400 shrink-0" />
                                            : <span className="w-[13px] shrink-0" />}
                                        </button>
                                        {isItemOpen(item.key) && item.customContent && (
                                          <div className="slide border-t border-slate-100 bg-slate-50/40 px-4 py-2">
                                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                              <thead>
                                                <tr>
                                                  <td style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', paddingBottom: 6, paddingRight: 12 }}>Grade</td>
                                                  <td style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', paddingBottom: 6 }}>Events</td>
                                                  <td style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', paddingBottom: 6, textAlign: 'right' }}>Avg Round</td>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {item.customContent.map(g => (
                                                  <tr key={g.grade} style={{ borderTop: '0.5px solid #f1f5f9' }}>
                                                    <td style={{ padding: '6px 12px 6px 0', fontSize: 12, fontWeight: 600, color: '#6366f1', whiteSpace: 'nowrap' }}>G{g.grade}</td>
                                                    <td style={{ padding: '6px 12px 6px 0', fontSize: 11, color: '#64748b' }}>{GRADE_DESC[g.grade] || ''} <span style={{ color: '#94a3b8' }}>· {g.count} {g.count === 1 ? 'tourn' : 'tourneys'}</span></td>
                                                    <td style={{ padding: '6px 0', fontSize: 12, fontWeight: 600, color: '#334155', textAlign: 'right' }}>{g.label}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                        {isItemOpen(item.key) && item.matches.length > 0 && (
                                          <div className="slide border-t border-slate-100 bg-slate-50/40">
                                            <MatchList matches={item.matches} />
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}

                  {activeTab === 'form' && (
                    <div className="slide">
                      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                        <p className="text-xs text-slate-500 font-medium">Recent form by tournament</p>
                        <span className="text-xs text-slate-400">{activeLedger.length} matches</span>
                      </div>
                      <TournamentFormTab
                        matchLedger={activeLedger}
                        showAll={formShowAll}
                        onToggleAll={() => setFormShowAll(o => !o)}
                      />
                    </div>
                  )}

                  {activeTab === 'benchmark' && (
                    <div className="slide p-5 space-y-5">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-slate-500 font-medium">SF+ players at major events</p>
                          {bmProfile && (() => {
                            const first = Object.values(bmProfile)[0];
                            return first?.player_count
                              ? <p className="text-[10px] text-slate-400 mt-0.5">{first.player_count} elite players</p>
                              : null;
                          })()}
                        </div>
                        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
                          {[6, 12, 18].map(w => (
                            <button key={w} onClick={() => setBmWindow(w)}
                              className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                                bmWindow === w ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                              {w}M
                            </button>
                          ))}
                        </div>
                      </div>

                      {bmLoading && (
                        <div className="text-center py-8 text-slate-400 text-sm">Loading benchmark…</div>
                      )}

                      {!bmLoading && !bmProfile && (
                        <div className="text-center py-8 bg-slate-50 rounded-xl">
                          <p className="text-sm text-slate-500 font-medium mb-3">No benchmark data yet</p>
                          <code className="text-[11px] text-slate-400 bg-white border border-slate-200 px-3 py-2 rounded-lg block max-w-sm mx-auto">
                            python scripts/compute_player_benchmarks.py --gender {players.find(p => p.player_id === selectedPlayer)?.gender === 'W' ? 'W' : 'M'}
                          </code>
                        </div>
                      )}

                      {!bmLoading && bmProfile && (
                        <>
                          {/* Metric bars */}
                          <div className="space-y-3">
                            {BM_METRICS.map((entry, idx) => {
                              // Group divider
                              if (entry.group) {
                                return (
                                  <div key={`g-${idx}`} className={`${idx > 0 ? 'pt-3 border-t border-slate-100' : ''}`}>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                                      {entry.group}
                                    </p>
                                  </div>
                                );
                              }

                              const { key, label, fmt, domain, higher_better, tooltip } = entry;
                              const prof = bmProfile[key];
                              if (!prof) return null;
                              const myValRaw = bmMyStats?.[key];
                              // Supabase returns NUMERIC as strings — parse to float for correct comparison
                              const myVal = myValRaw != null ? parseFloat(myValRaw) : null;
                              const p25f  = parseFloat(prof.p25);
                              const p50f  = parseFloat(prof.p50);
                              const p75f  = parseFloat(prof.p75);
                              const [dMin, dMax] = domain;
                              const toX = v => Math.max(0, Math.min(100, (parseFloat(v) - dMin) / (dMax - dMin) * 100));
                              const p25x = toX(p25f);
                              const p50x = toX(p50f);
                              const p75x = toX(p75f);
                              const myX  = myVal != null ? toX(myVal) : null;
                              let myColor = '#94a3b8';
                              if (myVal != null) {
                                const good = higher_better ? myVal >= p50f : myVal <= p50f;
                                const bad  = higher_better ? myVal <  p25f : myVal >  p75f;
                                myColor = bad ? '#ef4444' : good ? '#10b981' : '#f59e0b';
                              }
                              return (
                                <div key={key}>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <div className="relative group flex items-center gap-1 w-44 shrink-0 cursor-help">
                                      <span className="text-xs text-slate-500 font-medium leading-tight">{label}</span>
                                      <span className="text-slate-300 text-[9px] leading-none select-none">ⓘ</span>
                                      {tooltip && (
                                        <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-50 w-64 bg-slate-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-xl pointer-events-none">
                                          {tooltip}
                                          <div className="absolute top-full left-4 border-4 border-transparent border-t-slate-800" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px]">
                                      <span className="text-slate-400">{fmt(p25f)}</span>
                                      <span className="font-semibold text-slate-700">{fmt(p50f)}</span>
                                      <span className="text-slate-400">{fmt(p75f)}</span>
                                      {myVal != null && (
                                        <span className="font-bold ml-1" style={{ color: myColor }}>
                                          · {fmt(myVal)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="relative h-2.5 bg-slate-100 rounded-full">
                                    {/* P25–P75 band */}
                                    <div className="absolute top-0 h-full rounded-full bg-blue-200"
                                      style={{ left: `${p25x}%`, width: `${p75x - p25x}%` }} />
                                    {/* P50 line */}
                                    <div className="absolute top-0 h-full w-px bg-blue-500"
                                      style={{ left: `${p50x}%` }} />
                                    {/* Player dot */}
                                    {myX != null && (
                                      <div
                                        className="absolute top-0 w-2.5 h-2.5 rounded-full border-2 border-white -translate-x-1/2"
                                        style={{ left: `${myX}%`, background: myColor, boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
                                      />
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Legend */}
                          <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-2">
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">How to read</p>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] text-slate-500">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-2 rounded bg-blue-200 shrink-0" />
                                <span><b className="text-slate-600">P25–P75 band</b> — middle 50% of elites</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-px h-4 bg-blue-500 shrink-0 mx-[13px]" />
                                <span><b className="text-slate-600">Median (P50)</b> — half above, half below</span>
                              </div>
                              {bmMyStats && (<>
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-3 rounded-full bg-emerald-500 shrink-0 mx-[2px]" />
                                  <span><b className="text-slate-600">Green</b> — at or above median</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-3 rounded-full bg-amber-400 shrink-0 mx-[2px]" />
                                  <span><b className="text-slate-600">Amber</b> — P25 to median</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-3 rounded-full bg-red-400 shrink-0 mx-[2px]" />
                                  <span><b className="text-slate-600">Red</b> — below P25</span>
                                </div>
                              </>)}
                            </div>
                          </div>

                          {/* Elite players table */}
                          {bmElitePlayers.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
                                Elite players — {bmWindow}-month window
                              </p>
                              <div className="overflow-x-auto">
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                  <thead>
                                    <tr style={{ borderBottom: '1px solid #f1f5f9', color: '#94a3b8', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.05em' }}>
                                      <th style={{ textAlign: 'left',  padding: '4px 8px 4px 0' }}>Player</th>
                                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Rank</th>
                                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Win%</th>
                                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>vs T50</th>
                                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>vs T100</th>
                                      <th style={{ textAlign: 'right', padding: '4px 8px' }} title="Matches played">M</th>
                                      <th style={{ textAlign: 'right', padding: '4px 8px' }} title="Total competitions (tournaments) entered">C</th>
                                      <th style={{ textAlign: 'right', padding: '4px 8px' }} title="Avg rank of all opponents faced (schedule difficulty)">Avg Opp</th>
                                      <th style={{ textAlign: 'right', padding: '4px 8px' }} title="Avg rank of opponents beaten (quality of wins)">Beaten</th>
                                      <th style={{ textAlign: 'right', padding: '4px 4px' }} title="Elite event matches / competitions">Elite (m/c)</th>
                                      <th style={{ textAlign: 'right', padding: '4px 4px' }} title="Star Contender matches / competitions">Star (m/c)</th>
                                      <th style={{ textAlign: 'right', padding: '4px 4px' }} title="Contender matches / competitions">Cont (m/c)</th>
                                      <th style={{ textAlign: 'right', padding: '4px 8px' }} title="Average rank during the window">Avg Rank</th>
                                      <th style={{ textAlign: 'right', padding: '4px 8px' }} title="Best (lowest) rank in the window">Peak</th>
                                      <th style={{ textAlign: 'right', padding: '4px 0 4px 8px' }} title="Rank improvement: positive = moved up">±Rank</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {bmElitePlayers.map((p, i) => {
                                      const isMe = p.player_id === selectedPlayer;
                                      return (
                                        <tr key={p.player_id}
                                          style={{ borderBottom: '1px solid #f8fafc', background: isMe ? '#eff6ff' : i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                                          <td style={{ padding: '5px 8px 5px 0', fontWeight: isMe ? 600 : 400, color: isMe ? '#1d4ed8' : '#334155' }}>
                                            {p.player_name}
                                            <span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>{p.country_code}</span>
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 8px', color: '#64748b' }}>
                                            {p.current_rank ? `#${p.current_rank}` : '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 8px', color: '#334155', fontWeight: 500 }}>
                                            {p.win_rate != null ? `${Math.round(parseFloat(p.win_rate) * 100)}%` : '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 8px', color: '#334155' }}>
                                            {p.win_rate_top50 != null ? `${Math.round(parseFloat(p.win_rate_top50) * 100)}%` : '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 8px', color: '#334155' }}>
                                            {p.win_rate_top100 != null ? `${Math.round(parseFloat(p.win_rate_top100) * 100)}%` : '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 8px', color: '#64748b' }}>
                                            {p.matches_played ?? '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 8px', color: '#64748b' }}>
                                            {p.total_competitions ?? '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 8px', color: '#64748b' }}>
                                            {p.avg_opp_rank != null ? `#${Math.round(parseFloat(p.avg_opp_rank))}` : '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 8px', color: '#64748b' }}>
                                            {p.avg_opp_rank_beaten != null ? `#${Math.round(parseFloat(p.avg_opp_rank_beaten))}` : '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 4px', color: '#64748b' }}>
                                            {p.elite_matches != null ? `${p.elite_matches}m / ${p.elite_competitions ?? 0}c` : '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 4px', color: '#64748b' }}>
                                            {p.star_contender_matches != null ? `${p.star_contender_matches}m / ${p.star_contender_competitions ?? 0}c` : '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 4px', color: '#64748b' }}>
                                            {p.contender_matches != null ? `${p.contender_matches}m / ${p.contender_competitions ?? 0}c` : '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 8px', color: '#64748b' }}>
                                            {p.avg_rank_in_window != null ? `#${Math.round(parseFloat(p.avg_rank_in_window))}` : '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 8px', color: '#64748b' }}>
                                            {p.rank_best != null ? `#${p.rank_best}` : '—'}
                                          </td>
                                          <td style={{ textAlign: 'right', padding: '5px 0 5px 8px', fontWeight: 500,
                                            color: p.rank_change > 0 ? '#10b981' : p.rank_change < 0 ? '#ef4444' : '#64748b' }}>
                                            {p.rank_change != null ? (p.rank_change > 0 ? `+${p.rank_change}` : `${p.rank_change}`) : '—'}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                </div>
              </div>

              <p className="text-[10px] text-slate-400 text-center pb-4">
                <span className="text-emerald-500 font-semibold">★</span> Upset win &nbsp;·&nbsp;
                <span className="text-amber-500 font-semibold">⚡</span> Clutch (deciding set) &nbsp;·&nbsp;
                <span className="text-sky-500 font-semibold">↩</span> Comeback &nbsp;·&nbsp;
                <span style={{ color: '#7c3aed' }} className="font-semibold">DOM</span> Domestic match
              </p>
            </>
          )}

          {/* ── Youth Rankings ── */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-slate-100">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Youth Rankings</p>
              {/* Age group tabs */}
              <div className="flex gap-1.5 flex-wrap mb-2">
                {['U11','U13','U15','U17','U19'].map(ag => (
                  <button key={ag} onClick={() => {
                    setYouthAgeGroup(ag);
                    if (['U11','U13'].includes(ag) && ['MD','WD','XD'].includes(youthDiscipline)) {
                      setYouthDiscipline('MS');
                    }
                  }}
                  className={`text-xs px-3 py-1 rounded-full border font-semibold transition-all ${
                    youthAgeGroup === ag
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                  }`}>
                    {ag}
                  </button>
                ))}
              </div>
              {/* Discipline chips */}
              <div className="flex gap-1.5 flex-wrap">
                {YOUTH_DISCIPLINES
                  .filter(d => !['U11','U13'].includes(youthAgeGroup) || d.table === 'singles')
                  .map(d => (
                    <button key={d.code} onClick={() => setYouthDiscipline(d.code)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                        youthDiscipline === d.code
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                      }`}>
                      {d.label}
                    </button>
                  ))
                }
              </div>
            </div>

            <div className="px-4 py-3">
              {youthLoading ? (
                <p className="text-xs text-slate-400 py-4 text-center">Loading…</p>
              ) : youthRows.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">No data available for this category.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-slate-400">
                      Top {youthRows.length} · Week {youthRows[0]?.ranking_week}/{youthRows[0]?.ranking_year}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {youthRows.filter(r => (r.country_code || r.country_code1) === 'IND' || r.country_code2 === 'IND').length} Indians ranked
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    {youthRows.map((r, i) => {
                      const isDoubles = YOUTH_DISCIPLINES.find(d => d.code === youthDiscipline)?.table === 'doubles';
                      const name    = isDoubles ? `${r.player_name1} / ${r.player_name2}` : r.player_name;
                      const country = isDoubles ? r.country_code1 : r.country_code;
                      const isInd   = country === 'IND' || r.country_code2 === 'IND';
                      const points  = isDoubles ? r.points : r.points_ytd;
                      const diff    = r.rank_diff;
                      return (
                        <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${
                          isInd ? 'bg-orange-50 border border-orange-100' : i % 2 === 0 ? '' : 'bg-slate-50/50'
                        }`}>
                          <span className="w-7 text-right font-mono text-slate-400 shrink-0">#{r.age_cat_rank}</span>
                          <span className={`flex-1 font-medium truncate ${isInd ? 'text-orange-800' : 'text-slate-700'}`}>{name}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">{country}{isDoubles && r.country_code2 !== r.country_code1 ? `/${r.country_code2}` : ''}</span>
                          <span className="text-[10px] text-slate-400 shrink-0 w-16 text-right">{points != null ? Math.round(points).toLocaleString() : '—'} pts</span>
                          <span className={`text-[10px] w-8 text-right shrink-0 font-semibold ${
                            diff > 0 ? 'text-emerald-500' : diff < 0 ? 'text-red-400' : 'text-slate-300'
                          }`}>
                            {diff > 0 ? `↑${diff}` : diff < 0 ? `↓${Math.abs(diff)}` : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
