// ─── Youth doubles data adapter for the OKR dashboard ────────────────────────
// Entity = a youth pair ranked in an age category (U11-U19) via
// youth_rankings_doubles. WTT/ITTF youth doubles are drawn only at U15 & U19,
// so U11/U13/U17 are eligibility ranking categories: the rank TREND comes from
// the age-category list, while match DNA is the pair's real doubles matches
// across whatever draws they entered (U15 / U19 / senior).

import {
  parseScoresForPlayer, parseGame1Won, countDeuceGames, checkComeback,
  computeWindowData,
} from './playerMetrics.js';

const GLABEL = { MD: 'Boys Doubles', WD: 'Girls Doubles', XD: 'Mixed Doubles' };

function pairKey(a, b) {
  const x = Number(a), y = Number(b);
  return x < y ? `${x}_${y}` : `${y}_${x}`;
}

// ── Pair list for one age category (search entities) ─────────────────────────
export async function loadYouthDoublesPairs(supabase, ageCategory) {
  const { data: latestRow } = await supabase
    .from('youth_rankings_doubles')
    .select('ranking_year,ranking_week')
    .eq('age_category', ageCategory)
    .in('sub_event', ['MD', 'WD', 'XD'])
    .order('ranking_year', { ascending: false })
    .order('ranking_week', { ascending: false })
    .limit(1);
  const latest = latestRow?.[0];
  if (!latest) return [];

  const { data: rows } = await supabase
    .from('youth_rankings_doubles')
    .select('pair_id,ittf_id1,player_name1,ittf_id2,player_name2,country_code1,country_code2,sub_event,age_cat_rank')
    .eq('age_category', ageCategory)
    .in('sub_event', ['MD', 'WD', 'XD'])
    .eq('ranking_year', latest.ranking_year)
    .eq('ranking_week', latest.ranking_week)
    .order('age_cat_rank', { ascending: true })
    .limit(3000);

  return (rows || [])
    .filter(r => r.age_cat_rank != null)
    .map(r => ({
      player_id:    String(r.pair_id),
      pair_id:      String(r.pair_id),
      p1:           Number(r.ittf_id1),
      p2:           Number(r.ittf_id2),
      player_name:  `${r.player_name1} / ${r.player_name2}`,
      rank:         Number(r.age_cat_rank),
      gender:       r.sub_event === 'WD' ? 'W' : r.sub_event === 'XD' ? 'X' : 'M',
      gender_label: GLABEL[r.sub_event] || r.sub_event,
      discipline:   r.sub_event,
      subEvent:     r.sub_event,
      // Both partners are carried through: a pair's nationality cannot be read off
      // player 1 alone, since WTT lists pairs in its own order and an Indian player
      // is often the second name. Consumers checking "is this Indian?" need both.
      country_code:  r.country_code1 || '',
      country_code1: r.country_code1 || '',
      country_code2: r.country_code2 || '',
      dob: null, handedness: '', grip: '',
      isYouth: true, isPair: true, ageCategory,
    }));
}

// ── One youth pair's metrics ─────────────────────────────────────────────────
export async function loadYouthDoublesPairMetrics(supabase, pair, ageCategory) {
  const a = Number(pair.p1), b = Number(pair.p2);
  const orClause = [
    `and(comp1_p1_id.eq.${a},comp1_p2_id.eq.${b})`,
    `and(comp1_p1_id.eq.${b},comp1_p2_id.eq.${a})`,
    `and(comp2_p1_id.eq.${a},comp2_p2_id.eq.${b})`,
    `and(comp2_p1_id.eq.${b},comp2_p2_id.eq.${a})`,
  ].join(',');

  const [{ data: matches }, { data: rankRows }, { data: events }] = await Promise.all([
    // The pair's real doubles matches across ALL draws (not restricted by age band).
    supabase.from('wtt_matches_doubles')
      .select('match_id,event_id,comp1_p1_id,comp1_p2_id,comp2_p1_id,comp2_p2_id,match_score,game_scores,result,event_date,round_phase,event_category,age_group')
      .or(orClause)
      .order('event_date', { ascending: false }).limit(600),
    // Rank TREND = age-category ranking list for this pair.
    supabase.from('youth_rankings_doubles')
      .select('age_cat_rank,publish_date,points')
      .eq('pair_id', pair.pair_id).eq('age_category', ageCategory).eq('sub_event', pair.subEvent)
      .order('publish_date', { ascending: false }).limit(400),
    supabase.from('wtt_events_graded').select('event_id,event_name,event_tier,tops_grade'),
  ]);

  const rankingHistory = (rankRows || [])
    .filter(r => r.age_cat_rank != null)
    .map(r => ({ ranking_date: r.publish_date, rank: r.age_cat_rank, points: r.points }));
  const currentRank = rankingHistory[0]?.rank || pair.rank || 999;

  // Resolve opponent pair per match.
  const oppIds = new Set();
  for (const m of (matches || [])) {
    const onSide1 = (m.comp1_p1_id === a || m.comp1_p1_id === b) &&
                    (m.comp1_p2_id === a || m.comp1_p2_id === b);
    m.__onSide1 = onSide1;
    m.__o1 = onSide1 ? m.comp2_p1_id : m.comp1_p1_id;
    m.__o2 = onSide1 ? m.comp2_p2_id : m.comp1_p2_id;
    if (m.__o1 != null) oppIds.add(Number(m.__o1));
    if (m.__o2 != null) oppIds.add(Number(m.__o2));
  }
  const oppIdArr = [...oppIds];
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 24);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Opponent youth pair ranks (same age category) — preferred.
  const youthMap = {};
  for (let i = 0; i < oppIdArr.length; i += 200) {
    const chunk = oppIdArr.slice(i, i + 200).map(String).join(',');
    const { data } = await supabase.from('youth_rankings_doubles')
      .select('ittf_id1,ittf_id2,player_name1,player_name2,age_cat_rank,publish_date')
      .or(`ittf_id1.in.(${chunk}),ittf_id2.in.(${chunk})`)
      .eq('age_category', ageCategory)
      .gte('publish_date', cutoffStr)
      .limit(20000);
    for (const r of (data || [])) {
      if (r.age_cat_rank == null) continue;
      const k = pairKey(r.ittf_id1, r.ittf_id2);
      if (!youthMap[k]) youthMap[k] = { history: [], name: `${r.player_name1} / ${r.player_name2}` };
      youthMap[k].history.push({ ranking_date: r.publish_date, rank: r.age_cat_rank });
    }
  }

  // Opponent senior pair ranks — fallback.
  const seniorMap = {};
  for (let i = 0; i < oppIdArr.length; i += 250) {
    const chunk = oppIdArr.slice(i, i + 250).join(',');
    const { data } = await supabase.from('rankings_doubles_teams')
      .select('p1_ittf_id,p2_ittf_id,team_name,current_rank,publish_date')
      .or(`p1_ittf_id.in.(${chunk}),p2_ittf_id.in.(${chunk})`)
      .gte('publish_date', cutoffStr)
      .limit(20000);
    for (const r of (data || [])) {
      const k = pairKey(r.p1_ittf_id, r.p2_ittf_id);
      if (!seniorMap[k]) seniorMap[k] = { history: [], name: r.team_name };
      seniorMap[k].history.push({ ranking_date: r.publish_date, rank: r.current_rank });
    }
  }
  for (const k in youthMap)  youthMap[k].history.sort((x, y) => new Date(y.ranking_date) - new Date(x.ranking_date));
  for (const k in seniorMap) seniorMap[k].history.sort((x, y) => new Date(y.ranking_date) - new Date(x.ranking_date));

  // Opponent player names / country (final fallback + country tag).
  const playerMap = {};
  for (let i = 0; i < oppIdArr.length; i += 400) {
    const { data } = await supabase.from('wtt_players')
      .select('ittf_id,player_name,country_code')
      .in('ittf_id', oppIdArr.slice(i, i + 400));
    for (const p of (data || [])) playerMap[p.ittf_id] = p;
  }

  const ledger = (matches || []).map(m => {
    const isComp1  = m.__onSide1;
    const won      = isComp1 ? m.result === 'W' : m.result === 'L';
    const matchDate = new Date(m.event_date);
    const k        = pairKey(m.__o1, m.__o2);
    const yInfo = youthMap[k], sInfo = seniorMap[k];
    const opponentRank =
      yInfo?.history.find(r => new Date(r.ranking_date) <= matchDate)?.rank ??
      sInfo?.history.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? 999;
    const opponentCurrentRank = yInfo?.history[0]?.rank ?? sInfo?.history[0]?.rank ?? 999;
    const playerRankAtMatch   = rankingHistory.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? currentRank;
    const { gamesWon, gamesLost, pointsWon, pointsLost, totalGames } =
      parseScoresForPlayer(m.game_scores, isComp1);
    const pointDiff = totalGames > 0 ? (pointsWon - pointsLost) / totalGames : null;
    const eventInfo = events?.find(e => e.event_id === m.event_id);
    const oppName = yInfo?.name || sInfo?.name
      || [playerMap[m.__o1]?.player_name, playerMap[m.__o2]?.player_name].filter(Boolean).join(' / ')
      || 'Unknown';
    return {
      rawDate: matchDate,
      opponent: oppName,
      opponentCountry: playerMap[m.__o1]?.country_code || null,
      opponentDob: null, opponentHandedness: null, opponentGrip: null,
      opponentRank, opponentCurrentRank, playerRankAtMatch,
      tournament: eventInfo?.event_name || m.event_category || 'Youth event',
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
