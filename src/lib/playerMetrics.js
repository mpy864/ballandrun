// ─── Shared player metrics utilities ─────────────────────────────────────────
// Used by DynamicOKRDashboard and PlayerPage

// The match result as the source recorded it, seen from this player's side.
//
// Every score shown in the app used to be counted from the game scores we happen to
// hold, which is a different question. 3,257 matches have only their first game stored —
// captured while still being played and never re-fetched — so a 0-3 defeat counted from
// games reads "0-1". match_score says 0-3 and has done all along.
//
// Stored from comp1's side, so it flips for comp2. Returns null when absent or a
// placeholder, and callers fall back to counting.
export function matchScoreFor(raw, isComp1) {
  if (!raw || raw === '0-0') return null
  const [a, b] = String(raw).split('-')
  if (a === undefined || b === undefined) return null
  return isComp1 ? `${a.trim()}-${b.trim()}` : `${b.trim()}-${a.trim()}`
}

export function parseScoresForPlayer(str, isComp1) {
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

export function parseGame1Won(str, isComp1) {
  if (!str || str === 'N/A') return null;
  const first = str.split(',')[0]?.trim();
  if (!first) return null;
  const [a, b] = first.split('-').map(Number);
  if (isNaN(a) || isNaN(b)) return null;
  const [p, o] = isComp1 ? [a, b] : [b, a];
  return p > o;
}

export function countDeuceGames(str, isComp1) {
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

export function checkComeback(str, isComp1, won) {
  if (!won || !str || str === 'N/A') return false;
  const games = str.split(',').map(s => s.trim());
  if (games.length < 2) return false;
  const [a, b] = games[0].split('-').map(Number);
  if (isNaN(a) || isNaN(b)) return false;
  return (isComp1 ? a : b) < (isComp1 ? b : a);
}

export function cleanRound(round) {
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

export function nsNarrative(key, value) {
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
    case 'peerzone':
      return v >= 60 ? `${v.toFixed(0)}% vs peers — winning the close-rank battles`
           : v >= 50 ? `Slightly above breakeven vs similar-ranked opponents`
           : v >= 40 ? `Below 50% vs similar-ranked — a competitive consistency issue`
           :           `Under 40% vs peers — ranking may be at risk`;
    default: return null;
  }
}

export function computeVerdict(w) {
  if (w.matchCount < 5) return { text: 'Insufficient data', tone: 'gray' };
  const up = w.rankChange > 0, strong = w.winRate >= 50;
  if (up && strong)   return { text: `Ascending — up ${w.rankChange} places`,                    tone: 'green' };
  if (!up && !strong) return { text: 'Declining — rank and win rate both falling',                tone: 'red'   };
  if (up && !strong)  return { text: `Quietly rising — rank up ${w.rankChange} on quality wins`, tone: 'blue'  };
  return                     { text: 'Plateau — results stable, no ranking movement',            tone: 'amber' };
}

export function computeWindowData(matchLedger, rankingHistory, windowMonths, playerCurrentRank) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - windowMonths);
  cutoff.setHours(0, 0, 0, 0);
  const filtered = matchLedger.filter(m => m.rawDate >= cutoff);
  const wins   = filtered.filter(m => m.result === 'W');
  const losses = filtered.filter(m => m.result === 'L');
  const total  = filtered.length;

  const winRate     = total > 0 ? (wins.length / total) * 100 : 0;
  const upsetYield  = wins.length > 0 ? (wins.filter(m => m.isUpset).length / wins.length) * 100 : 0;
  const clutchGames = filtered.filter(m => m.gamesLost === m.gamesWon - 1 || m.gamesLost === m.gamesWon + 1);
  const clutchIndex = clutchGames.length > 0 ? (clutchGames.filter(m => m.result === 'W').length / clutchGames.length) * 100 : null;

  let td = 0, dc = 0;
  for (const m of filtered) { if (m.pointDiff != null) { td += m.pointDiff; dc++; } }
  const avgPtDiff = dc > 0 ? td / dc : 0;

  // rankingHistory must have { ranking_date, rank } in descending order
  const rankAtStart = rankingHistory.find(r => new Date(r.ranking_date) <= cutoff)?.rank;
  const rankChange  = rankAtStart ? rankAtStart - playerCurrentRank : 0;

  const beaten = wins.filter(m => m.opponentRank < 999).map(m => m.opponentRank);
  const avgOppRankBeaten = beaten.length > 0
    ? Math.round(beaten.reduce((s, v) => s + v, 0) / beaten.length) : null;

  const straightSetsWins   = wins.filter(m => m.isStraightWin).length;
  const straightSetsLosses = losses.filter(m => m.isStraightLoss).length;
  const comebackWins       = wins.filter(m => m.isComeback).length;

  const ranked   = filtered.filter(m => m.opponentRank !== 999 && m.playerRankAtMatch && m.playerRankAtMatch !== 999);
  const vsLower  = ranked.filter(m => m.opponentRank > m.playerRankAtMatch);
  const vsHigher = ranked.filter(m => m.opponentRank < m.playerRankAtMatch);
  const vsLowerWins  = vsLower.filter(m => m.result === 'W').length;
  const vsHigherWins = vsHigher.filter(m => m.result === 'W').length;

  const dominanceRate  = vsLower.length  > 0 ? (vsLowerWins  / vsLower.length)  * 100 : null;
  const upsetRate      = vsHigher.length > 0 ? (vsHigherWins / vsHigher.length) * 100 : null;
  const bananaSkinMatches = losses.filter(m => m.opponentRank !== 999 && m.playerRankAtMatch && m.opponentRank > m.playerRankAtMatch);
  const bananaSkinRate    = losses.length > 0 ? (bananaSkinMatches.length / losses.length) * 100 : 0;

  const vsMuchLower = ranked.filter(m => m.opponentRank > m.playerRankAtMatch + 20);
  const holdRate    = vsMuchLower.length > 0 ? (vsMuchLower.filter(m => m.result === 'W').length / vsMuchLower.length) * 100 : null;

  const vsProximity      = ranked.filter(m => Math.abs(m.opponentRank - m.playerRankAtMatch) <= 10);
  const proximityWinRate = vsProximity.length > 0 ? (vsProximity.filter(m => m.result === 'W').length / vsProximity.length) * 100 : null;

  const comfortZoneIndex = (dominanceRate !== null && upsetRate !== null && upsetRate > 0)
    ? +(dominanceRate / upsetRate).toFixed(2) : null;

  const historicalRanked = filtered.filter(m => m.opponentRank !== 999 && m.playerRankAtMatch && m.playerRankAtMatch !== 999);
  const peerMatches      = historicalRanked.filter(m => Math.abs(m.opponentRank - m.playerRankAtMatch) <= 20);
  const ambitionMatches  = historicalRanked.filter(m => m.playerRankAtMatch - m.opponentRank > 20);
  const peerWins         = peerMatches.filter(m => m.result === 'W').length;
  const ambitionWins     = ambitionMatches.filter(m => m.result === 'W').length;
  const peerWinRate      = peerMatches.length > 0 ? (peerWins / peerMatches.length) * 100 : null;
  const ambitionWinRate  = ambitionMatches.length > 0 ? (ambitionWins / ambitionMatches.length) * 100 : null;

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

  const sortedDesc  = [...filtered].sort((a, b) => b.rawDate - a.rawDate);
  const currentForm = sortedDesc.slice(0, 10).map(m => m.result);

  let totalPtsWon = 0, totalGamesPlayed = 0;
  for (const m of filtered) {
    if (m.totalGames > 0) { totalPtsWon += (m.pointsWon || 0); totalGamesPlayed += m.totalGames; }
  }
  const pointsPerGame = totalGamesPlayed > 0 ? totalPtsWon / totalGamesPlayed : null;

  const vsTop20 = filtered.filter(m => m.opponentRank !== 999 && m.opponentRank <= 20);
  const vsTop50 = filtered.filter(m => m.opponentRank !== 999 && m.opponentRank <= 50);
  const giantKillerTop20 = vsTop20.length > 0 ? (vsTop20.filter(m => m.result === 'W').length / vsTop20.length) * 100 : null;
  const giantKillerTop50 = vsTop50.length > 0 ? (vsTop50.filter(m => m.result === 'W').length / vsTop50.length) * 100 : null;

  const upsetWinMatches  = wins.filter(m => m.opponentRank !== 999 && m.playerRankAtMatch && m.opponentRank < m.playerRankAtMatch);
  const biggestScalpRank = upsetWinMatches.length > 0 ? Math.min(...upsetWinMatches.map(m => m.opponentRank)) : null;
  const biggestScalpMatch = biggestScalpRank !== null ? [upsetWinMatches.find(m => m.opponentRank === biggestScalpRank)] : [];

  const wonGame1Matches    = filtered.filter(m => m.wonGame1 === true);
  const leadProtectionRate = wonGame1Matches.length > 0 ? (wonGame1Matches.filter(m => m.result === 'W').length / wonGame1Matches.length) * 100 : null;
  const blownLeadMatches   = wonGame1Matches.filter(m => m.result === 'L');
  const blownLeadRate      = wonGame1Matches.length > 0 ? (blownLeadMatches.length / wonGame1Matches.length) * 100 : null;

  const decidingMatches = filtered.filter(m => m.totalGames === 5 || m.totalGames === 7);
  const decidingWinRate = decidingMatches.length > 0 ? (decidingMatches.filter(m => m.result === 'W').length / decidingMatches.length) * 100 : null;

  let deuceWon = 0, deuceTotal = 0;
  const deuceMatches = [];
  for (const m of filtered) {
    if (m.deuceGames) {
      const d = m.deuceGames.won + m.deuceGames.lost;
      if (d > 0) { deuceMatches.push(m); deuceWon += m.deuceGames.won; deuceTotal += d; }
    }
  }
  const deuceWinRate = deuceTotal > 0 ? (deuceWon / deuceTotal) * 100 : null;

  const normaliseRound = r => {
    if (!r || r === 'N/A') return null;
    const cr = cleanRound(r);
    if (cr) return cr;
    const low = r.toLowerCase();
    if (low.includes('final') && !low.includes('semi') && !low.includes('quarter')) return 'Final';
    if (low.includes('semi'))    return 'Semi-Final';
    if (low.includes('quarter')) return 'Quarter-Final';
    if (low.includes('group'))   return 'Group Stage';
    return r;
  };

  const ROUND_DEPTH_SCORE = { 'Final': 7, 'Semi-Final': 6, 'Quarter-Final': 5, 'Round of 16': 4, 'Round of 32': 3, 'Round of 64': 2, 'Round of 128': 1, 'Group Stage': 1 };
  const DEPTH_LABEL       = { 7: 'Final', 6: 'SF', 5: 'QF', 4: 'R/16', 3: 'R/32', 2: 'R/64', 1: 'Group Stage' };
  const SFQF_SET  = new Set(['Semi-Final', 'Quarter-Final']);
  const EARLY_SET = new Set(['Round of 16', 'Round of 32', 'Round of 64', 'Round of 128', 'Group Stage']);

  const normRound      = m => normaliseRound(m.round);
  const finalsMatches   = filtered.filter(m => normRound(m) === 'Final');
  const knockoutMatches = filtered.filter(m => SFQF_SET.has(normRound(m)));
  const groupMatches    = filtered.filter(m => { const nr = normRound(m); return nr && EARLY_SET.has(nr); });

  const finalsWinRate   = finalsMatches.length   > 0 ? (finalsMatches.filter(m => m.result === 'W').length   / finalsMatches.length)   * 100 : null;
  const knockoutWinRate = knockoutMatches.length  > 0 ? (knockoutMatches.filter(m => m.result === 'W').length / knockoutMatches.length)  * 100 : null;
  const groupWinRate    = groupMatches.length     > 0 ? (groupMatches.filter(m => m.result === 'W').length    / groupMatches.length)     * 100 : null;

  const tournamentDepths = {};
  const tournamentGrade  = {};
  for (const m of filtered) {
    const depth = ROUND_DEPTH_SCORE[normRound(m)];
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

  // Group by opponent identity, falling back to the name only where a ledger carries no
  // id. Keyed on the name alone, every opponent the profile table could not name landed
  // in one bucket called "Unknown": Syndrela Das's U17 page showed six different players
  // as a single 4W/3L opponent, and that phantom had enough matches to take the top slot
  // from a real one.
  const cmap = {};
  for (const m of filtered) {
    const key = m.opponentKey != null ? `id:${m.opponentKey}` : `name:${m.opponent}`;
    if (!cmap[key]) cmap[key] = { name: m.opponent, wins: 0, losses: 0, currentRank: m.opponentCurrentRank, matches: [] };
    if (m.result === 'W') cmap[key].wins++; else cmap[key].losses++;
    cmap[key].matches.push(m);
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

  return {
    winRate, upsetYield, clutchIndex, avgPtDiff, rankChange,
    matchCount: total, wins: wins.length, losses: losses.length,
    straightSetsWins, straightSetsLosses, comebackWins, avgOppRankBeaten,
    rankBuckets, tierBuckets, topCompetitors, topNations,
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
