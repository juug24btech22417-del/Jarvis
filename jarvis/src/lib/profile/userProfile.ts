import fs from "fs/promises";
import path from "path";

export interface UserProfile {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  altEmail?: string;
  collegeEmail?: string;
  phone: string;
  countryCode: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  // Home / permanent address (separate from current city)
  homeAddress?: string;
  homeCity?: string;
  homeState?: string;
  homePinCode?: string;
  // Academic
  usn?: string;
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
  collegeEmail: "juug24btech22417@jainuniversity.ac.in",
  phone: "9606571200",
  countryCode: "+91",
  // Current / mailing address
  address1: "Saraf Bazar",
  address2: "Guledgudd",
  city: "Bagalkot",
  state: "Karnataka",
  postalCode: "587203",
  country: "India",
  // Home / permanent address
  homeAddress: "Saraf Bazar, Guledgudd",
  homeCity: "Bagalkot",
  homeState: "Karnataka",
  homePinCode: "587203",
  // Academic
  usn: "24BTRCA059",
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
