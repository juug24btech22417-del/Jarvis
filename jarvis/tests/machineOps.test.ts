// v6 machine ops — file_organize · repo_inspect · dev_server_* · last-mission refs.
//
// All pure: no Prisma, no network, no child processes, no Next runtime.
//
// Run with:  npx tsx tests/machineOps.test.ts

import {
  categoryForFile,
  planFileOrganization,
  uniqueName,
  type OrganizeFile,
} from "../src/lib/agent/fileOrganize";
import {
  isSafePackageName,
  parsePackageFacts,
  parseOutdated,
  summarizeRepoInspect,
} from "../src/lib/agent/repoInspect";
import { ordinalIndex, isMissionFollowup, pickByOrdinal } from "../src/lib/agent/followupRefs";
import { detectFollowupAction } from "../src/lib/agent/followupIntent";
import { KNOWN_KINDS, planNeedsApproval, fallbackPlan, heuristicPlan, classifyGoal } from "../src/lib/agent/plan";
import { recordOrganize, getLastOrganize, undoLastOrganize, clearLastOrganize } from "../src/lib/agent/fileOrganizeLog";
import fs from "fs";
import os from "os";
import path from "path";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.error(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

const NOW = new Date(2026, 9, 2, 10, 0, 0).getTime();
const DAY = 86_400_000;

/* ----------------------------- file organize ----------------------------- */

section("categoryForFile");
check("jpg → Images", categoryForFile("holiday.JPG") === "Images", categoryForFile("holiday.JPG"));
check("pdf → Documents", categoryForFile("invoice.pdf") === "Documents");
check("zip → Archives", categoryForFile("backup.zip") === "Archives");
check("ts → Code", categoryForFile("app.ts") === "Code");
check("exe → Installers", categoryForFile("setup.exe") === "Installers");
check("no extension → Other", categoryForFile("README") === "Other");

section("planFileOrganization — by-type (default)");
{
  const files: OrganizeFile[] = [
    { name: "photo.jpg", mtime: NOW },
    { name: "report.pdf", mtime: NOW },
    { name: "song.mp3", mtime: NOW },
    { name: "notes", mtime: NOW },
    { name: ".hidden", mtime: NOW },
  ];
  const plan = planFileOrganization(files);
  check("moves the 3 categorisable files", plan.moves.length === 3, JSON.stringify(plan.moves));
  check("photo → Images", plan.moves.find((m) => m.name === "photo.jpg")?.to === "Images");
  check("report → Documents", plan.moves.find((m) => m.name === "report.pdf")?.to === "Documents");
  check("song → Audio", plan.moves.find((m) => m.name === "song.mp3")?.to === "Audio");
  check("extensionless + hidden left in place", plan.skipped.includes("notes") && plan.skipped.includes(".hidden"));
}

section("planFileOrganization — archive");
{
  const files: OrganizeFile[] = [
    { name: "old.zip", mtime: NOW - 40 * DAY },
    { name: "fresh.zip", mtime: NOW - 2 * DAY },
  ];
  const plan = planFileOrganization(files, { mode: "archive", olderThanDays: 30, now: NOW });
  check("only the old file is archived", plan.moves.length === 1 && plan.moves[0].name === "old.zip", JSON.stringify(plan.moves));
  check("destination is Archive", plan.moves[0].to === "Archive");
  check("recent file skipped", plan.skipped.includes("fresh.zip"));
}

section("uniqueName");
{
  const taken = new Set(["photo.jpg", "photo (1).jpg"]);
  check("collision suffixed", uniqueName("photo.jpg", taken) === "photo (2).jpg", uniqueName("photo.jpg", taken));
  check("free name unchanged", uniqueName("new.png", taken) === "new.png");
}

/* ----------------------------- repo inspect ----------------------------- */

section("isSafePackageName");
check("plain name ok", isSafePackageName("react"));
check("scoped name ok", isSafePackageName("@types/node"));
check("flag rejected", !isSafePackageName("--registry=http://evil"));
check("shell chars rejected", !isSafePackageName("react; rm -rf /"));
check("empty rejected", !isSafePackageName(""));

section("parsePackageFacts");
{
  const facts = parsePackageFacts({
    name: "jarvis",
    version: "1.2.3",
    dependencies: { next: "14", react: "18" },
    devDependencies: { typescript: "5" },
    scripts: { dev: "next dev", test: "tsx tests" },
  });
  check("name/version read", facts?.name === "jarvis" && facts?.version === "1.2.3");
  check("deps sorted", JSON.stringify(facts?.dependencies) === JSON.stringify(["next", "react"]));
  check("total deps counted", facts?.totalDeps === 3);
  check("scripts read", facts?.scripts.includes("dev") === true);
  check("garbage rejected", parsePackageFacts(null) === null);
}

section("parseOutdated + summarizeRepoInspect");
{
  const rows = parseOutdated({
    next: { current: "14.0.0", wanted: "14.2.0", latest: "15.0.0" },
    react: { current: "18.0.0", wanted: "18.2.0", latest: "18.2.0" },
  });
  check("two rows parsed", rows.length === 2, JSON.stringify(rows));
  check("sorted by name", rows[0].name === "next" && rows[1].name === "react");
  const facts = parsePackageFacts({ name: "jarvis", version: "1.0.0", dependencies: { next: "14" } })!;
  const summary = summarizeRepoInspect(facts, rows, { package: "react", packageLatest: "18.2.0", path: "C:/proj" });
  check("summary names the package", summary.includes("`jarvis`@1.0.0"));
  check("summary lists outdated", summary.includes("next") && summary.includes("15.0.0"));
  check("summary includes latest lookup", summary.includes("18.2.0"));
  const clean = summarizeRepoInspect(facts, []);
  check("up-to-date case flagged", clean.includes("up to date"));
}

/* ----------------------------- last-mission refs ----------------------------- */

section("ordinalIndex");
check("'the second one' → 2", ordinalIndex("open the second one") === 2);
check("'the 1st' → 1", ordinalIndex("send the 1st") === 1);
check("'third' → 3", ordinalIndex("compare the third") === 3);
check("no ordinal", ordinalIndex("open the site") === null);

section("isMissionFollowup");
check("'open the second one'", isMissionFollowup("open the second one"));
check("'compare it with the first'", isMissionFollowup("compare it with the first"));
check("'find its repo'", isMissionFollowup("find its repo"));
check("'send the third to telegram'", isMissionFollowup("send the third to telegram"));
check("'from the results, which is best?'", isMissionFollowup("from the results, which one is cheapest"));
check("'the last mission was great'", isMissionFollowup("summarize the last mission"));
check("plain 'open the settings panel' is NOT a follow-up", !isMissionFollowup("open the settings panel"));
check("plain 'what's up' is NOT a follow-up", !isMissionFollowup("what's up"));
check("'open my resume.pdf' is NOT a follow-up", !isMissionFollowup("open my resume.pdf"));

section("pickByOrdinal");
{
  const arts = [{ label: "a" }, { label: "b" }, { label: "c" }];
  check("second → b", pickByOrdinal(arts, "open the second one")?.label === "b");
  check("out-of-range clamps to last", pickByOrdinal(arts, "open the ninth one")?.label === "c");
  check("no ordinal → null", pickByOrdinal(arts, "open it") === null);
}

section("detectFollowupAction — open");
check("'open the second one' → open", detectFollowupAction("open the second one").kind === "open");
check("'open it' → open", detectFollowupAction("open it").kind === "open");
check("telegram still wins", detectFollowupAction("send the second one to telegram").kind === "telegram");
check("save still works", detectFollowupAction("save it to a file").kind === "file");

/* ----------------------------- plan integration ----------------------------- */

section("plan — new kinds are known + gated");
for (const kind of ["dev_server_start", "dev_server_stop", "dev_server_status", "file_organize", "repo_inspect"]) {
  check(`${kind} is a known kind`, KNOWN_KINDS.has(kind));
}
check(
  "dev_server_start needs approval",
  planNeedsApproval({ summary: "s", steps: [{ id: "a", kind: "dev_server_start", title: "start", params: {} }] })
);
check(
  "file_organize needs approval",
  planNeedsApproval({ summary: "s", steps: [{ id: "a", kind: "file_organize", title: "tidy", params: {} }] })
);
check(
  "dev_server_status is safe (no approval)",
  !planNeedsApproval({ summary: "s", steps: [{ id: "a", kind: "dev_server_status", title: "status", params: {} }] })
);

section("fallbackPlan — tidy-up proposes a dry run");
{
  const plan = fallbackPlan("my laptop is cluttered with junk files");
  const org = plan.steps.find((s) => s.kind === "file_organize");
  check("file_organize present", !!org);
  check("dryRun defaults true", org?.params.dryRun === true, JSON.stringify(org?.params));
  check("scans all three folders", plan.steps.filter((s) => s.kind === "file_list").length === 3);
}

section("tier routing regressions");
check(
  "Tier 7 'while my project is starting…' → parallel",
  classifyGoal("While my project is starting, research the error I'm currently investigating and find possible solutions.") === "parallel"
);
check(
  "Tier 3 'latest version of my dependencies' → dev_env",
  classifyGoal("Find the latest version of one of my dependencies, check whether I'm using an outdated version, and show me the relevant release notes.") === "dev_env"
);
check(
  "Tier 10 #49 'something on my computer' → organize_files",
  classifyGoal("Find something on my computer that could be improved and take care of it.") === "organize_files"
);
check(
  "machine-ops goals are NOT hijacked by find-and-open",
  heuristicPlan("Find something on my computer that could be improved and take care of it.") === null
);
check(
  "Tier 8 'Now find the documentation.' chains to the last mission",
  isMissionFollowup("Now find the documentation.")
);
check(
  "Tier 8 'Open whichever one is more useful' chains",
  isMissionFollowup("Open whichever one is more useful for Jarvis.")
);
check("'whichever one' is not misread as ordinal 1", ordinalIndex("open whichever one is more useful") === null);
check("'the second one' is still ordinal 2", ordinalIndex("open the second one") === 2);

section("undo routing");
{
  check("classifies as organize_files", classifyGoal("undo the last file tidy-up") === "organize_files", classifyGoal("undo the last file tidy-up"));
  const plan = heuristicPlan("undo the last file tidy-up and put my files back");
  const step = plan?.steps[0];
  check("instant plan is a single step", plan?.steps.length === 1, JSON.stringify(plan?.steps?.map((s) => s.kind)));
  check("it is file_organize with mode undo", step?.kind === "file_organize" && step?.params.mode === "undo", JSON.stringify(step?.params));
  check("undo needs approval", planNeedsApproval(plan!));
  const fb = fallbackPlan("please undo the last tidy-up of my files");
  check("fallback also emits undo", fb.steps.length === 1 && fb.steps[0].params.mode === "undo", JSON.stringify(fb.steps.map((s) => s.params)));
}

section("fallbackPlan — dev-env can start + verify the server");
{
  const plan = fallbackPlan("start my dev server and check if it is running");
  const kinds = plan.steps.map((s) => s.kind);
  check("dev_server_start present", kinds.includes("dev_server_start"), JSON.stringify(kinds));
  check("dev_server_status present", kinds.includes("dev_server_status"));
  check("repo_inspect present", kinds.includes("repo_inspect"));
  const status = plan.steps.find((s) => s.kind === "dev_server_status");
  check("status waits for the start", status?.dependsOn?.includes("d2") === true, JSON.stringify(status?.dependsOn));
}

/* ----------------------------- undo round-trip ----------------------------- */

section("file_organize undo — real files on disk");
{
  // A throwaway tree that mimics a folder AFTER a by-type tidy-up.
  const root = path.join(os.tmpdir(), `jarvis-undo-${Date.now()}`);
  const imagesDir = path.join(root, "Images");
  fs.mkdirSync(imagesDir, { recursive: true });
  const movedPhoto = path.join(imagesDir, "holiday.jpg");
  fs.writeFileSync(movedPhoto, "x");

  recordOrganize({
    folder: "Downloads",
    dir: root,
    mode: "by-type",
    moves: [{ from: path.join(root, "holiday.jpg"), to: movedPhoto }],
  });

  check("record is readable", getLastOrganize()?.moves.length === 1, JSON.stringify(getLastOrganize()));

  const res = undoLastOrganize();
  check("undo reports 1 restored", res.restored === 1 && res.ok, res.message);
  check("file moved back to the original path", fs.existsSync(path.join(root, "holiday.jpg")));
  check("file gone from Images/", !fs.existsSync(movedPhoto));
  check("record cleared after a successful undo", getLastOrganize() === null);

  // A second undo has nothing to do.
  const again = undoLastOrganize();
  check("second undo is a clean no-op", again.ok === false && again.restored === 0, again.message);

  clearLastOrganize();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
