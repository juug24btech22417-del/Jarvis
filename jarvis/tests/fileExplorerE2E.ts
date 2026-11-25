import fs from "fs";
import path from "path";
import { homedir } from "os";

// Automatically detect active port
async function getBaseUrl(): Promise<string> {
  for (const port of [3000, 3001, 3002]) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { method: "GET" }).catch(() => null);
      if (res && res.status < 500) return `http://127.0.0.1:${port}`;
      const ping = await fetch(`http://127.0.0.1:${port}/`, { method: "GET" }).catch(() => null);
      if (ping) return `http://127.0.0.1:${port}`;
    } catch {}
  }
  return "http://127.0.0.1:3001";
}

async function runE2ETests() {
  const BASE_URL = await getBaseUrl();
  console.log("==================================================");
  console.log(`🚀 STARTING REAL-WORLD FILE EXPLORER E2E TEST SUITE (${BASE_URL})`);
  console.log("==================================================\n");

  let testPassed = 0;
  let testFailed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`✅ PASS: ${desc}`);
      testPassed++;
    } else {
      console.error(`❌ FAIL: ${desc}`);
      testFailed++;
      throw new Error(`Assertion failed: ${desc}`);
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: In-Place Renaming of User's Real File (NO JarvisUploads folder)
    // -------------------------------------------------------------
    console.log("👉 Test 1: In-place natural language rename of real file in Downloads...");
    const downloadsDir = path.join(homedir(), "Downloads");
    const userPptx = path.join(downloadsDir, "m2 therm.pptx");
    const tempPptx = path.join(downloadsDir, `test_notes_${Date.now()}.pptx`);

    // Ensure a test file exists in Downloads root
    const sourceFilePath = fs.existsSync(userPptx) ? userPptx : tempPptx;
    if (!fs.existsSync(sourceFilePath)) {
      fs.writeFileSync(sourceFilePath, "Fake PPTX Content for E2E Test");
    }

    const initialFileName = path.basename(sourceFilePath);
    console.log(`Targeting file on disk: ${sourceFilePath}`);

    // Command: Natural language rename without JarvisUploads
    const targetRenamedName = `thermo_renamed_${Date.now()}.pptx`;
    const renameRes = await fetch(`${BASE_URL}/api/files/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: `Hey JARVIS, please rename ${initialFileName} to ${targetRenamedName}`,
      }),
    });

    const renameData = await renameRes.json();
    console.log("Rename Response:", renameData);

    assert(renameRes.status === 200, "Rename endpoint responded with HTTP 200");
    assert(renameData.ok === true, "Rename returned ok: true");
    assert(!fs.existsSync(sourceFilePath), "Original filename no longer exists");
    assert(fs.existsSync(renameData.newPath), `Renamed file physically exists on disk at ${renameData.newPath}`);
    assert(!renameData.newPath.includes("JarvisUploads"), "Verified NO JarvisUploads folder was used!");
    assert(!fs.existsSync(path.join(homedir(), "Downloads", "JarvisUploads")), "Verified JarvisUploads folder does NOT exist!");

    // Rename it back if it was the user's real file
    let activeFilePath = renameData.newPath;
    if (initialFileName === "m2 therm.pptx") {
      const revertRes = await fetch(`${BASE_URL}/api/files/manage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: `rename it to m2 therm.pptx`,
          contextFile: { name: targetRenamedName, path: activeFilePath },
        }),
      });
      const revertData = await revertRes.json();
      assert(revertData.ok === true, "Reverted back to m2 therm.pptx cleanly");
      activeFilePath = revertData.newPath;
    }

    // -------------------------------------------------------------
    // TEST 2: File Staging & Upload (Must save to Downloads root, NOT JarvisUploads)
    // -------------------------------------------------------------
    console.log("\n👉 Test 2: File staging with zero subfolder creation...");
    const samplePdfContent = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Title (Real Contract) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
    const testDocName = `quarterly_report_${Date.now()}.pdf`;

    const formData = new FormData();
    const blob = new Blob([samplePdfContent], { type: "application/pdf" });
    formData.append("file", blob, testDocName);

    const uploadRes = await fetch(`${BASE_URL}/api/files/upload`, {
      method: "POST",
      body: formData,
    });

    const uploadData = await uploadRes.json();
    console.log("Upload Response:", uploadData);

    assert(uploadRes.status === 200, "Upload endpoint responded with HTTP 200");
    assert(uploadData.success === true, "Upload returned success: true");
    assert(fs.existsSync(uploadData.path), `Uploaded file physically exists at ${uploadData.path}`);
    assert(!uploadData.path.includes("JarvisUploads"), "Uploaded file is directly in Downloads, NOT in JarvisUploads");
    assert(path.dirname(uploadData.path) === downloadsDir, "Uploaded file is in root Downloads directory");

    let currentFile = {
      name: uploadData.name,
      path: uploadData.path,
      size: uploadData.size,
      type: uploadData.type,
    };

    // -------------------------------------------------------------
    // TEST 3: Conversational Pronoun Rename ("could you please rename it to...")
    // -------------------------------------------------------------
    const newDocName = `final_board_review_${Date.now()}.pdf`;
    console.log(`\n👉 Test 3: Conversational rename ("could you please rename it to ${newDocName}")...`);

    const convRenameRes = await fetch(`${BASE_URL}/api/files/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: `could you please rename it to ${newDocName}`,
        contextFile: currentFile,
      }),
    });

    const convRenameData = await convRenameRes.json();
    console.log("Conversational Rename Response:", convRenameData);

    assert(convRenameRes.status === 200, "Responded with HTTP 200");
    assert(convRenameData.ok === true, "Conversational rename succeeded");
    assert(!fs.existsSync(currentFile.path), "Old document path is gone");
    assert(fs.existsSync(convRenameData.newPath), `Renamed file exists at ${convRenameData.newPath}`);

    currentFile = {
      name: convRenameData.newName,
      path: convRenameData.newPath,
      size: currentFile.size,
      type: currentFile.type,
    };

    // -------------------------------------------------------------
    // TEST 4: Move to Desktop ("move this file to Desktop")
    // -------------------------------------------------------------
    console.log(`\n👉 Test 4: Move command ("move this to Desktop")...`);

    const moveRes = await fetch(`${BASE_URL}/api/files/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "Hey JARVIS, move this to Desktop",
        contextFile: currentFile,
      }),
    });

    const moveData = await moveRes.json();
    console.log("Move Response:", moveData);

    assert(moveData.ok === true, "Moved file to Desktop");
    assert(!fs.existsSync(currentFile.path), "Original file in Downloads is moved");
    assert(fs.existsSync(moveData.destPath), `File physically exists on Desktop at ${moveData.destPath}`);
    assert(path.dirname(moveData.destPath) === path.join(homedir(), "Desktop"), "Path is on user Desktop");

    currentFile.path = moveData.destPath;

    // -------------------------------------------------------------
    // TEST 5: Create Folder on Desktop ("create folder Project_Alpha on Desktop")
    // -------------------------------------------------------------
    const testFolder = `Jarvis_Workspace_${Date.now()}`;
    console.log(`\n👉 Test 5: Create folder ("create folder ${testFolder} in Desktop")...`);

    const folderRes = await fetch(`${BASE_URL}/api/files/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: `create folder ${testFolder} in Desktop`,
      }),
    });

    const folderData = await folderRes.json();
    console.log("Folder Response:", folderData);

    assert(folderData.ok === true, "Created folder");
    assert(fs.existsSync(folderData.path), `Folder physically exists at ${folderData.path}`);

    // -------------------------------------------------------------
    // TEST 6: Delete Staged File ("delete this file")
    // -------------------------------------------------------------
    console.log(`\n👉 Test 6: Delete command ("delete this file")...`);

    const deleteRes = await fetch(`${BASE_URL}/api/files/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "delete this file",
        contextFile: currentFile,
      }),
    });

    const deleteData = await deleteRes.json();
    console.log("Delete Response:", deleteData);

    assert(deleteData.ok === true, "Deleted file");
    assert(!fs.existsSync(currentFile.path), `File physically removed from Desktop at ${currentFile.path}`);

    // Clean up created test folder
    console.log(`\n👉 Clean up: Deleting test folder ${folderData.path}...`);
    const cleanFolderRes = await fetch(`${BASE_URL}/api/files/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete",
        sourcePath: folderData.path,
      }),
    });
    const cleanData = await cleanFolderRes.json();
    assert(cleanData.ok === true, "Cleaned up test folder");
    assert(!fs.existsSync(folderData.path), "Test folder no longer exists");

    console.log("\n==================================================");
    console.log(`🎉 ALL ${testPassed} TESTS PASSED WITH 0 FAILURES!`);
    console.log("==================================================");
  } catch (err) {
    console.error("\n❌ E2E TEST SUITE FAILED:", err);
    process.exit(1);
  }
}

runE2ETests();
