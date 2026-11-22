import { NextRequest, NextResponse } from "next/server";
import { planGoal, approveJob, cancelJob, getJob } from "@/services/AgentService";

/**
 * Ghost Worker — real AgentService bridge.
 *
 * POST { action: "start", goal }          → starts a real AgentService mission
 * POST { action: "poll",  workerId }      → returns current job status
 * POST { action: "approve", workerId }    → approves a paused-checkpoint mission
 * POST { action: "cancel",  workerId }    → cancels the mission
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action = "start", goal = "", workerId } = body as {
      action?: string;
      goal?: string;
      workerId?: string;
    };

    // ── START ─────────────────────────────────────────────────────────────
    if (action === "start") {
      if (!goal.trim()) {
        return NextResponse.json({ error: "goal is required" }, { status: 400 });
      }

      // Inject Bengaluru location context if "near me" / "nearby" is requested
      let missionGoal = goal.trim();
      if (/\b(?:near me|nearby|around here|locally)\b/i.test(missionGoal)) {
        missionGoal = missionGoal.replace(/\b(?:near me|nearby|around here|locally)\b/gi, "in Bengaluru");
      }

      // Kick off a real AgentService mission (auto-approve so it runs immediately)
      const job = await planGoal(missionGoal, { autoApprove: true });

      // Derive a human-readable first step label from the plan
      const firstStep = job.plan?.steps?.[0];
      const stepLabel = firstStep?.title ?? job.plan?.summary ?? "Deconstructing goal…";

      return NextResponse.json({
        ok: true,
        workerId: job.id,
        goal: job.goal,
        status: job.status,          // "planning" | "running" | "done" | "failed"
        step: stepLabel,
        progress: job.status === "done" ? 100 : job.status === "failed" ? 0 : 15,
        planSummary: job.plan?.summary ?? "",
        totalSteps: job.plan?.steps?.length ?? 1,
      });
    }

    // ── POLL ──────────────────────────────────────────────────────────────
    if (action === "poll") {
      if (!workerId) return NextResponse.json({ error: "workerId required" }, { status: 400 });

      const job = getJob(workerId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

      const totalSteps = job.plan?.steps?.length ?? 1;
      const doneSteps  = job.results.length;
      const progress   =
        job.status === "done"   ? 100 :
        job.status === "failed" ? 0   :
        Math.round(Math.min(95, (doneSteps / totalSteps) * 100));

      // Find the currently running/most-recent step label
      const lastResult     = job.results[job.results.length - 1];
      const currentStepObj = job.plan?.steps?.find((s) => s.id === lastResult?.stepId)
                          ?? job.plan?.steps?.[doneSteps]
                          ?? job.plan?.steps?.[0];
      const stepLabel = currentStepObj?.title ?? job.plan?.summary ?? "Processing…";

      // Collect any deliverables (artifacts)
      const artifacts = (job.artifacts ?? []).map((a) => ({
        kind:  a.kind,
        label: a.label,
        value: a.value,
      }));

      // Extract textual deliverable from artifacts or step results
      let deliverable = "";
      if (artifacts.length > 0) {
        deliverable = artifacts.map((a) => `${a.label}:\n${a.value}`).join("\n\n");
      }
      if (!deliverable && job.results.length > 0) {
        const textParts: string[] = [];
        for (const res of job.results) {
          if (res.result) {
            if (typeof res.result === "string") {
              textParts.push(res.result);
            } else if (typeof res.result === "object") {
              const r = res.result as any;
              if (r.summary) textParts.push(r.summary);
              else if (r.answer) textParts.push(r.answer);
              else if (r.choice && r.reason) textParts.push(`${r.choice}: ${r.reason}`);
            }
          }
        }
        deliverable = textParts.filter(Boolean).join("\n\n");
      }

      return NextResponse.json({
        ok: true,
        workerId: job.id,
        goal: job.goal,
        status: job.status,
        step: stepLabel,
        progress,
        totalSteps,
        doneSteps,
        needsApproval: job.status === "paused_checkpoint",
        checkpointQuestion: job.status === "paused_checkpoint" && job.plan?.steps
          ? (job.plan.steps.find((s) => s.kind === "checkpoint")?.params?.question as string | undefined)
          : undefined,
        artifacts,
        result: job.status === "done"
          ? deliverable || `Mission complete: "${job.goal}"`
          : undefined,
        error: job.error,
      });
    }

    // ── APPROVE ───────────────────────────────────────────────────────────
    if (action === "approve") {
      if (!workerId) return NextResponse.json({ error: "workerId required" }, { status: 400 });
      const job = await approveJob(workerId);
      return NextResponse.json({ ok: true, workerId: job.id, status: job.status });
    }

    // ── CANCEL ────────────────────────────────────────────────────────────
    if (action === "cancel") {
      if (!workerId) return NextResponse.json({ error: "workerId required" }, { status: 400 });
      const job = await cancelJob(workerId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      return NextResponse.json({ ok: true, workerId: job.id, status: job.status });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[ghost-worker] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
