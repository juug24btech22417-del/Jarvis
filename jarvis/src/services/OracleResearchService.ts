import axios from 'axios';
import { RESEARCH_PROMPTS } from './ResearchPrompts';
import {
  ResearchStatus,
  ReportType,
  ReportBlock,
  StructuredReport,
  ComparisonTrack,
} from './ResearchTypes';
import { structuredToNotionBlocks, structuredToMarkdown } from './StructuredReportConverters';

const API_BASE = process.env.INTERNAL_API_URL || 'http://localhost:3000';

const DEPTH_SETTINGS = {
  quick:    { iterations: 1, pagesPerQuery: 2 },
  standard: { iterations: 3, pagesPerQuery: 3 },
  deep:     { iterations: 5, pagesPerQuery: 5 },
};

/**
 * LLMs frequently wrap JSON in markdown fences ("```json ... ```") or
 * add a one-line preamble ("The user wants me to compare..."). Node's
 * JSON.parse throws on any of that. This helper strips fences, finds
 * the first balanced {...} or [...] block, and parses it. Falls back
 * to a safe empty object on failure so callers can degrade gracefully.
 */
function parseJsonLoose(text: string): any {
  if (!text) return {};
  let t = text.trim();
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // If the string starts with prose, find the first JSON opener.
  const firstBrace = t.search(/[\{\[]/);
  if (firstBrace > 0) t = t.slice(firstBrace);
  // Trim trailing junk after the last matching close-brace.
  const lastBrace = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (lastBrace > 0 && lastBrace < t.length - 1) t = t.slice(0, lastBrace + 1);
  try {
    return JSON.parse(t);
  } catch {
    return {};
  }
}

/**
 * Internal state for an in-flight task. Kept separate from the public
 * ResearchStatus shape so the engine can carry Maps and per-track
 * data without serializing it on every poll.
 */
interface TaskInternal {
  status: ResearchStatus;
  // For comparison reports, per-subject research state.
  tracks: Map<string, ComparisonTrack>;
  // For single-track: a single combined fact map.
  collectedFacts: Map<string, string[]>;
  // Set of URLs we've already visited (shared across tracks).
  visitedUrls: Set<string>;
  // Optional: id of the parent report for follow-ups.
  parentReportId?: string;
  // Optional: Telegram chat_id that requested this research.
  telegramChatId?: number;
}

class OracleResearchService {
  private tasks = new Map<string, TaskInternal>();

  getStatus(id: string): ResearchStatus | undefined {
    return this.tasks.get(id)?.status;
  }

  getAllTasks(): ResearchStatus[] {
    return Array.from(this.tasks.values()).map((t) => t.status);
  }

  private addLog(
    task: ResearchStatus,
    message: string,
    progress?: number,
    status?: ResearchStatus["status"]
  ) {
    const ts = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    task.logs.push(`[${ts}] ${message}`);
    // Cap log buffer at 200 lines to keep payloads small.
    if (task.logs.length > 200) task.logs.splice(0, task.logs.length - 200);
    if (progress !== undefined) task.progress = progress;
    if (status !== undefined) task.status = status;
    console.log(`[Oracle ${task.id}] ${message} (${task.progress}%)`);
  }

  /**
   * Public entrypoint. Classifies the query, plans accordingly, runs
   * the research, persists to Notion, and updates the in-memory status
   * object that the panel polls.
   */
  async startOracleResearch(opts: {
    id: string;
    query: string;
    reportType?: ReportType;
    depth?: 'quick' | 'standard' | 'deep';
    parentReportId?: string;
    /** Telegram chat_id that requested this research — used to deliver the final report. */
    telegramChatId?: number;
  }) {
    const { id, query, depth = 'standard', parentReportId } = opts;

    // Register the task BEFORE any await so the polling client can see
    // it immediately. We seed it with the query and a "planning" status
    // and fill in the rest (type, subjects) once classification completes.
    const status: ResearchStatus = {
      id,
      query,
      reportType: opts.reportType || 'deep_research',
      status: 'planning',
      progress: 5,
      logs: [`[${new Date().toLocaleTimeString()}] Initializing Oracle Research Engine...`],
      subjects: [],
      subQueries: [],
      visitedUrls: [],
      extractedFactsCount: 0,
      tracks: [],
      parentReportId,
    };
    const internal: TaskInternal = {
      status,
      tracks: new Map(),
      collectedFacts: new Map(),
      visitedUrls: new Set(),
      parentReportId,
      telegramChatId: opts.telegramChatId,
    };
    this.tasks.set(id, internal);

    // Step 1: classify. If the caller didn't specify a type, ask the LLM.
    let reportType: ReportType = opts.reportType || 'deep_research';
    let subjects: string[] = [];
    try {
      const inferred = opts.reportType
        ? { type: opts.reportType, subjects: [] as string[] }
        : await this.classifyQuery(query);
      reportType = inferred.type;
      subjects = inferred.subjects || [];
      // Update the public status with the resolved type/subjects so
      // the panel can show the right chrome as soon as classification
      // completes.
      status.reportType = reportType;
      status.subjects = subjects;
      console.log(
        `[Oracle ${id}] Classified as ${reportType}${
          subjects.length ? ' subjects=' + subjects.join(', ') : ''
        }`
      );
    } catch (e) {
      console.error(`[Oracle ${id}] Classification failed, defaulting to deep_research`, e);
      reportType = 'deep_research';
      status.reportType = reportType;
    }

    try {
      // Step 2: plan
      this.addLog(status, `Report type: ${reportType}. Generating research plan...`, 10, 'planning');

      if (reportType === 'comparison' && subjects.length === 0) {
        // The classifier failed to extract subjects; ask the LLM again
        // with the full query and force a comparison.
        const forced = await this.classifyQuery(query, true);
        subjects = forced.subjects;
        status.subjects = subjects;
      }

      if (reportType === 'comparison') {
        // Multi-track plan: one sub-plan per subject, all run in parallel.
        if (subjects.length === 0) {
          throw new Error(
            'Comparison report needs at least one named subject. Try "compare A and B".'
          );
        }
        for (const subject of subjects) {
          const track: ComparisonTrack = {
            subject,
            status: 'pending',
            progress: 0,
            subQueries: [],
            visitedUrls: [],
            factsCount: 0,
            facts: new Map(),
          };
          internal.tracks.set(subject, track);
          status.tracks.push(track);
        }
        this.addLog(status, `Spawning ${subjects.length} parallel research tracks...`, 15);

        // Plan each track (one LLM call per subject) and run them concurrently.
        const trackEntries = Array.from(internal.tracks.entries());
        await Promise.all(
          trackEntries.map(async ([subject, track], i) => {
            try {
              track.subQueries = await this.generateSubQueries(
                query,
                subject,
                'comparison'
              );
              this.addLog(
                status,
                `Track ${i + 1} (${subject}): planned ${track.subQueries.length} sub-queries`,
                18 + i
              );
              await this.runTrack(
                internal,
                track,
                query,
                depth,
                (msg, prog) => this.addLog(status, `Track ${i + 1} (${subject}): ${msg}`, prog)
              );
              track.status = 'completed';
              track.progress = 100;
            } catch (e: any) {
              track.status = 'failed';
              this.addLog(
                status,
                `Track ${i + 1} (${subject}) failed: ${e?.message || String(e)}`,
                status.progress
              );
            }
          })
        );

        // Recompute top-level progress now that all tracks are done.
        status.progress = 80;
        status.visitedUrls = Array.from(internal.visitedUrls);
        status.subQueries = trackEntries.flatMap(([, t]) => t.subQueries);
        status.extractedFactsCount = trackEntries.reduce(
          (sum, [, t]) => sum + t.factsCount,
          0
        );

        // Step 3: synthesize structured comparison report.
        this.addLog(status, `Synthesizing structured comparison report...`, 82, 'synthesizing');
        const structured = await this.synthesizeComparison(query, subjects, internal);
        status.structuredReport = structured;
        status.reportMarkdown = structuredToMarkdown(structured);
      } else {
        // Single-track plan.
        const subQueries: any[] = await this.generateSubQueries(query, undefined, reportType);
        status.subQueries = subQueries;
        if (subQueries.length === 0) {
          throw new Error('Failed to generate research plan.');
        }
        this.addLog(status, `Generated ${subQueries.length} sub-queries.`, 20, 'searching');

        // Run the original iterative crawl loop.
        const depthSettings = DEPTH_SETTINGS[depth];
        const maxIterations = depthSettings.iterations;
        const maxPagesPerIteration = depthSettings.pagesPerQuery;
        for (let iter = 0; iter < maxIterations; iter++) {
          const iterBase = 20 + Math.floor(iter * (50 / maxIterations));
          this.addLog(status, `Research cycle ${iter + 1}/${maxIterations}...`, iterBase, 'searching');

          // Parallelize sub-queries within this iteration. Each sub-query
          // fans out across its top pages in parallel too.
          const results = await Promise.allSettled(
            subQueries.map(async (sq) => {
              this.addLog(status, `Searching: "${sq.query}"`, iterBase + 2);
              const urls = await this.discoverUrls(sq.query);
              const targets = urls.slice(0, maxPagesPerIteration);
              this.addLog(
                status,
                `Found ${urls.length} sources, analyzing top ${targets.length}...`,
                iterBase + 4
              );

              const pageResults = await Promise.allSettled(
                targets.map(async (url) => {
                  if (internal.visitedUrls.has(url)) return { url, facts: [] as string[] };
                  const domain = new URL(url).hostname.replace('www.', '');
                  this.addLog(status, `Scraping ${domain}...`, iterBase + 5, 'scraping');
                  const content = await this.scrapePage(url);
                  if (!content) {
                    this.addLog(status, `⚠️ Empty content from ${domain}`, iterBase + 6);
                    return { url, facts: [] as string[] };
                  }
                  this.addLog(status, `Extracting facts from ${domain}...`, iterBase + 7);
                  const facts = await this.extractFacts(content, query);
                  internal.visitedUrls.add(url);
                  if (facts.length) {
                    this.addLog(status, `✅ ${facts.length} facts from ${domain}`, iterBase + 9);
                  } else {
                    this.addLog(status, `No relevant facts on ${domain}.`, iterBase + 9);
                  }
                  return { url, facts };
                })
              );

              const out: Array<{ url: string; facts: string[] }> = [];
              for (const r of pageResults) {
                if (r.status === 'fulfilled' && r.value.facts.length) out.push(r.value);
              }
              return out;
            })
          );

          for (const r of results) {
            if (r.status !== 'fulfilled') continue;
            for (const { url, facts } of r.value) {
              const existing = internal.collectedFacts.get(url) || [];
              internal.collectedFacts.set(url, [...existing, ...facts]);
              status.extractedFactsCount += facts.length;
            }
          }
          status.visitedUrls = Array.from(internal.visitedUrls);
        }

        // Synthesize structured report for the inferred type.
        this.addLog(status, `Synthesizing ${reportType} report...`, 75, 'synthesizing');
        const structured = await this.synthesizeStructured(query, reportType, internal);
        status.structuredReport = structured;
        status.reportMarkdown = structuredToMarkdown(structured);
      }

      // Step 4: persist to Notion (structured blocks if available).
      this.addLog(status, `Delivering to Notion...`, 92, 'synthesizing');
      const notionUrl = await this.deliverToNotion(
        query,
        status.reportMarkdown || '',
        status.structuredReport,
        reportType
      );
      status.notionUrl = notionUrl;

      // Step 5: persist the report row + completion notification.
      if (notionUrl) {
        this.addLog(status, `Research complete. Auto-saved to Notion.`, 100, 'completed');
      } else {
        this.addLog(
          status,
          `Research complete. Notion auto-save failed (see server logs); the report is still available here.`,
          100,
          'completed'
        );
      }
      await this.persistReport(status);
      await this.sendCompletionNotification(query, reportType, false, status.reportMarkdown, internal.telegramChatId);
    } catch (e: any) {
      console.error(`[Oracle ${id}] pipeline failed:`, e);
      this.addLog(status, `🚨 Error: ${e?.message || String(e)}`, status.progress, 'failed');
      // Persist the failed row so the user can find it in history.
      try {
        await this.persistReport(status);
      } catch (pe) {
        console.error(`[Oracle ${id}] failed to persist error row:`, pe);
      }
      await this.sendCompletionNotification(query, reportType, true, undefined, internal.telegramChatId);
    }
  }

  private async runTrack(
    internal: TaskInternal,
    track: ComparisonTrack,
    overallQuery: string,
    depth: 'quick' | 'standard' | 'deep',
    log: (msg: string, prog?: number) => void
  ) {
    const depthSettings = DEPTH_SETTINGS[depth];
    const maxIterations = depthSettings.iterations;
    const maxPagesPerIteration = depthSettings.pagesPerQuery;

    for (let iter = 0; iter < maxIterations; iter++) {
      // Run all sub-queries in this iteration in parallel — they hit
      // different URLs, so the search+scrape+extract chain is safe to
      // fan out. Per-track state mutations are serialized back into the
      // shared track object after all sub-queries complete.
      const results = await Promise.allSettled(
        track.subQueries.map(async (sq) => {
          log(`Searching: "${sq.query}"`, track.progress);
          const urls = await this.discoverUrls(sq.query);
          const targets = urls.slice(0, maxPagesPerIteration);
          log(`Found ${urls.length} sources, analyzing top ${targets.length}...`, track.progress);

          const pageResults = await Promise.allSettled(
            targets.map(async (url) => {
              if (internal.visitedUrls.has(url)) return { url, facts: [] as string[] };
              const domain = new URL(url).hostname.replace('www.', '');
              log(`Scraping ${domain}...`, track.progress);
              const content = await this.scrapePage(url);
              if (!content) return { url, facts: [] as string[] };

              log(`Extracting facts from ${domain}...`, track.progress);
              const facts = await this.extractFacts(content, overallQuery);
              internal.visitedUrls.add(url);
              if (facts.length) {
                log(`✅ ${facts.length} facts from ${domain}`, track.progress);
              }
              return { url, facts };
            })
          );

          // Collect all facts and unique URLs from the settled page results.
          const collectedFacts: Array<{ url: string; facts: string[] }> = [];
          for (const r of pageResults) {
            if (r.status === 'fulfilled' && r.value.facts.length) {
              collectedFacts.push(r.value);
            }
          }
          return collectedFacts;
        })
      );

      // Apply collected results to the shared track state.
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        for (const { url, facts } of r.value) {
          const existing = track.facts.get(url) || [];
          track.facts.set(url, [...existing, ...facts]);
          track.factsCount += facts.length;
        }
        track.progress = Math.min(75, track.progress + 5);
      }
      track.visitedUrls = Array.from(internal.visitedUrls);
    }
  }

  private async classifyQuery(query: string, forceComparison = false) {
    const prompt = forceComparison
      ? `${RESEARCH_PROMPTS.CLASSIFIER}\n\nThis is almost certainly a comparison. Force type "comparison" and extract the subjects.\n\nQuery: ${query}\n\nReturn ONLY JSON: { "type": "comparison", "subjects": ["s1", "s2"], "reasoning": "..." }`
      : `${RESEARCH_PROMPTS.CLASSIFIER}\n\nQuery: ${query}\n\nReturn ONLY JSON: { "type": "...", "subjects": ["..."], "reasoning": "..." }`;

    try {
      const res = await axios.post(`${API_BASE}/api/research-llm`, { prompt });
      const content = res.data.content || '';
      const parsed = parseJsonLoose(content);
      return {
        type: (parsed.type || 'deep_research') as ReportType,
        subjects: Array.isArray(parsed.subjects) ? parsed.subjects : [],
        reasoning: parsed.reasoning || '',
      };
    } catch (e: any) {
      console.error('[Oracle] Classification failed:', e?.message);
      return { type: 'deep_research' as ReportType, subjects: [] as string[] };
    }
  }

  private async generateSubQueries(
    query: string,
    subject: string | undefined,
    reportType: ReportType
  ) {
    try {
      const prompt =
        reportType === 'comparison' && subject
          ? `${RESEARCH_PROMPTS.COMPARISON_PLANNER.replace('{SUBJECT}', subject).replace(
              '{QUERY}',
              query
            )}\n\nReturn ONLY JSON: { "queries": [{ "query": "string", "goal": "string" }] }`
          : `${RESEARCH_PROMPTS.PLANNER}\n\nQuery: ${query}\n\nReturn ONLY JSON: { "queries": [{ "query": "string", "goal": "string" }] }`;

      const res = await axios.post(`${API_BASE}/api/research-llm`, { prompt });
      const content = res.data.content || '';
      const parsed = parseJsonLoose(content);
      return Array.isArray(parsed.queries) ? parsed.queries : [];
    } catch (e: any) {
      console.error('[Oracle] Plan generation failed:', e?.message);
      return [];
    }
  }

  private async discoverUrls(query: string): Promise<string[]> {
    try {
      const res = await axios.get(`${API_BASE}/api/search`, { params: { q: query } });
      const urls = res.data.results?.map((r: any) => r.url).filter(Boolean) || [];
      console.log(`[Oracle] discoverUrls("${query}") → ${urls.length} urls`);
      return urls;
    } catch (e: any) {
      console.error(`[Oracle] URL discovery failed for "${query}":`, e?.message || e);
      return [];
    }
  }

  private async scrapePage(url: string): Promise<string> {
    try {
      const firecrawlKey = process.env.FIRAWL_API_KEY || process.env.FIRECRAWL_API_KEY;
      if (firecrawlKey) {
        const { firecrawlService } = await import('./FirecrawlService');
        const result = await firecrawlService.scrapeUrl(url);
        if (result.success && result.markdown) return result.markdown;
      }
    } catch (e) {
      console.warn('[Oracle] Firecrawl failed, falling back:', e);
    }
    try {
      const res = await axios.post(`${API_BASE}/api/scrape`, { url });
      return res.data.content || res.data.text || '';
    } catch (e) {
      console.error('[Oracle] Scrape failed:', e);
      return '';
    }
  }

  /**
   * Single LLM call wrapper for the synthesis steps. Centralized so we
   * can retry on parse failure without duplicating the axios call.
   * Returns whatever `parseFn` extracted from the raw response — caller
   * decides if the shape is good enough.
   */
  private async callSynthLlm(prompt: string, parseFn: (raw: string) => any): Promise<any> {
    const res = await axios.post(`${API_BASE}/api/research-llm`, {
      prompt,
      maxTokens: 4000,
      temperature: 0.1,
    });
    const raw = res.data.content || '';
    console.log(
      `[Oracle] synth call: provider=${res.data.provider} model=${res.data.model} rawLen=${raw.length}`
    );
    return parseFn(raw);
  }

  private async extractFacts(content: string, query: string): Promise<string[]> {
    try {
      const res = await axios.post(`${API_BASE}/api/research-llm`, {
        prompt: `${RESEARCH_PROMPTS.RESEARCHER}\n\nQuery: ${query}\n\nContent: ${content.substring(0, 8000)}\n\nReturn ONLY JSON: { "facts": ["fact 1", "fact 2"] }`,
        maxTokens: 1500,
        temperature: 0.1,
      });
      const parsed = parseJsonLoose(res.data.content || '');
      return Array.isArray(parsed.facts) ? parsed.facts : [];
    } catch (e) {
      console.error('[Oracle] Fact extraction failed:', e);
      return [];
    }
  }

  private async synthesizeComparison(
    query: string,
    subjects: string[],
    internal: TaskInternal
  ): Promise<StructuredReport> {
    // Build a per-subject facts dump so the synthesizer can see who-said-what.
    // Cap each fact at 400 chars and total dump at ~16k chars so the
    // prompt doesn't blow past the LLM's context window — a 30k+ char
    // input causes truncation and an unparseable response.
    const perSubjectData: string[] = [];
    const MAX_TOTAL = 16000;
    const MAX_FACT = 400;
    let totalLen = 0;
    for (const [subject, track] of internal.tracks.entries()) {
      if (totalLen >= MAX_TOTAL) break;
      const dump: string[] = [`=== ${subject} ===`];
      const perSubjCap = Math.floor(MAX_TOTAL / Math.max(1, internal.tracks.size));
      let subLen = dump[0].length;
      const allFacts: Array<[string, string]> = [];
      track.facts.forEach((facts, url) => {
        facts.forEach((f) => allFacts.push([url, f.length > MAX_FACT ? f.slice(0, MAX_FACT) + '…' : f]));
      });
      for (const [url, fact] of allFacts) {
        const line = `  - ${fact} (${url})`;
        if (subLen + line.length > perSubjCap) break;
        dump.push(line);
        subLen += line.length;
      }
      perSubjectData.push(dump.join('\n'));
      totalLen += subLen;
    }
    const aggregated = perSubjectData.join('\n\n');
    const prompt = `${RESEARCH_PROMPTS.COMPARISON_SYNTHESIZER.replace(
      '{QUERY}',
      query
    ).replace('{SUBJECTS}', subjects.join(', '))}\n\nAggregated facts:\n${aggregated}`;
    console.log(`[Oracle] Comparison synth prompt built: totalChars=${aggregated.length} subjects=${subjects.join('+')}`);

    try {
      let parsed: any = await this.callSynthLlm(prompt, raw => {
        console.log(`[Oracle] Comparison synth: rawLen=${raw.length}`);
        return parseJsonLoose(raw);
      });
      // Retry once with a corrective prompt if the model didn't return valid JSON.
      if (!parsed || !Array.isArray(parsed.blocks) || parsed.blocks.length === 0) {
        console.warn('[Oracle] Comparison synth first attempt returned no blocks, retrying…');
        const retryPrompt = `Your previous output was not valid JSON. Output ONLY the raw JSON object — no commentary, no markdown fences, no preamble. Start with "{" and end with "}".\n\n${prompt}`;
        parsed = await this.callSynthLlm(retryPrompt, parseJsonLoose);
      }
      // If the retry also failed, at least give the user the raw facts as
      // a paragraph block so the structured view isn't empty.
      let blocks = normalizeBlocks(parsed.blocks || []);
      if (blocks.length === 0) {
        console.warn('[Oracle] Comparison synth: no blocks after retry, using raw facts');
        const rawFactsBlock = buildRawFactsFallback(internal);
        blocks = rawFactsBlock;
      }
      return {
        summary: parsed.summary || 'Comparison complete.',
        blocks,
      };
    } catch (e: any) {
      console.error('[Oracle] Comparison synthesis failed:', e);
      return {
        summary: `I gathered facts on ${subjects.join(' and ')} but the synthesizer step failed: ${e?.message}`,
        blocks: [
          { type: 'heading_1', text: 'Comparison (synthesis failed)' },
          { type: 'paragraph', text: 'See the Sources tab for the raw facts that were collected.' },
        ],
      };
    }
  }

  private async synthesizeStructured(
    query: string,
    reportType: ReportType,
    internal: TaskInternal
  ): Promise<StructuredReport> {
    let aggregated = '';
    const MAX_TOTAL = 16000;
    const MAX_FACT = 400;
    internal.collectedFacts.forEach((facts, url) => {
      if (aggregated.length >= MAX_TOTAL) return;
      const trimmed = facts
        .map((f) => (f.length > MAX_FACT ? f.slice(0, MAX_FACT) + '…' : f))
        .join(' | ');
      const line = `\nSource: ${url}\nFacts: ${trimmed}\n`;
      if (aggregated.length + line.length > MAX_TOTAL) return;
      aggregated += line;
    });

    const prompt = `${RESEARCH_PROMPTS.STRUCTURED_SYNTHESIZER.replace(
      '{TYPE}',
      reportType
    ).replace('{QUERY}', query)}\n\nAggregated facts:\n${aggregated}`;

    try {
      let parsed: any = await this.callSynthLlm(prompt, parseJsonLoose);
      if (!parsed || !Array.isArray(parsed.blocks) || parsed.blocks.length === 0) {
        console.warn('[Oracle] Structured synth first attempt returned no blocks, retrying…');
        const retryPrompt = `Your previous output was not valid JSON. Output ONLY the raw JSON object — no commentary, no markdown fences, no preamble. Start with "{" and end with "}".\n\n${prompt}`;
        parsed = await this.callSynthLlm(retryPrompt, parseJsonLoose);
      }
      let blocks = normalizeBlocks(parsed.blocks || []);
      if (blocks.length === 0) {
        console.warn('[Oracle] Structured synth: no blocks after retry, using raw facts');
        blocks = buildRawFactsFallback(internal);
      }
      return {
        summary: parsed.summary || 'Research complete.',
        blocks,
      };
    } catch (e: any) {
      console.error('[Oracle] Structured synthesis failed:', e);
      // Fall back to the old flat synthesizer so the user still gets SOMETHING.
      try {
        const res = await axios.post(`${API_BASE}/api/research-llm`, {
          prompt: `${RESEARCH_PROMPTS.SYNTHESIZER}\n\nOriginal Query: ${query}\n\nAggregated Data:\n${aggregated}`,
        });
        const md = res.data.content || '';
        return {
          summary: md.split('\n').slice(0, 3).join(' ').trim() || 'Research complete.',
          blocks: [
            { type: 'heading_1', text: query },
            { type: 'paragraph', text: md },
          ],
        };
      } catch (e2: any) {
        return {
          summary: `Research completed but synthesis failed: ${e2?.message}`,
          blocks: [
            { type: 'heading_1', text: query },
            { type: 'paragraph', text: 'See the Sources tab for the raw facts.' },
          ],
        };
      }
    }
  }

  private async deliverToNotion(
    title: string,
    markdownFallback: string,
    structured: StructuredReport | undefined,
    reportType: ReportType
  ): Promise<string | undefined> {
    try {
      const blocks = structured ? structuredToNotionBlocks(structured) : undefined;
      const body: any = {
        title: `${REPORT_TYPE_TITLES[reportType]}: ${title}`,
        content: markdownFallback,
        tags: ['Oracle', reportType.replace('_', '-')],
      };
      if (blocks && blocks.length > 0) {
        body.blocks = blocks;
      }
      const res = await axios.post(`${API_BASE}/api/notion/create-page`, body);
      const url = res.data?.url || res.data?.pageId;
      console.log(`[Oracle] Notion delivery: url=${url} responseKeys=${Object.keys(res.data || {}).join(',')}`);
      return url;
    } catch (e: any) {
      console.error('[Oracle] Notion delivery failed:', e?.response?.data || e?.message);
      return undefined;
    }
  }

  private async persistReport(status: ResearchStatus) {
    try {
      const body = {
        taskId: status.id,
        query: status.query,
        reportType: status.reportType,
        status: status.status,
        progress: status.progress,
        structuredReport: status.structuredReport,
        reportMarkdown: status.reportMarkdown,
        notionUrl: status.notionUrl,
        subjects: status.subjects,
        factsCount: status.extractedFactsCount,
        sourcesCount: status.visitedUrls.length,
        parentReportId: status.parentReportId,
      };
      await axios.post(`${API_BASE}/api/reports`, body);
    } catch (e: any) {
      console.error('[Oracle] Persist report failed:', e?.message);
    }
  }

  private async sendCompletionNotification(
    query: string,
    reportType: ReportType,
    isError = false,
    reportMarkdown?: string,
    telegramChatId?: number
  ) {
    const shortMsg = isError
      ? `⚠️ Research failed: "${query}" — check the panel for details.`
      : `✅ *${REPORT_TYPE_TITLES[reportType]}* complete!\n\nQuery: _${query}_\n\nFull report saved to Notion. Summary below ↓`;

    // In-app notify (panel banner).
    try {
      await fetch(`${API_BASE}/api/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: shortMsg.replace(/[*_]/g, ''), status: isError ? 'error' : 'success' }),
      });
    } catch (e) {
      console.error('[Oracle] In-app notification failed:', e);
    }

    // Telegram push — deliver the actual markdown report in chunks.
    try {
      const { notifyUser } = await import("@/lib/telegram/notify");
      const targetChatId = telegramChatId ?? null; // null = default first allowed chat

      if (isError) {
        await notifyUser(targetChatId, shortMsg, { fromSource: "oracle-research" });
        return;
      }

      // Send the header message first.
      await notifyUser(targetChatId, shortMsg, { fromSource: "oracle-research" });

      // If we have the markdown report, deliver it in Telegram-safe chunks.
      // Telegram limit is 4096 chars; we use 3800 to leave headroom.
      if (reportMarkdown && reportMarkdown.trim().length > 0) {
        const CHUNK_SIZE = 3800;
        const md = reportMarkdown.trim();
        let offset = 0;
        let chunkIndex = 0;
        while (offset < md.length) {
          // Try to break at a paragraph boundary.
          let end = offset + CHUNK_SIZE;
          if (end < md.length) {
            const boundary = md.lastIndexOf('\n\n', end);
            if (boundary > offset + CHUNK_SIZE * 0.5) end = boundary + 2;
          } else {
            end = md.length;
          }
          const chunk = md.slice(offset, end).trim();
          if (chunk) {
            // Brief delay between chunks to avoid Telegram flood limits.
            if (chunkIndex > 0) await new Promise(r => setTimeout(r, 800));
            await notifyUser(targetChatId, chunk, { fromSource: "oracle-research" });
            chunkIndex++;
          }
          offset = end;
        }
      }
    } catch (e) {
      console.error("[Oracle] Telegram notify failed:", e);
    }
  }
}

const REPORT_TYPE_TITLES: Record<ReportType, string> = {
  comparison: 'Comparison Report',
  deep_research: 'Deep Research',
  news_roundup: 'News Roundup',
  briefing_memo: 'Briefing Memo',
  how_to: 'How-To Guide',
  market_scan: 'Market Scan',
};

/**
 * Normalize LLM-emitted blocks. The LLM sometimes returns blocks that
 * are almost-but-not-quite the right shape (heading_4, table with
 * missing rows, etc). This sanitizes them so the renderer and Notion
 * pipeline can assume valid input.
 */
function normalizeBlocks(raw: any[]): ReportBlock[] {
  const ALLOWED = new Set([
    'heading_1',
    'heading_2',
    'heading_3',
    'paragraph',
    'bulleted_list',
    'numbered_list',
    'table',
    'callout',
    'divider',
  ]);
  const out: ReportBlock[] = [];
  for (const b of raw || []) {
    if (!b || typeof b !== 'object' || !ALLOWED.has(b.type)) continue;
    if (b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3') {
      if (typeof b.text === 'string' && b.text.trim()) {
        out.push({ type: b.type, text: b.text } as ReportBlock);
      }
    } else if (b.type === 'paragraph') {
      if (typeof b.text === 'string' && b.text.trim()) {
        out.push({ type: 'paragraph', text: b.text });
      }
    } else if (b.type === 'bulleted_list' || b.type === 'numbered_list') {
      const items = Array.isArray(b.items)
        ? b.items.filter((i: any) => typeof i === 'string' && i.trim())
        : [];
      if (items.length) out.push({ type: b.type, items } as ReportBlock);
    } else if (b.type === 'table') {
      const rows = Array.isArray(b.rows)
        ? b.rows
            .filter((r: any) => Array.isArray(r))
            .map((r: any[]) => r.map((c: any) => String(c ?? '—')))
        : [];
      if (rows.length) out.push({ type: 'table', rows });
    } else if (b.type === 'callout') {
      if (typeof b.text === 'string' && b.text.trim()) {
        out.push({ type: 'callout', text: b.text, emoji: b.emoji || '💡' });
      }
    } else if (b.type === 'divider') {
      out.push({ type: 'divider' });
    }
  }
  return out;
}

/**
 * When the LLM synthesizer fails to produce structured blocks, surface
 * the raw collected facts as a series of per-subject bulleted lists so
 * the user still sees something useful in the structured view and in
 * the Notion page. Better than "Comparison complete." with nothing else.
 */
function buildRawFactsFallback(internal: TaskInternal): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  blocks.push({
    type: 'callout',
    emoji: '⚠️',
    text: 'The structured synthesizer did not produce a report this time. Showing the raw facts that were gathered.',
  });
  for (const [subject, track] of internal.tracks.entries()) {
    blocks.push({ type: 'heading_2', text: subject });
    const items: string[] = [];
    track.facts.forEach((facts, url) => {
      facts.forEach((f) => items.push(`${f} (source: ${url})`));
    });
    if (items.length === 0) {
      blocks.push({ type: 'paragraph', text: 'No facts were collected for this subject.' });
    } else {
      // Cap to the first 20 facts per subject so the block isn't huge.
      blocks.push({ type: 'bulleted_list', items: items.slice(0, 20) });
      if (items.length > 20) {
        blocks.push({
          type: 'paragraph',
          text: `… and ${items.length - 20} more facts. See the Sources tab for the full list.`,
        });
      }
    }
  }
  return blocks;
}

// Survive Next.js dev-mode hot module reloads. Without this, every
// route recompile creates a fresh OracleResearchService instance and
// any tasks added in a previous instance become invisible to the
// status endpoint.
const globalForOracle = globalThis as unknown as { __oracleService?: OracleResearchService };
if (!globalForOracle.__oracleService) {
  globalForOracle.__oracleService = new OracleResearchService();
}
export const oracleResearchService = globalForOracle.__oracleService;
