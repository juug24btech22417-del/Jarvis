import { NextRequest, NextResponse } from "next/server";
import { getProxyStatus } from "@/services/ProxyServer";
import fs from "fs";

export async function GET(req: NextRequest) {
  try {
    const { caCertPath } = getProxyStatus();

    if (!fs.existsSync(caCertPath)) {
      return NextResponse.json(
        { success: false, error: "CA Certificate not generated. Please start the proxy first." },
        { status: 404 }
      );
    }

    const certBuffer = fs.readFileSync(caCertPath);

    return new Response(certBuffer, {
      headers: {
        "Content-Type": "application/x-x509-ca-cert",
        "Content-Disposition": 'attachment; filename="jarvis-ca.crt"',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
