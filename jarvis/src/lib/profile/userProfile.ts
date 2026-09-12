import fs from "fs/promises";
import path from "path";

export interface UserProfile {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  altEmail?: string;
  phone: string;
  countryCode: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  company?: string;
  jobTitle?: string;
  bio?: string;
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  fullName: "Dhruv Bijapur",
  firstName: "Dhruv",
  lastName: "Bijapur",
  email: "dhruvbijapur@gmail.com",
  altEmail: "dhruvbijapur67@gmail.com",
  phone: "9606571200",
  countryCode: "+91",
  address1: "Indiranagar",
  address2: "100 Feet Road",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560038",
  country: "India",
  company: "Personal Projects",
  jobTitle: "Software Developer & AI Engineer",
  bio: "Building JARVIS autonomous systems.",
};

const PROFILE_FILE_PATH = path.join(process.cwd(), ".jarvis_profile.json");

/**
 * Retrieve the active user profile, loading from local persistent storage
 * or falling back to default configuration.
 */
export async function getUserProfile(): Promise<UserProfile> {
  try {
    const raw = await fs.readFile(PROFILE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_USER_PROFILE, ...parsed };
  } catch {
    // If not saved yet, return default profile
    return { ...DEFAULT_USER_PROFILE };
  }
}

/**
 * Save updated user profile to persistent disk storage.
 */
export async function saveUserProfile(
  profile: Partial<UserProfile>
): Promise<UserProfile> {
  const current = await getUserProfile();
  const updated: UserProfile = { ...current, ...profile };
  await fs.writeFile(
    PROFILE_FILE_PATH,
    JSON.stringify(updated, null, 2),
    "utf8"
  );
  return updated;
}
