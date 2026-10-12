// Central user identity — single source of truth for who JARVIS works for.
//
// Every outbound email signature, calendar invite, and "who am I talking
// about" context pulls from here. If you ever change your name or contact
// info, change it HERE and everything follows.

export const USER_PROFILE = {
  name: "Dhruv Bijapur",
  firstName: "Dhruv",
  phone: "9606571200",
} as const;

/** Email signature block appended to composed emails. */
export function emailSignature(): string {
  return `Best regards,\n${USER_PROFILE.name}\nContact: ${USER_PROFILE.phone}`;
}

/**
 * One-line identity context for LLM prompts ("you are sending this for…").
 *
 * Deliberately tells the model NOT to write a signature: the signature is
 * appended afterwards from USER_PROFILE, and models that were asked to "sign
 * off appropriately" emitted a template one — "Best regards, [Your title]
 * [Company name] [Contact info]" — which went out in real email. There is no
 * job title or company in this profile, and none should ever appear.
 */
export function identityPromptLine(): string {
  return `You are writing on behalf of ${USER_PROFILE.name} (contact: ${USER_PROFILE.phone}). Do NOT write any closing or signature block and NEVER emit placeholder text in brackets such as [Your Name], [Your title], [Company name] or [Contact info] — the signature (name + contact only, never a job title or company) is added automatically after your final sentence.`;
}
