import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { card, chip, T, primaryBtn, formError } from '../lib/ui.js'

// ─── Approvals — admin only ──────────────────────────────────────────────────
//
// Signing up is open; being let in is not. Every new account lands as 'pending' and sees
// nothing until someone here changes that.
//
// The page has one job — let a waiting person in — and the first version buried it. It
// listed every account in one flat table sorted by signup date, so the single account
// actually needing a decision sat among seven that did not, and the way to act on it was
// to find the right row in a dropdown. Waiting accounts are their own section now, and
// the common decision is one button.
//
// The list is driven by the same RLS the rest of the app uses: admin_profile_select lets
// an admin read every row, and everyone else reads only their own — so a non-admin who
// reaches this URL sees an empty table rather than a leak.

const ROLES = ['pending', 'athlete', 'coach', 'org', 'admin']

const TONE = {
  pending: '#b45309', athlete: '#3b82f6', coach: '#8b5cf6',
  org: '#0f766e', admin: '#be123c',
}

const fmtDate = iso => new Date(iso).toLocaleDateString('en-GB',
  { day: 'numeric', month: 'short', year: 'numeric' })

function RoleSelect({ value, disabled, onChange }) {
  return (
    <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
      style={{
        padding: '6px 10px', border: `1px solid ${T.border}`, borderRadius: T.radiusSm,
        fontSize: 12.5, color: T.ink, background: T.card,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}>
      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
    </select>
  )
}

function Row({ p, isYou, busy, onRole, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '13px 18px', borderTop: `1px solid ${T.divider}`,
    }}>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          display: 'block', fontSize: 13.5, color: T.ink, fontWeight: 550,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {p.email || p.id.slice(0, 8)}
          {isYou && <span style={{ color: T.muted, fontWeight: 400 }}> — you</span>}
        </span>
        <span style={{ fontSize: 11.5, color: T.muted }}>joined {fmtDate(p.created_at)}</span>
      </span>
      {children}
      <RoleSelect value={p.role} disabled={busy || isYou} onChange={r => onRole(p.id, r)} />
    </div>
  )
}

export default function ApprovalsPage() {
  const { isAdmin, session } = useAuth()
  const [rows, setRows]     = useState(null)
  const [saving, setSaving] = useState(null)
  const [error, setError]   = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, email, role, created_at')
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
        <p style={{ fontSize: 13, color: T.muted, marginTop: 8 }}>This page is for administrators.</p>
      </div>
    )
  }

  const waiting = (rows || []).filter(r => r.role === 'pending')
  const active  = (rows || []).filter(r => r.role !== 'pending')

  const section = (title, list, renderExtra) => list.length > 0 && (
    <>
      <p style={{
        margin: '26px 0 8px', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: T.muted,
      }}>
        {title} <span style={{ color: T.border }}>·</span> {list.length}
      </p>
      <div style={{ ...card, overflow: 'hidden' }}>
        {list.map(p => (
          <Row key={p.id} p={p} isYou={p.id === session?.user?.id}
               busy={saving === p.id} onRole={setRole}>
            {renderExtra?.(p)}
          </Row>
        ))}
      </div>
    </>
  )

  return (
    <div style={{ padding: '28px 0', maxWidth: 680 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: T.ink, margin: '0 0 4px' }}>Approvals</h1>
      <p style={{ fontSize: 13, color: T.muted, margin: 0 }}>
        {rows === null ? 'Loading…'
          : waiting.length ? `${waiting.length} account${waiting.length === 1 ? '' : 's'} waiting for a decision`
          : 'Nobody is waiting.'}
      </p>

      {error && <p style={{ ...formError, marginTop: 14 }}>{error}</p>}

      {/* One button for the decision this page exists to make. The dropdown beside it is
          still there for the other four roles, but approving as an athlete is what
          happens almost every time and it should not cost a menu. */}
      {section('Waiting', waiting, p => (
        <button onClick={() => setRole(p.id, 'athlete')} disabled={saving === p.id}
          style={{ ...primaryBtn(saving === p.id), width: 'auto', padding: '7px 16px', fontSize: 13 }}>
          {saving === p.id ? 'Approving…' : 'Approve'}
        </button>
      ))}

      {/* No role chip on these rows. The dropdown already states the role, and a chip
          beside it says the same word twice — colour is the only thing it added. */}
      {section('Approved', active, p => (
        <span style={chip(TONE[p.role] || '#6e6e73', { fontSize: 10 })}>{p.role}</span>
      ))}

      <p style={{ fontSize: 11.5, color: T.muted, marginTop: 14, maxWidth: 460, lineHeight: 1.5 }}>
        You cannot change your own role — that is what stops the last admin removing
        themselves and locking everyone out.
      </p>
    </div>
  )
}
