// ─── Youth singles data adapter for the OKR dashboard ────────────────────────
// Entity = a youth player within one age category (U11-U19), ranked by
// age_cat_rank. Ranks used are age-category ranks; matches are that band's
// draws. Produces the same `playerMetrics` shape the singles path builds.

import {
  parseScoresForPlayer, parseGame1Won, countDeuceGames, checkComeback,
  computeWindowData,
} from './playerMetrics.js';

const GLABEL = { MS: 'Boys Singles', WS: 'Girls Singles' };

// ── Player list for one age category (search entities) ───────────────────────
export async function loadYouthSinglesPlayers(supabase, ageCategory) {
  const { data: latestRow } = await supabase
    .from('youth_rankings_singles')
    .select('ranking_year,ranking_week')
    .eq('age_category', ageCategory)
    .in('sub_event', ['MS', 'WS'])
    .order('ranking_year', { ascending: false })
    .order('ranking_week', { ascending: false })
    .limit(1);
  const latest = latestRow?.[0];
  if (!latest) return [];

  const { data: rows } = await supabase
    .from('youth_rankings_singles')
    .select('ittf_id,player_name,country_code,sub_event,age_cat_rank')
    .eq('age_category', ageCategory)
    .in('sub_event', ['MS', 'WS'])
    .eq('ranking_year', latest.ranking_year)
    .eq('ranking_week', latest.ranking_week)
    .order('age_cat_rank', { ascending: true })
    .limit(3000);

  return (rows || [])
    .filter(r => r.age_cat_rank != null)
    .map(r => ({
      player_id:    String(r.ittf_id),
      player_name:  r.player_name,
      rank:         Number(r.age_cat_rank),
      gender:       r.sub_event === 'WS' ? 'W' : 'M',
      gender_label: GLABEL[r.sub_event] || r.sub_event,
      subEvent:     r.sub_event,
      country_code: r.country_code || '',
      dob: null, handedness: '', grip: '',
      isYouth: true, ageCategory,
    }));
}

// ── One youth player's metrics within an age category ────────────────────────
export async function loadYouthSinglesPlayerMetrics(supabase, player, ageCategory) {
  const pidStr = String(player.player_id);
  const pidNum = parseInt(pidStr);
  const sub    = player.subEvent;

  const [{ data: matches }, { data: rankRows }, { data: events }] = await Promise.all([
    supabase.from('wtt_matches_singles')
      .select('match_id,comp1_id,comp2_id,result,event_date,event_id,round_phase,game_scores,event_category,age_group')
      .or(`comp1_id.eq.${pidStr},comp2_id.eq.${pidStr}`)
      .eq('age_group', ageCategory)
      .order('event_date', { ascending: false }).limit(600),
    supabase.from('youth_rankings_singles')
      .select('age_cat_rank,publish_date,points_ytd')
      .eq('ittf_id', pidStr).eq('age_category', ageCategory).eq('sub_event', sub)
      .order('publish_date', { ascending: false }).limit(400),
    supabase.from('wtt_events_graded').select('event_id,event_name,event_tier,tops_grade'),
  ]);

  const rankingHistory = (rankRows || [])
    .filter(r => r.age_cat_rank != null)
    .map(r => ({ ranking_date: r.publish_date, rank: r.age_cat_rank, points: r.points_ytd }));
  const currentRank = rankingHistory[0]?.rank || player.rank || 999;

  const oppIds = [...new Set((matches || []).map(m =>
    parseInt(m.comp1_id) === pidNum ? parseInt(m.comp2_id) : parseInt(m.comp1_id)
  ))];
  const oppIdStrs = oppIds.map(String);

  // Opponent profiles (names, country, style).
  const oppProfiles = {};
  for (let i = 0; i < oppIds.length; i += 400) {
    const { data } = await supabase.from('wtt_players')
      .select('ittf_id,player_name,country_code,dob,handedness,grip')
      .in('ittf_id', oppIds.slice(i, i + 400));
    for (const p of (data || [])) oppProfiles[parseInt(p.ittf_id)] = p;
  }

  // Opponent age-category rank history (same band).
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 20);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const oppRankMap = {};
  for (let i = 0; i < oppIdStrs.length; i += 250) {
    const { data } = await supabase.from('youth_rankings_singles')
      .select('ittf_id,age_cat_rank,publish_date')
      .in('ittf_id', oppIdStrs.slice(i, i + 250))
      .eq('age_category', ageCategory)
      .gte('publish_date', cutoffStr)
      .limit(20000);
    for (const r of (data || [])) {
      if (r.age_cat_rank == null) continue;
      const key = parseInt(r.ittf_id);
      if (!oppRankMap[key]) oppRankMap[key] = [];
      oppRankMap[key].push({ ranking_date: r.publish_date, rank: r.age_cat_rank });
    }
  }
  for (const k in oppRankMap) {
    oppRankMap[k].sort((x, y) => new Date(y.ranking_date) - new Date(x.ranking_date));
  }

  const ledger = (matches || []).map(m => {
    const isComp1 = parseInt(m.comp1_id) === pidNum;
    const won     = isComp1 ? m.result === 'W' : m.result === 'L';
    const oppId   = parseInt(isComp1 ? m.comp2_id : m.comp1_id);
    const oppP    = oppProfiles[oppId];
    const oppH    = oppRankMap[oppId] || [];
    const matchDate = new Date(m.event_date);
    const opponentRank        = oppH.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? 999;
    const opponentCurrentRank = oppH[0]?.rank ?? 999;
    const playerRankAtMatch   = rankingHistory.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? currentRank;
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

  return {
    ranking: currentRank,
    rankingHistory,
    wttLedger:   ledger,
    domLedger:   [],
    bothLedger:  ledger,
    wttWindows:  makeWindows(ledger),
    domWindows:  emptyWindows,
    bothWindows: makeWindows(ledger),
  };
}
