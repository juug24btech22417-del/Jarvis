import { NextRequest, NextResponse } from "next/server";
import { getUserProfile, saveUserProfile, UserProfile } from "@/lib/profile/userProfile";
import { GhostAutofillService } from "@/services/GhostAutofillService";

export async function GET() {
  try {
    const profile = await getUserProfile();
    const bookmarklet = GhostAutofillService.generateBookmarklet(profile);

    return NextResponse.json({
      success: true,
      profile,
      bookmarklet,
      supportedFields: [
        "Full Name",
        "First Name",
        "Last Name",
        "Email",
        "Phone / Mobile",
        "Address",
        "City",
        "State",
        "Postal / PIN Code",
        "Country",
        "Company",
        "Job Title",
      ],
    });
  } catch (error: any) {
    console.error("[ghost/autofill] GET error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action = "autofill_url", url, profile, headed = false } = body;

    if (action === "update_profile" && profile) {
      const updated = await saveUserProfile(profile as Partial<UserProfile>);
      return NextResponse.json({
        success: true,
        message: "User profile updated successfully",
        profile: updated,
      });
    }

    if (action === "autofill_url") {
      if (!url) {
        return NextResponse.json(
          { success: false, error: "Target URL is required for autofill" },
          { status: 400 }
        );
      }

      console.log(`[GhostAutofill] Initiating autofill on ${url}...`);
      const result = await GhostAutofillService.autofillUrl(url, {
        headed: Boolean(headed),
      });

      return NextResponse.json(result);
    }

    if (action === "get_bookmarklet") {
      const currentProfile = await getUserProfile();
      const bookmarklet = GhostAutofillService.generateBookmarklet(currentProfile);
      return NextResponse.json({
        success: true,
        bookmarklet,
      });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[ghost/autofill] POST error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
