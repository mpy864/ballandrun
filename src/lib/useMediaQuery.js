import { useEffect, useState } from 'react'

// Read a media query from JS.
//
// This exists for BEHAVIOUR, not for looks. Anything that is only a matter of size —
// how many columns, how big the type — belongs in CSS, where `.tops-cols` and `clamp()`
// handle it with no JS and no breakpoint to keep in step. Use this only when the
// component must actually act differently: the shell needs to know whether the sidebar
// is a permanent rail or a drawer, because a drawer has to trap focus, close on Escape,
// close after navigating, and be hidden from the accessibility tree while shut.
//
// Subscribes rather than polling, and reads once on mount so the first paint is right.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    // Guarded for the first render in any non-browser environment; a wrong `false` here
    // would render the desktop shell for one frame and then jump.
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false))

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = e => setMatches(e.matches)
    setMatches(mql.matches)          // in case it changed between render and effect
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

// The app's single breakpoint, named once so no component re-types the number.
// Keep in step with the @media blocks in index.css.
export const SMALL_SCREEN = '(max-width: 900px)'
