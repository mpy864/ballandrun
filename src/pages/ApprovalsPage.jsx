import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { card, chip, T, formError } from '../lib/ui.js'

// ─── Approvals — admin only ──────────────────────────────────────────────────
//
// Signing up is open; being let in is not. Every new account lands as 'pending' and sees
// nothing until someone here changes that. Without this screen the only way to approve
// anyone would be to open the Supabase dashboard and edit a row by hand, which is not a
// thing to ask of whoever is on duty.
//
// The list is driven by the same RLS the rest of the app uses: admin_profile_select lets
// an admin read every row, and everyone else reads only their own — so a non-admin who
// reaches this URL sees an empty table rather than a leak.

const ROLES = ['pending', 'athlete', 'coach', 'org', 'admin']

const TONE = {
  pending: '#b45309', athlete: '#3b82f6', coach: '#8b5cf6',
  org: '#0f766e', admin: '#be123c',
}

export default function ApprovalsPage() {
  const { isAdmin, session } = useAuth()
  const [rows, setRows]     = useState(null)
  const [saving, setSaving] = useState(null)
  const [error, setError]   = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, role, created_at')
      .order('created_at', { ascending: false })
    if (error) { setError(error.message); setRows([]); return }
    setRows(data || [])
  }, [])

  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])

  async function setRole(id, role) {
    setSaving(id); setError(null)
    const { error } = await supabase.from('user_profiles').update({ role }).eq('id', id)
    setSaving(null)
    if (error) return setError(error.message)
    setRows(rs => rs.map(r => (r.id === id ? { ...r, role } : r)))
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: '28px 0' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.ink, margin: 0 }}>Approvals</h1>
        <p style={{ fontSize: 13, color: T.muted, marginTop: 8 }}>
          This page is for administrators.
        </p>
      </div>
    )
  }

  const pending = (rows || []).filter(r => r.role === 'pending')

  return (
    <div style={{ padding: '28px 0', maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: T.ink, margin: '0 0 4px' }}>Approvals</h1>
      <p style={{ fontSize: 13, color: T.muted, margin: '0 0 20px' }}>
        {rows === null ? 'Loading…'
          : pending.length ? `${pending.length} account${pending.length === 1 ? '' : 's'} waiting`
          : 'Nobody is waiting.'}
      </p>

      {error && <p style={formError}>{error}</p>}

      <div style={{ ...card, overflow: 'hidden' }}>
        {(rows || []).map((r, i) => (
          <div key={r.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '12px 18px',
            borderTop: i ? `1px solid ${T.divider}` : 'none',
            // Waiting rows first to the eye, even though the list is newest-first.
            background: r.role === 'pending' ? 'rgba(180,83,9,0.04)' : 'transparent',
          }}>
            <span style={{ minWidth: 0, flex: 1 }}>
              {/* user_profiles has no email — auth.users is not readable from the browser
                  by design. The id is the honest identifier here; the signup date is what
                  makes a row recognisable. */}
              <span style={{ display: 'block', fontSize: 13, color: T.ink, fontWeight: 550 }}>
                {r.id === session?.user?.id ? 'You' : r.id.slice(0, 8)}
              </span>
              <span style={{ fontSize: 11.5, color: T.muted }}>
                joined {new Date(r.created_at).toLocaleDateString('en-GB',
                  { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </span>

            <span style={chip(TONE[r.role] || '#6e6e73', { fontSize: 10 })}>{r.role}</span>

            <select
              value={r.role}
              disabled={saving === r.id || r.id === session?.user?.id}
              onChange={e => setRole(r.id, e.target.value)}
              style={{
                padding: '6px 10px', border: `1px solid ${T.border}`, borderRadius: 6,
                fontSize: 12.5, color: T.ink, background: '#fff',
                cursor: r.id === session?.user?.id ? 'not-allowed' : 'pointer',
              }}>
              {ROLES.map(role => <option key={role} value={role}>{role}</option>)}
            </select>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 11.5, color: T.muted, marginTop: 12 }}>
        You cannot change your own role — that is what stops the last admin removing
        themselves and locking everyone out.
      </p>
    </div>
  )
}
