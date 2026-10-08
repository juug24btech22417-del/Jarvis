// Saved personal details used to autofill checkout / order forms.
//
// WHY THIS EXISTS: every e-commerce flow (Amazon, Flipkart, Zomato, Swiggy, any
// shop) asks for the same handful of fields — name, phone, email, delivery
// address. Typing them out each time is the slow, error-prone part of "order X
// for me". These values live in the local, git-ignored .env.local so the browser
// agent can fill them in directly instead of stalling on every field.
//
// Deliberately read from the environment rather than a committed file: this is
// personal data, and the .env files are already ignored by git.

export interface ShopperProfile {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  pincode?: string;
  state?: string;
}

/** Read the profile from the environment. Returns null when nothing is set. */
export function getShopperProfile(): ShopperProfile | null {
  const profile: ShopperProfile = {
    name: process.env.JARVIS_PROFILE_NAME?.trim() || undefined,
    phone: process.env.JARVIS_PROFILE_PHONE?.trim() || undefined,
    email: process.env.JARVIS_PROFILE_EMAIL?.trim() || undefined,
    address: process.env.JARVIS_PROFILE_ADDRESS?.trim() || undefined,
    city: process.env.JARVIS_PROFILE_CITY?.trim() || undefined,
    pincode: process.env.JARVIS_PROFILE_PINCODE?.trim() || undefined,
    state: process.env.JARVIS_PROFILE_STATE?.trim() || undefined,
  };
  return Object.values(profile).some(Boolean) ? profile : null;
}

/**
 * One line per known field, for pasting into the browser agent's instructions.
 * Returns "" when there is nothing saved, so the caller can skip the block.
 */
export function describeShopperProfile(p: ShopperProfile | null = getShopperProfile()): string {
  if (!p) return "";
  const rows: string[] = [];
  if (p.name) rows.push(`- Full name: ${p.name}`);
  if (p.phone) rows.push(`- Phone / mobile number: ${p.phone}`);
  if (p.email) rows.push(`- Email address: ${p.email}`);
  if (p.address) rows.push(`- Street address: ${p.address}`);
  if (p.city) rows.push(`- City: ${p.city}`);
  if (p.state) rows.push(`- State: ${p.state}`);
  if (p.pincode) rows.push(`- PIN / ZIP code: ${p.pincode}`);
  return rows.join("\n");
}
