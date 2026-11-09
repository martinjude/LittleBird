export interface VoiceInfo {
  /** Higher = more important (e.g. player's guns > distant debris). */
  priority: number
  startTime: number
}

/**
 * Picks which active voice to cut for a new one when the pool is full: the lowest
 * priority, oldest first. Returns -1 when every active voice outranks the newcomer.
 */
export function pickVoiceToSteal(voices: readonly VoiceInfo[], incomingPriority: number): number {
  let victim = -1
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i]
    if (v.priority > incomingPriority) continue
    const best = victim >= 0 ? voices[victim] : null
    if (!best || v.priority < best.priority || (v.priority === best.priority && v.startTime < best.startTime)) victim = i
  }
  return victim
}
