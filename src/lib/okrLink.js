// ─── Canonical link builder for the OKR dashboard ───────────────────────────
// Every Squad / Talent / Events card routes through here so a click opens the
// OKR dashboard with the right segment + entity preselected.
//
//   okrLink({ level, kind, age, id, ids })
//     level : 'Senior' | 'U11'..'U19'   (from the card / talent selector)
//     kind  : 'singles' | 'doubles'
//     age   : optional explicit youth age band (falls back to level if U-*)
//     id    : player ittf id            (singles)
//     ids   : [p1, p2] player ittf ids  (doubles)

function isYouthLevel(level) {
  return typeof level === 'string' && /^U\d/.test(level);
}

export function okrLink({ level, kind, age, id, ids } = {}) {
  const youth = isYouthLevel(level) || isYouthLevel(age);
  const band = age || (isYouthLevel(level) ? level : null);

  if (kind === 'doubles' && Array.isArray(ids) && ids.filter(Boolean).length === 2) {
    const [p1, p2] = ids;
    const seg = youth ? 'youth_doubles' : 'senior_doubles';
    const ageQ = youth && band ? `&age=${band}` : '';
    return `/okr?seg=${seg}&p1=${p1}&p2=${p2}${ageQ}`;
  }

  // singles (default)
  const seg = youth ? 'youth_singles' : 'senior_singles';
  const ageQ = youth && band ? `&age=${band}` : '';
  return `/okr?seg=${seg}${ageQ}&pid=${id}`;
}
