import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import path from "path";

// Create email transporter
const createTransporter = () => {
  const service = process.env.EMAIL_SERVICE || "gmail";
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    return null;
  }

  const serviceConfig = service === "gmail" ? { service: "Gmail" } : { host: "smtp." + service + ".com", port: 587, secure: false };
  return nodemailer.createTransport({
    ...serviceConfig,
    auth: { user, pass },
    // Increase limits for attachments
    maxConnections: 5,
    maxMessages: 100,
  } as any);
};

// Allowed MIME types (blocking dangerous executables)
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".dll", ".bat", ".cmd", ".sh", ".bin",
  ".apk", ".ipa", ".msi", ".dmg", ".pkg",
  ".js", ".vbs", ".ps1", ".wsf", ".hta"
]);

// Check if file is safe
function isSafeFile(filename: string, mimetype: string): boolean {
  const ext = path.extname(filename).toLowerCase();

  // Block known dangerous extensions
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return false;
  }

  // Block suspicious MIME types
  const blockedMimePrefixes = [
    "application/x-msdownload",
    "application/x-executable",
    "application/x-dosexec",
    "application/x-sh",
    "text/javascript",
    "application/javascript",
    "application/x-javascript",
  ];

  for (const prefix of blockedMimePrefixes) {
    if (mimetype.startsWith(prefix)) {
      return false;
    }
  }

  return true;
}

// Format file size for display
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export async function POST(req: NextRequest) {
  try {
    const transporter = createTransporter();

    if (!transporter) {
      return NextResponse.json(
        {
          error: "Email not configured",
          setup: {
            service: "gmail",
            steps: [
              "1. Enable 2FA on your Google account",
              "2. Go to https://myaccount.google.com/apppasswords",
              "3. Generate App Password for 'Mail'",
              "4. Add to .env.local:",
              "   EMAIL_SERVICE=gmail",
              "   EMAIL_USER=your-email@gmail.com",
              "   EMAIL_PASS=your-app-password",
            ],
            note: "Use App Password, not your regular password!",
          },
        },
        { status: 400 }
      );
    }

    // Check content type to handle both JSON and FormData
    const contentType = req.headers.get("content-type") || "";
    let to: string | null = null;
    let subject: string | null = null;
    let text: string | null = null;
    let html: string | null = null;
    const attachments: { filename: string; content?: Buffer; contentType: string }[] = [];
    let attachmentsSize = 0;
    const MAX_EMAIL_SIZE = 24 * 1024 * 1024; // 24MB (Gmail limit is 25MB, keeping buffer)

    if (contentType.includes("application/json")) {
      // Handle JSON body (from CommandBar)
      const jsonData = await req.json();
      to = jsonData.to;
      subject = jsonData.subject;
      text = jsonData.text;
      html = jsonData.html || `<p>${text}</p>`;
    } else {
      // Handle FormData (from AutomationPanel with file attachments)
      const formData = await req.formData();

      to = formData.get("to") as string;
      subject = formData.get("subject") as string;
      text = formData.get("text") as string;
      html = formData.get("html") as string;

      // Process all form data entries looking for files
      const entries = Array.from(formData.entries());
      for (const [key, value] of entries) {
        if (key.startsWith("attachment") && value instanceof File) {
          const file = value;

          // Security check
          if (!isSafeFile(file.name, file.type)) {
            return NextResponse.json(
              { error: `File "${file.name}" is not allowed for security reasons` },
              { status: 400 }
            );
          }

          // For very large files, we'll need to handle differently
          // But for now, read into memory (Next.js handles this)
          const bytes = await file.arrayBuffer();
          const buffer = Buffer.from(bytes);

          attachments.push({
            filename: file.name,
            content: buffer,
            contentType: file.type || "application/octet-stream",
          });
        }
      }
    }

    // Calculate total attachment size
    attachmentsSize = attachments.reduce((sum, att) => sum + (att.content?.length || 0), 0);
    const estimatedEmailSize = attachmentsSize + (text?.length || 0) * 2 + (html?.length || 0) * 2;

    if (estimatedEmailSize > MAX_EMAIL_SIZE) {
      const sizeInfo = {
        attachmentsSize: formatFileSize(attachmentsSize),
        estimatedTotal: formatFileSize(estimatedEmailSize),
        limit: formatFileSize(MAX_EMAIL_SIZE),
        suggestion: "Try uploading files to Google Drive/Dropbox and share links instead",
      };

      return NextResponse.json(
        {
          error: "Email size exceeds Gmail's 25MB limit",
          details: sizeInfo
        },
        { status: 413 }
      );
    }

    if (!to || !subject) {
      return NextResponse.json(
        { error: "Recipient and subject required" },
        { status: 400 }
      );
    }

    const mailOptions: any = {
      from: process.env.EMAIL_USER,
      to,
      subject,
      text: text || "",
      html: html || `<p>${text}</p>`,
    };

    // Add attachments if any
    if (attachments.length > 0) {
      mailOptions.attachments = attachments;
    }

    const info = await transporter.sendMail(mailOptions);

    return NextResponse.json({
      success: true,
      messageId: info.messageId,
      previewUrl: nodemailer.getTestMessageUrl(info as any),
      message: `Email sent to ${to}`,
      attachmentsSent: attachments.length,
      totalSize: formatFileSize(attachmentsSize),
    });

  } catch (error: any) {
    console.error("Email error:", error);
    return NextResponse.json(
      { error: "Failed to send email", details: error.message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  if (action === "test") {
    const transporter = createTransporter();
    if (transporter) {
      return NextResponse.json({
        success: true,
        status: "configured",
        user: process.env.EMAIL_USER,
        features: ["text/html body", "multiple attachments", "drag & drop support"],
        limits: {
          maxEmailSize: "25MB (Gmail limit)",
          blockedFiles: Array.from(BLOCKED_EXTENSIONS),
        }
      });
    }
    return NextResponse.json({
      success: false,
      status: "not_configured",
    });
  }

  return NextResponse.json({
    success: true,
    usage: {
      endpoint: "/api/send-email",
      method: "POST",
      contentType: "multipart/form-data",
      body: {
        to: "recipient@example.com",
        subject: "Email subject",
        text: "Plain text version",
        html: "<p>HTML version</p>",
        attachments: "File(s) - optional, multiple allowed",
      },
    },
    setup: {
      gmail: {
        steps: [
          "Enable 2FA on Google account",
          "Generate App Password at myaccount.google.com/apppasswords",
          "Add credentials to .env.local",
        ],
      },
    },
    limits: {
      maxEmailSize: "25MB total (Gmail limit)",
      maxAttachmentSize: "25MB per email",
      blockedFileTypes: Array.from(BLOCKED_EXTENSIONS),
    }
  });
}
