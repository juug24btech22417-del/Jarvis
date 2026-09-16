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

/** One-line identity context for LLM prompts ("you are sending this for…"). */
export function identityPromptLine(): string {
  return `You are writing on behalf of ${USER_PROFILE.name} (contact: ${USER_PROFILE.phone}). Always sign off with this exact name, and include the contact number in the signature.`;
}
