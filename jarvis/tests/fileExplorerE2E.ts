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
    // TEST 1: Real PDF Upload (/api/files/upload)
    // -------------------------------------------------------------
    console.log("👉 Test 1: Uploading a real PDF file via /api/files/upload...");
    const samplePdfContent = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Title (Real World Contract PDF) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
    const testFileName = `contract_realworld_${Date.now()}.pdf`;

    const formData = new FormData();
    const blob = new Blob([samplePdfContent], { type: "application/pdf" });
    formData.append("file", blob, testFileName);

    const uploadRes = await fetch(`${BASE_URL}/api/files/upload`, {
      method: "POST",
      body: formData,
    });

    const uploadData = await uploadRes.json();
    console.log("Upload Response:", uploadData);

    assert(uploadRes.status === 200, "Upload endpoint responded with HTTP 200");
    assert(uploadData.success === true, "Upload returned success: true");
    assert(fs.existsSync(uploadData.path), `Uploaded file physically exists on disk at ${uploadData.path}`);

    let currentFile = {
      name: uploadData.name,
      path: uploadData.path,
      size: uploadData.size,
      type: uploadData.type,
    };

    // -------------------------------------------------------------
    // TEST 2: Natural Rename with Pronoun ("rename it to blah blah...")
    // -------------------------------------------------------------
    const newName = `final_signed_agreement_${Date.now()}.pdf`;
    console.log(`\n👉 Test 2: Natural rename command ("rename it to ${newName}")...`);

    const renameRes = await fetch(`${BASE_URL}/api/files/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: `rename it to ${newName}`,
        contextFile: currentFile,
      }),
    });

    const renameData = await renameRes.json();
    console.log("Rename Response:", renameData);

    assert(renameRes.status === 200, "Rename endpoint responded with HTTP 200");
    assert(renameData.ok === true, "Rename returned ok: true");
    assert(!fs.existsSync(currentFile.path), "Original file no longer exists under old name");
    assert(fs.existsSync(renameData.newPath), `Renamed file physically exists on disk at ${renameData.newPath}`);

    // Update current context file
    currentFile = {
      name: renameData.newName,
      path: renameData.newPath,
      size: currentFile.size,
      type: currentFile.type,
    };

    // -------------------------------------------------------------
    // TEST 3: Natural Move ("move this file to Desktop")
    // -------------------------------------------------------------
    console.log(`\n👉 Test 3: Natural move command ("move this to Desktop")...`);

    const moveRes = await fetch(`${BASE_URL}/api/files/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "move this to Desktop",
        contextFile: currentFile,
      }),
    });

    const moveData = await moveRes.json();
    console.log("Move Response:", moveData);

    assert(moveRes.status === 200, "Move endpoint responded with HTTP 200");
    assert(moveData.ok === true, "Move returned ok: true");
    assert(!fs.existsSync(currentFile.path), "Original path no longer exists");
    assert(fs.existsSync(moveData.destPath), `Moved file physically exists on Desktop at ${moveData.destPath}`);

    currentFile.path = moveData.destPath;

    // -------------------------------------------------------------
    // TEST 4: Create Folder in File Explorer ("create folder JarvisVaultTest")
    // -------------------------------------------------------------
    const testFolder = `Jarvis_Vault_${Date.now()}`;
    console.log(`\n👉 Test 4: Create folder command ("create folder ${testFolder} in Desktop")...`);

    const folderRes = await fetch(`${BASE_URL}/api/files/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: `create folder ${testFolder} in Desktop`,
      }),
    });

    const folderData = await folderRes.json();
    console.log("Create Folder Response:", folderData);

    assert(folderRes.status === 200, "Folder endpoint responded with HTTP 200");
    assert(folderData.ok === true, "Folder returned ok: true");
    assert(fs.existsSync(folderData.path), `Folder physically exists on disk at ${folderData.path}`);

    // -------------------------------------------------------------
    // TEST 5: Natural Delete ("delete this file")
    // -------------------------------------------------------------
    console.log(`\n👉 Test 5: Natural delete command ("delete this file")...`);

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

    assert(deleteRes.status === 200, "Delete endpoint responded with HTTP 200");
    assert(deleteData.ok === true, "Delete returned ok: true");
    assert(!fs.existsSync(currentFile.path), `File is physically deleted from disk at ${currentFile.path}`);

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
