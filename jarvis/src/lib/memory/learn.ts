// What is worth remembering?
//
// The extractor runs after every chat turn, so the gate matters: a greeting or
// a one-off command must never cost a model call (or pollute the knowledge
// graph with "ok thanks" nodes). Kept dependency-free and pure so it is easy to
// test and safe to import anywhere.

/**
 * True when a message might carry a durable fact about the user, their people,
 * projects or preferences.
 */
export function shouldExtract(message: string): boolean {
  const m = (message || "").replace(/\s+/g, " ").trim();
  if (m.length < 10) return false;

  // Social filler, however it is padded out ("thank you so much").
  if (
    m.length < 48 &&
    /^(hi|hey|hello|yo|sup|ok|okay|k|thanks|thank you|thx|cool|nice|got it|yes|yep|no|nope|lol|hmm|stop|wait|cancel|never ?mind|good (morning|night|evening))\b/i.test(
      m
    )
  ) {
    return false;
  }

  // Short one-off instructions are commands, not facts.
  if (
    m.length < 56 &&
    /^(open|close|launch|play|pause|resume|skip|next|previous|set (a|the)? ?\d* ?(min|minute|hour|sec|second)s? timer|start|stop|turn (on|off)|volume|mute|unmute|(take|grab) a (screenshot|photo)|screenshot|lock|shut ?down|sleep|what('| i)?s|whats|who is|who's|when is|where is|how (do|does|to)|can you|could you|would you|please (open|play|set|find|search|turn|show)|show me|search for|find me|look up|google|check the|remind me to|schedule)\b/i.test(
      m
    )
  ) {
    return false;
  }
  return true;
}
