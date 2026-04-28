import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'

const BUCKETS = [
  { label: '50–60%', min: 0.50, max: 0.60 },
  { label: '60–70%', min: 0.60, max: 0.70 },
  { label: '70–80%', min: 0.70, max: 0.80 },
  { label: '80%+',   min: 0.80, max: 1.01 },
]

function AccuracyBar({ value, color }) {
  return (
    <div style={{
      height: 10, borderRadius: 6,
      background: '#f1f5f9',
      overflow: 'hidden',
      border: '1px solid #e2e8f0',
    }}>
      <div style={{
        height: '100%',
        width: `${(value || 0) * 100}%`,
        background: color,
        transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
        borderRadius: 6,
      }} />
    </div>
  )
}

function accColor(acc) {
  if (acc == null) return '#94a3b8'
  if (acc >= 0.70) return '#16a34a'
  if (acc >= 0.55) return '#f59e0b'
  return '#dc2626'
}

function accGradient(acc) {
  if (acc == null) return '#e2e8f0'
  if (acc >= 0.70) return 'linear-gradient(90deg,#16a34a,#4ade80)'
  if (acc >= 0.55) return 'linear-gradient(90deg,#f59e0b,#fbbf24)'
  return 'linear-gradient(90deg,#dc2626,#f87171)'
}

export default function PredictionAccuracy() {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const channelRef = useRef(null)

  useEffect(() => {
    async function fetchResults() {
      const { data } = await supabase
        .from('wtt_match_results')
        .select('*')
        .order('completed_at', { ascending: false })
      setResults(data || [])
      setLoading(false)
    }
    fetchResults()

    const channel = supabase
      .channel('pred-accuracy-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wtt_match_results' },
        payload => setResults(prev => [payload.new, ...prev])
      )
      .subscribe()
    channelRef.current = channel
    return () => supabase.removeChannel(channel)
  }, [])

  if (loading) return null

  const scored  = results.filter(r => r.correct !== null)
  const total   = scored.length
  const correct = scored.filter(r => r.correct).length
  const acc     = total > 0 ? correct / total : null

  const bucketStats = BUCKETS.map(b => {
    const inBucket = scored.filter(r => {
      const conf = Math.max(r.p_prematch, 1 - r.p_prematch)
      return conf >= b.min && conf < b.max
    })
    return {
      ...b,
      total:   inBucket.length,
      correct: inBucket.filter(r => r.correct).length,
    }
  }).filter(b => b.total > 0)

  if (results.length === 0) {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderRadius: 18,
        padding: '28px 28px',
        border: '1px solid rgba(30,70,160,0.08)',
        boxShadow: '0 4px 32px rgba(30,70,160,0.10)',
        textAlign: 'center',
        color: '#94a3b8',
        fontSize: 13,
        marginBottom: 28,
      }}>
        Prediction accuracy will appear here as matches complete.
      </div>
    )
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,0.82)',
      backdropFilter: 'blur(18px)',
      WebkitBackdropFilter: 'blur(18px)',
      borderRadius: 18,
      padding: '26px 28px 22px',
      border: '1px solid rgba(30,70,160,0.10)',
      boxShadow: '0 4px 32px rgba(30,70,160,0.13)',
      marginBottom: 28,
    }}>

      {/* ── Section title ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 20,
      }}>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#94a3b8',
            letterSpacing: 2, textTransform: 'uppercase', marginBottom: 2,
          }}>
            Prediction Accuracy
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            World Team TT Championships 2026
          </div>
        </div>
        <div style={{
          background: 'rgba(30,70,160,0.06)',
          border: '1px solid rgba(30,70,160,0.12)',
          borderRadius: 20,
          padding: '4px 12px',
          fontSize: 11,
          color: '#1d4ed8',
          fontWeight: 600,
        }}>
          {total} match{total !== 1 ? 'es' : ''} tracked
        </div>
      </div>

      {/* ── Headline accuracy ── */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 16,
        marginBottom: 12,
      }}>
        <div>
          <span style={{
            fontSize: 58, fontWeight: 900, lineHeight: 1,
            letterSpacing: -3,
            color: accColor(acc),
          }}>
            {acc != null ? `${(acc * 100).toFixed(0)}%` : '—'}
          </span>
        </div>
        <div style={{ paddingBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
            {correct} of {total} correct
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            pre-match prediction accuracy
          </div>
        </div>
      </div>

      <AccuracyBar value={acc} color={accGradient(acc)} />

      {/* ── Confidence breakdown ── */}
      {bucketStats.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#94a3b8',
            letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10,
          }}>
            Accuracy by Confidence
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {bucketStats.map(b => {
              const bAcc = b.correct / b.total
              return (
                <div key={b.label} style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '9px 16px',
                  textAlign: 'center',
                  minWidth: 80,
                }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{b.label}</div>
                  <div style={{
                    fontSize: 20, fontWeight: 800,
                    color: accColor(bAcc),
                  }}>
                    {(bAcc * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 10, color: '#cbd5e1', marginTop: 2 }}>
                    {b.correct}/{b.total}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Recent predictions ── */}
      <div style={{ marginTop: 22 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#94a3b8',
          letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10,
        }}>
          Recent Predictions
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {results.slice(0, 10).map(r => {
            const conf          = Math.max(r.p_prematch, 1 - r.p_prematch)
            const predictedName = r.p_prematch >= 0.5 ? r.comp1_name : r.comp2_name
            const actualName    = r.result === 'W'    ? r.comp1_name : r.comp2_name
            const isCorrect     = r.correct
            return (
              <div key={r.match_id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 9,
                background: isCorrect === true
                  ? 'rgba(22,163,74,0.05)'
                  : isCorrect === false
                    ? 'rgba(220,38,38,0.05)'
                    : '#f8fafc',
                border: isCorrect === true
                  ? '1px solid rgba(22,163,74,0.18)'
                  : isCorrect === false
                    ? '1px solid rgba(220,38,38,0.18)'
                    : '1px solid transparent',
              }}>
                {/* Tick / Cross */}
                <span style={{
                  fontSize: 15, fontWeight: 800, width: 18, flexShrink: 0, textAlign: 'center',
                  color: isCorrect === true ? '#16a34a' : isCorrect === false ? '#dc2626' : '#94a3b8',
                }}>
                  {isCorrect === true ? '✓' : isCorrect === false ? '✗' : '?'}
                </span>

                {/* Match names */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: '#0f172a',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {r.comp1_name}
                    <span style={{ color: '#94a3b8', fontWeight: 400, margin: '0 5px' }}>vs</span>
                    {r.comp2_name}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
                    <span style={{ marginRight: 8 }}>{r.round_name || 'Singles'}</span>
                    <span style={{ color: '#cbd5e1' }}>·</span>
                    <span style={{ marginLeft: 8 }}>
                      Predicted: <strong style={{ color: '#475569' }}>{predictedName?.split(' ').slice(-1)[0]}</strong>
                      {isCorrect === false &&
                        <span style={{ color: '#dc2626' }}>
                          {' '}· Won: <strong>{actualName?.split(' ').slice(-1)[0]}</strong>
                        </span>
                      }
                    </span>
                  </div>
                </div>

                {/* Confidence + score */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 700,
                    color: conf >= 0.70 ? '#1d4ed8' : '#64748b',
                  }}>
                    {(conf * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>
                    {r.games_a}–{r.games_b}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}
