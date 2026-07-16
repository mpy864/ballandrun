// ─── Senior doubles data adapter for the OKR dashboard ───────────────────────
// Produces the same `playerMetrics` shape the singles path builds, so the
// existing render (Rank / Win-Loss / Performance / Form tabs) works unchanged.
// Entity = a ranked pair (rankings_doubles_teams). Ranks used throughout are
// PAIR ranks; opponents are opposing pairs.

import {
  parseScoresForPlayer, parseGame1Won, countDeuceGames, checkComeback,
  computeWindowData,
} from './playerMetrics.js';

const GENDER_LABEL = { M: "Men's Doubles", W: "Women's Doubles", X: 'Mixed Doubles' };

function pairKey(a, b) {
  const x = Number(a), y = Number(b);
  return x < y ? `${x}_${y}` : `${y}_${x}`;
}

function cleanCat(c) {
  if (!c) return null;
  return c.replace(/\s+presented\s+by\s+.*/i, '').trim();
}

// ── Pair list (search entities) ──────────────────────────────────────────────
// Normalised to match the singles `players` entry shape so the render reuses it.
export async function loadDoublesPairs(supabase) {
  const { data: latest } = await supabase
    .from('rankings_doubles_teams')
    .select('publish_date')
    .order('publish_date', { ascending: false })
    .limit(1);
  const latestDate = latest?.[0]?.publish_date;
  if (!latestDate) return [];

  const { data: rows } = await supabase
    .from('rankings_doubles_teams')
    .select('pair_id,p1_ittf_id,p2_ittf_id,team_name,category,gender,current_rank,points')
    .eq('publish_date', latestDate)
    .order('current_rank', { ascending: true })
    .limit(2000);

  // Only the first player of each pair drives the country tag, so fetch just those.
  const ids = [...new Set((rows || []).map(r => r.p1_ittf_id))];
  const country = {};
  const chunks = [];
  for (let i = 0; i < ids.length; i += 400) {
    chunks.push(supabase.from('wtt_players').select('ittf_id,country_code').in('ittf_id', ids.slice(i, i + 400)));
  }
  for (const r of await Promise.all(chunks)) for (const p of (r.data || [])) country[p.ittf_id] = p.country_code;

  return (rows || []).map(r => ({
    player_id:    String(r.pair_id),
    pair_id:      String(r.pair_id),
    p1:           r.p1_ittf_id,
    p2:           r.p2_ittf_id,
    player_name:  r.team_name || 'Unknown pair',
    rank:         Number(r.current_rank),
    gender:       r.gender,                       // M | W | X
    gender_label: GENDER_LABEL[r.gender] || r.category,
    discipline:   r.category,                     // MD | WD | XD
    country_code: country[r.p1_ittf_id] || '',
    dob: null, handedness: '', grip: '',
    isPair: true,
  }));
}

// ── One pair's metrics (same shape as singles buildMetrics, minus domestic) ───
export async function loadDoublesPairMetrics(supabase, pair) {
  const a = Number(pair.p1), b = Number(pair.p2);
  const orClause = [
    `and(comp1_p1_id.eq.${a},comp1_p2_id.eq.${b})`,
    `and(comp1_p1_id.eq.${b},comp1_p2_id.eq.${a})`,
    `and(comp2_p1_id.eq.${a},comp2_p2_id.eq.${b})`,
    `and(comp2_p1_id.eq.${b},comp2_p2_id.eq.${a})`,
  ].join(',');

  const [{ data: rawMatches }, { data: rankRows }, { data: events }] = await Promise.all([
    supabase.from('wtt_matches_doubles')
      .select('match_id,event_id,comp1_p1_id,comp1_p2_id,comp2_p1_id,comp2_p2_id,match_score,game_scores,result,event_date,round_phase,event_category,age_group')
      .or(orClause)
      .order('event_date', { ascending: false }).limit(600),
    supabase.from('rankings_doubles_teams')
      .select('current_rank,publish_date,points')
      .eq('pair_id', pair.pair_id)
      .order('publish_date', { ascending: false }).limit(400),
    supabase.from('wtt_events_graded').select('event_id,event_name,event_tier,tops_grade'),
  ]);

  // Senior segment = non-youth draws only.
  const matches = (rawMatches || []).filter(m => !m.age_group);

  const rankingHistory = (rankRows || [])
    .map(r => ({ ranking_date: r.publish_date, rank: r.current_rank, points: r.points }));
  const currentRank = rankingHistory[0]?.rank || pair.rank || 999;

  // Resolve opponent pair for each match.
  const oppIds = new Set();
  for (const m of matches) {
    const onSide1 = (m.comp1_p1_id === a || m.comp1_p1_id === b) &&
                    (m.comp1_p2_id === a || m.comp1_p2_id === b);
    m.__onSide1 = onSide1;
    m.__o1 = onSide1 ? m.comp2_p1_id : m.comp1_p1_id;
    m.__o2 = onSide1 ? m.comp2_p2_id : m.comp1_p2_id;
    if (m.__o1 != null) oppIds.add(Number(m.__o1));
    if (m.__o2 != null) oppIds.add(Number(m.__o2));
  }
  const oppIdArr = [...oppIds];

  // Opponent pair rank history — ONLY the exact opposing pairs (not every pair
  // that contains an opponent player), keyed by sorted id-pair.
  const oppPairMap = {};
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 20);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const oppPairList = [];
  { const seen = new Set();
    for (const m of matches) {
      if (m.__o1 == null || m.__o2 == null) continue;
      const k = pairKey(m.__o1, m.__o2);
      if (!seen.has(k)) { seen.add(k); oppPairList.push([Number(m.__o1), Number(m.__o2)]); }
    } }
  const rankChunks = [];
  for (let i = 0; i < oppPairList.length; i += 50) {
    const orClause = oppPairList.slice(i, i + 50).map(([x, y]) =>
      `and(p1_ittf_id.eq.${x},p2_ittf_id.eq.${y}),and(p1_ittf_id.eq.${y},p2_ittf_id.eq.${x})`).join(',');
    rankChunks.push(supabase.from('rankings_doubles_teams')
      .select('p1_ittf_id,p2_ittf_id,team_name,current_rank,publish_date')
      .or(orClause).gte('publish_date', cutoffStr));
  }
  const nameChunks = [];
  for (let i = 0; i < oppIdArr.length; i += 400) {
    nameChunks.push(supabase.from('wtt_players')
      .select('ittf_id,player_name,country_code').in('ittf_id', oppIdArr.slice(i, i + 400)));
  }
  const [rankRes, nameRes] = await Promise.all([Promise.all(rankChunks), Promise.all(nameChunks)]);

  for (const r of rankRes) for (const row of (r.data || [])) {
    const k = pairKey(row.p1_ittf_id, row.p2_ittf_id);
    if (!oppPairMap[k]) oppPairMap[k] = { history: [], team_name: row.team_name };
    oppPairMap[k].history.push({ ranking_date: row.publish_date, rank: row.current_rank });
  }
  for (const k in oppPairMap) {
    oppPairMap[k].history.sort((x, y) => new Date(y.ranking_date) - new Date(x.ranking_date));
  }

  const playerMap = {};
  for (const r of nameRes) for (const p of (r.data || [])) playerMap[p.ittf_id] = p;

  const ledger = matches.map(m => {
    const isComp1  = m.__onSide1;
    const won      = isComp1 ? m.result === 'W' : m.result === 'L';
    const matchDate = new Date(m.event_date);
    const oppInfo  = oppPairMap[pairKey(m.__o1, m.__o2)];
    const opponentRank        = oppInfo?.history.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? 999;
    const opponentCurrentRank = oppInfo?.history[0]?.rank ?? 999;
    const playerRankAtMatch   = rankingHistory.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? currentRank;
    const { gamesWon, gamesLost, pointsWon, pointsLost, totalGames } =
      parseScoresForPlayer(m.game_scores, isComp1);
    const pointDiff = totalGames > 0 ? (pointsWon - pointsLost) / totalGames : null;
    const eventInfo = events?.find(e => e.event_id === m.event_id);
    const oppName = oppInfo?.team_name
      || [playerMap[m.__o1]?.player_name, playerMap[m.__o2]?.player_name].filter(Boolean).join(' / ')
      || 'Unknown';
    return {
      rawDate: matchDate,
      opponent: oppName,
      opponentCountry: playerMap[m.__o1]?.country_code || null,
      opponentDob: null, opponentHandedness: null, opponentGrip: null,
      opponentRank, opponentCurrentRank, playerRankAtMatch,
      tournament: eventInfo?.event_name || cleanCat(m.event_category) || 'Unknown',
      tournamentKey: String(m.event_id),
      eventTier:    eventInfo?.tops_grade ?? null,
      eventTierStr: eventInfo?.event_tier ?? null,
      round: m.round_phase || 'N/A',
      score: m.game_scores || 'N/A',
      result: won ? 'W' : 'L',
      isComp1,
      isUpset:        won && opponentRank < playerRankAtMatch,
      isClutch:       won && gamesLost === gamesWon - 1,
      isStraightWin:  won && gamesLost === 0 && totalGames >= 3,
      isStraightLoss: !won && gamesWon === 0 && totalGames >= 3,
      isComeback:     checkComeback(m.game_scores, isComp1, won),
      gamesWon, gamesLost, totalGames, pointsWon, pointDiff,
      wonGame1:   parseGame1Won(m.game_scores, isComp1),
      deuceGames: countDeuceGames(m.game_scores, isComp1),
      isDomestic: false,
    };
  }).sort((x, y) => y.rawDate - x.rawDate);

  const makeWindows = (l) => ({
    '6M':  computeWindowData(l, rankingHistory, 6,  currentRank),
    '12M': computeWindowData(l, rankingHistory, 12, currentRank),
    '18M': computeWindowData(l, rankingHistory, 18, currentRank),
  });
  const emptyWindows = makeWindows([]);

  const partnership = {
    matches: ledger.length,
    first: ledger.length ? ledger[ledger.length - 1].rawDate : null,
    last:  ledger.length ? ledger[0].rawDate : null,
  };

  return {
    ranking: currentRank,
    rankingHistory,
    wttLedger:   ledger,
    domLedger:   [],
    bothLedger:  ledger,
    wttWindows:  makeWindows(ledger),
    domWindows:  emptyWindows,
    bothWindows: makeWindows(ledger),
    partnership,
  };
}

// ── Batched roster ledgers (Squad readiness) ─────────────────────────────────
// Reproduces loadDoublesPairMetrics's ledger for MANY roster pairs in a few
// batched, parallel queries (vs one heavy call per pair). Returns a light ledger
// (only the fields readiness/achievements need). Numbers are identical.
//   pairs: [{ a, b }]  → { [minId_maxId]: { ranking, history, ledger } }
export async function loadRosterDoublesLedgers(supabase, pairs) {
  const pairIds = [...new Set(pairs.flatMap(p => [Number(p.a), Number(p.b)]))];
  if (!pairIds.length) return {};
  const idCsv = pairIds.join(',');

  // Q1: all senior doubles matches involving any roster doubles player.
  const { data: rawMatches } = await supabase.from('wtt_matches_doubles')
    .select('event_id,comp1_p1_id,comp1_p2_id,comp2_p1_id,comp2_p2_id,result,event_date,round_phase,event_category,age_group')
    .or(`comp1_p1_id.in.(${idCsv}),comp1_p2_id.in.(${idCsv}),comp2_p1_id.in.(${idCsv}),comp2_p2_id.in.(${idCsv})`)
    .order('event_date', { ascending: false }).limit(2000);
  const matches = (rawMatches || []).filter(m => !m.age_group);  // senior only

  // Assign matches to their exact pair; collect opponent ids.
  const perPair = {};
  for (const p of pairs) perPair[pairKey(p.a, p.b)] = [];
  const oppIds = new Set();
  for (const m of matches) {
    for (const p of pairs) {
      const a = Number(p.a), b = Number(p.b);
      const s1 = (m.comp1_p1_id === a || m.comp1_p1_id === b) && (m.comp1_p2_id === a || m.comp1_p2_id === b);
      const s2 = (m.comp2_p1_id === a || m.comp2_p1_id === b) && (m.comp2_p2_id === a || m.comp2_p2_id === b);
      if (!s1 && !s2) continue;
      const o1 = s1 ? m.comp2_p1_id : m.comp1_p1_id;
      const o2 = s1 ? m.comp2_p2_id : m.comp1_p2_id;
      perPair[pairKey(a, b)].push({ ...m, __onSide1: s1, __o1: o1, __o2: o2 });
      if (o1 != null) oppIds.add(Number(o1));
      if (o2 != null) oppIds.add(Number(o2));
    }
  }

  const evIds = [...new Set(matches.map(m => m.event_id))];
  const cut400 = (() => { const d = new Date(); d.setDate(d.getDate() - 400); return d.toISOString().slice(0, 10); })();

  // Parallel: roster pairs' OWN rank history (small, reliable — roster ids only),
  // the latest ranking week, and event grades.
  const [rosterHistRes, latestRes, evMap] = await Promise.all([
    supabase.from('rankings_doubles_teams')
      .select('p1_ittf_id,p2_ittf_id,current_rank,publish_date')
      .or(`p1_ittf_id.in.(${idCsv}),p2_ittf_id.in.(${idCsv})`)
      .gte('publish_date', cut400).order('publish_date', { ascending: false }),
    supabase.from('rankings_doubles_teams').select('publish_date').order('publish_date', { ascending: false }).limit(1),
    (async () => {
      const map = {};
      for (let i = 0; i < evIds.length; i += 400) {
        const { data } = await supabase.from('wtt_events_graded')
          .select('event_id,event_name,tops_grade').in('event_id', evIds.slice(i, i + 400));
        for (const e of data || []) map[String(e.event_id)] = { name: e.event_name, tier: e.tops_grade };
      }
      return map;
    })(),
  ]);
  const latestWeek = latestRes.data?.[0]?.publish_date;

  // Opponent CURRENT pair rank (latest week only — small). Consistent with the
  // singles Squad cards, which also score scalps vs opponents' current rank.
  const oppCurrent = {};
  const oppArr = [...oppIds];
  if (latestWeek && oppArr.length) {
    const chunks = [];
    for (let i = 0; i < oppArr.length; i += 300) {
      const chunk = oppArr.slice(i, i + 300).join(',');
      chunks.push(supabase.from('rankings_doubles_teams')
        .select('p1_ittf_id,p2_ittf_id,team_name,current_rank')
        .or(`p1_ittf_id.in.(${chunk}),p2_ittf_id.in.(${chunk})`)
        .eq('publish_date', latestWeek));
    }
    for (const r of await Promise.all(chunks)) for (const row of (r.data || [])) {
      oppCurrent[pairKey(row.p1_ittf_id, row.p2_ittf_id)] = { rank: row.current_rank, name: row.team_name };
    }
  }

  // Roster pair histories keyed by sorted id-pair (exact pair only).
  const rosterHist = {};
  for (const row of (rosterHistRes.data || [])) {
    const k = pairKey(row.p1_ittf_id, row.p2_ittf_id);
    (rosterHist[k] || (rosterHist[k] = [])).push({ ranking_date: row.publish_date, rank: row.current_rank });
  }
  for (const k in rosterHist) rosterHist[k].sort((x, y) => new Date(y.ranking_date) - new Date(x.ranking_date));

  const out = {};
  for (const p of pairs) {
    const k = pairKey(p.a, p.b);
    const hist = rosterHist[k] || [];
    const ledger = (perPair[k] || []).map(m => {
      const isComp1 = m.__onSide1;
      const won = isComp1 ? m.result === 'W' : m.result === 'L';
      const oInfo = oppCurrent[pairKey(m.__o1, m.__o2)];
      const ev = evMap[String(m.event_id)];
      return {
        rawDate: new Date(m.event_date),
        result: won ? 'W' : 'L',
        opponentRank: oInfo?.rank ?? 999,
        opponent: oInfo?.name || 'Unknown',
        tournamentKey: String(m.event_id),
        tournament: ev?.name || cleanCat(m.event_category) || 'Unknown',
        eventTier: ev?.tier ?? null,
        round: m.round_phase || 'N/A',
      };
    }).sort((x, y) => y.rawDate - x.rawDate);
    out[k] = { ranking: hist[0]?.rank ?? null, history: hist, ledger };
  }
  return out;
}
