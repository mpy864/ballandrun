import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession]                 = useState(undefined) // undefined = loading
  const [profile, setProfile]                 = useState(null)
  const [competitorPicks, setCompetitorPicks] = useState([]) // { athlete_ittf_id, competitor_ittf_id, valid_until }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
      else {
        setProfile(null)
        setCompetitorPicks([])
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    // maybeSingle, not single: the profile row is written by an auth trigger, and for the
    // first moments after a signup it may not exist yet. single() treats zero rows as an
    // error, which left profile null forever and the app stuck on a spinner.
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    // No row means not yet approved — never means unrestricted.
    setProfile(data || { id: userId, role: 'pending' })
    if (data?.role === 'coach' && data?.club_id) {
      fetchCompetitorPicks(data.club_id)
    }
  }

  async function fetchCompetitorPicks(clubId) {
    const { data } = await supabase
      .from('competitor_picks')
      .select('athlete_ittf_id,competitor_ittf_id,valid_until')
      .eq('club_id', clubId)
    setCompetitorPicks(data || [])
  }

  async function signInWithEmail(email) {
    return supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  // Club coach picks/changes competitor for one of their athletes (once per billing cycle)
  async function setCompetitorPick(athleteIttfId, competitorIttfId) {
    if (!profile?.club_id) return { error: 'No club associated with this account' }

    // Expire at end of current month → pick resets on the 1st of next month
    const validUntil = new Date()
    validUntil.setMonth(validUntil.getMonth() + 1, 0) // day 0 of next month = last day of this month
    const validUntilStr = validUntil.toISOString().split('T')[0]

    const { data, error } = await supabase
      .from('competitor_picks')
      .upsert({
        club_id:             profile.club_id,
        athlete_ittf_id:     String(athleteIttfId),
        competitor_ittf_id:  String(competitorIttfId),
        valid_until:         validUntilStr,
        updated_at:          new Date().toISOString(),
      }, { onConflict: 'club_id,athlete_ittf_id' })

    if (!error) {
      setCompetitorPicks(prev => {
        const rest = prev.filter(p => p.athlete_ittf_id !== String(athleteIttfId))
        return [...rest, {
          athlete_ittf_id:    String(athleteIttfId),
          competitor_ittf_id: String(competitorIttfId),
          valid_until:        validUntilStr,
        }]
      })
    }
    return { data, error }
  }

  // assigned_player_ids from user_profiles is the club's athlete list (array of ittf_ids)
  const clubAthletes = (profile?.assigned_player_ids || []).map(String)

  // All ittf_ids a coach (Tier 1) is allowed to see: their athletes + picked competitors
  // null = no restriction (org / admin sees everything)
  // useMemo ensures stable reference — only changes when content actually changes
  const allowedIttfIds = useMemo(() =>
    profile?.role === 'coach'
      ? [...new Set([
          ...clubAthletes,
          ...competitorPicks.map(p => p.competitor_ittf_id),
        ])]
      : null
  , [profile?.role, clubAthletes, competitorPicks])

  const value = {
    session,
    profile,
    // Two different waits. `loading` is "do we know whether anyone is signed in";
    // `profileLoading` is "we know who, but not yet what they are allowed to see".
    // Collapsing them would flash the waiting-room screen at an approved user on every
    // page load, in the gap before their profile arrives.
    loading:          session === undefined,
    profileLoading:   !!session && profile === null,
    isPending:        profile?.role === 'pending',
    isAdmin:          profile?.role === 'admin',
    isOrg:            profile?.role === 'org',
    isCoach:          profile?.role === 'coach',
    clubAthletes,
    competitorPicks,
    allowedIttfIds,   // null = unrestricted; string[] = coach-scoped
    setCompetitorPick,
    signInWithEmail,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
