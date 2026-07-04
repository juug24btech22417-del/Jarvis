import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { RESEARCH_PROMPTS } from './ResearchPrompts';

// Use environment variable or default to port 3004 for the API base URL
const API_BASE = process.env.INTERNAL_API_URL || 'http://localhost:3000';

export interface ResearchStatus {
  id: string;
  query: string;
  status: "planning" | "searching" | "scraping" | "synthesizing" | "completed" | "failed";
  progress: number; // 0 to 100
  logs: string[];
  subQueries: { query: string; goal: string }[];
  visitedUrls: string[];
  extractedFactsCount: number;
  reportMarkdown?: string;
  notionUrl?: string;
}

interface ResearchState {
  query: string;
  subQueries: { query: string; goal: string }[];
  collectedFacts: Map<string, string[]>; // URL -> Facts
  visitedUrls: Set<string>;
  iteration: number;
}

const DEPTH_SETTINGS = {
  quick:    { iterations: 1, pagesPerQuery: 2 },
  standard: { iterations: 3, pagesPerQuery: 3 },
  deep:     { iterations: 5, pagesPerQuery: 5 },
};

class ResearchService {
  private activeTasks = new Map<string, ResearchStatus>();

  getStatus(id: string): ResearchStatus | undefined {
    return this.activeTasks.get(id);
  }

  getAllTasks(): ResearchStatus[] {
    return Array.from(this.activeTasks.values());
  }

  private addLog(id: string, message: string, progress?: number, status?: ResearchStatus["status"]) {
    const task = this.activeTasks.get(id);
    if (task) {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      task.logs.push(`[${timestamp}] ${message}`);
      if (progress !== undefined) task.progress = progress;
      if (status !== undefined) task.status = status;
      console.log(`[Research ${id}] ${message} (${task.progress}%)`);
    }
  }

  async startResearch(id: string, query: string, depth: 'quick' | 'standard' | 'deep' = 'standard') {
    const { iterations: maxIterations, pagesPerQuery: maxPagesPerIteration } = DEPTH_SETTINGS[depth];
    console.log(`[Research Service] startResearch CALLED for task ${id}: ${query}`);
    
    const task: ResearchStatus = {
      id,
      query,
      status: "planning",
      progress: 5,
      logs: [`[${new Date().toLocaleTimeString()}] Initializing Oracle Deep Research Engine...`],
      subQueries: [],
      visitedUrls: [],
      extractedFactsCount: 0
    };
    this.activeTasks.set(id, task);

    const state: ResearchState = {
      query,
      subQueries: [],
      collectedFacts: new Map(),
      visitedUrls: new Set(),
      iteration: 0,
    };

    try {
      // 1. Planning Phase
      this.addLog(id, `Analyzing topic and generating search vectors...`, 10, "planning");
      state.subQueries = await this.generateSubQueries(query);
      task.subQueries = state.subQueries;
      
      if (state.subQueries.length === 0) {
        throw new Error("Failed to generate research planning queries.");
      }
      
      this.addLog(id, `Generated ${state.subQueries.length} sub-queries for deep investigation.`, 20, "searching");

      // 2. Iterative Research Loop
      while (state.iteration < maxIterations) {
        state.iteration++;
        const iterBaseProgress = 20 + Math.floor((state.iteration - 1) * (50 / maxIterations));
        this.addLog(id, `Starting research cycle ${state.iteration}/${maxIterations}...`, iterBaseProgress, "searching");

        for (let qIndex = 0; qIndex < state.subQueries.length; qIndex++) {
          const subQuery = state.subQueries[qIndex];
          this.addLog(id, `Searching web for: "${subQuery.query}"`, iterBaseProgress + 2);
          const urls = await this.discoverUrls(subQuery.query);

          const targetUrls = urls.slice(0, maxPagesPerIteration);
          this.addLog(id, `Found ${urls.length} resources, analyzing top ${targetUrls.length} links...`, iterBaseProgress + 4);

          for (let uIndex = 0; uIndex < targetUrls.length; uIndex++) {
            const url = targetUrls[uIndex];
            if (state.visitedUrls.has(url)) continue;

            const domain = new URL(url).hostname.replace('www.', '');
            this.addLog(id, `Analyzing content from ${domain}...`, iterBaseProgress + 5, "scraping");
            
            const content = await this.scrapePage(url);
            if (!content) {
              this.addLog(id, `⚠️ Failed to extract text content from ${domain}`, iterBaseProgress + 6);
              continue;
            }

            this.addLog(id, `Extracting facts from ${domain}...`, iterBaseProgress + 7);
            const facts = await this.extractFacts(content, query);

            if (facts && facts.length > 0) {
              const existing = state.collectedFacts.get(url) || [];
              state.collectedFacts.set(url, [...existing, ...facts]);
              
              task.extractedFactsCount += facts.length;
              this.addLog(id, `✅ Extracted ${facts.length} atomic facts from ${domain}.`, iterBaseProgress + 9);
            } else {
              this.addLog(id, `No relevant facts found on ${domain}.`, iterBaseProgress + 9);
            }
            
            state.visitedUrls.add(url);
            task.visitedUrls = Array.from(state.visitedUrls);
          }
        }
      }

      // 3. Synthesis Phase
      this.addLog(id, `Synthesizing report from all gathered evidence...`, 75, "synthesizing");
      const finalReport = await this.synthesizeReport(query, state.collectedFacts);
      task.reportMarkdown = finalReport;

      // 4. Delivery to Notion
      this.addLog(id, `Delivering report to Notion database...`, 90, "synthesizing");
      const notionUrl = await this.deliverToNotion(query, finalReport);
      task.notionUrl = notionUrl || "Notion integration successful";

      // 5. Final Notification
      this.addLog(id, `Deep Research Completed! Synced to Notion.`, 100, "completed");
      await this.sendCompletionNotification(query);

    } catch (e: any) {
      console.error("JARVIS: Research pipeline failed:", e);
      this.addLog(id, `🚨 Error: ${e.message || String(e)}`, 100, "failed");
      await this.sendCompletionNotification(query, true);
    }
  }

  private async sendCompletionNotification(query: string, isError = false) {
    const message = isError
      ? `Boss, I encountered an error while researching "${query}". I'll try to resolve it.`
      : `Research complete, Boss! I've analyzed multiple sources and added the full report for "${query}" to your Notion.`;

    try {
      // System Notification
      await fetch(`${API_BASE}/api/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, status: isError ? "error" : "success" })
      });

      // WhatsApp Notification
      await fetch(`${API_BASE}/api/whatsapp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: "Your_Boss_Number", // This should be dynamically fetched
          message: isError
            ? `⚠️ *Research Error*\n\nBoss, I had some trouble researching "${query}". Check the logs for details.`
            : `✅ *Research Complete*\n\nBoss, I've finished the deep dive on *"${query}"*. The structured report is now waiting for you in Notion! 📚`
        })
      });
    } catch (e) {
      console.error("Completion notification failed", e);
    }
  }

  private async generateSubQueries(query: string) {
    try {
      console.log(`[Research] Requesting plan from: ${API_BASE}/api/research-llm`);
      const res = await axios.post(`${API_BASE}/api/research-llm`, {
        prompt: `You are a research planner. ${RESEARCH_PROMPTS.PLANNER}\n\nQuery: ${query}\n\nReturn ONLY JSON: { "queries": [{ "query": "string", "goal": "string" }] }`
      });

      const content = res.data.content || "";
      const parsed = JSON.parse(content);
      return parsed.queries || [];
    } catch (e: any) {
      console.error(`[Research] Planning failed:`, e.message);
      return [];
    }
  }

  private async discoverUrls(query: string): Promise<string[]> {
    try {
      const res = await axios.post(`${API_BASE}/api/search`, { q: query });
      return res.data.results?.map((r: any) => r.link) || [];
    } catch (e) {
      console.error("[Research] URL discovery failed:", e);
      return [];
    }
  }

  private async scrapePage(url: string): Promise<string> {
    // Try Firecrawl first (much better quality for JS-heavy sites)
    try {
      const firecrawlKey = process.env.FIRAWL_API_KEY || process.env.FIRECRAWL_API_KEY;
      if (firecrawlKey) {
        const { firecrawlService } = await import('./FirecrawlService');
        const result = await firecrawlService.scrapeUrl(url);
        if (result.success && result.markdown) {
          console.log(`[Research] Firecrawl scraped ${url} (${result.markdown.length} chars)`);
          return result.markdown;
        }
      }
    } catch (e) {
      console.warn("[Research] Firecrawl scrape failed, falling back to basic scraper:", e);
    }

    // Fallback to the basic cheerio-based scraper
    try {
      const res = await axios.post(`${API_BASE}/api/scrape`, { url });
      return res.data.content || res.data.text || "";
    } catch (e) {
      console.error("[Research] Page scrape failed:", e);
      return "";
    }
  }

  private async extractFacts(content: string, originalQuery: string): Promise<string[]> {
    try {
      console.log(`[Research] Extracting facts via: ${API_BASE}/api/research-llm`);
      const res = await axios.post(`${API_BASE}/api/research-llm`, {
        prompt: `${RESEARCH_PROMPTS.RESEARCHER}\n\nQuery: ${originalQuery}\n\nContent: ${content.substring(0, 8000)}\n\nReturn ONLY JSON: { "facts": ["fact 1", "fact 2"] }`
      });

      const contentText = res.data.content || "";
      const parsed = JSON.parse(contentText);
      return parsed.facts || [];
    } catch (e: any) {
      console.error(`[Research] Fact extraction failed:`, e.message);
      return [];
    }
  }

  private async synthesizeReport(query: string, factsMap: Map<string, string[]>) {
    let aggregatedData = "";
    factsMap.forEach((facts, url) => {
      aggregatedData += `\nSource: ${url}\nFacts: ${facts.join(" | ")}\n`;
    });

    console.log(`[Research] Synthesizing report via: ${API_BASE}/api/research-llm`);
    const res = await axios.post(`${API_BASE}/api/research-llm`, {
      prompt: `${RESEARCH_PROMPTS.SYNTHESIZER}\n\nOriginal Query: ${query}\n\nAggregated Data:\n${aggregatedData}`
    });
    return res.data.content || "";
  }

  private async deliverToNotion(title: string, content: string) {
    try {
      console.log("[Research] Delivering to Notion via:", `${API_BASE}/api/notion/create-page`);
      const response = await axios.post(`${API_BASE}/api/notion/create-page`, {
        title: `Research Report: ${title}`,
        content: content,
        tags: ["Research", "DeepDive"]
      });
      console.log("[Research] Notion response:", response.data);
      console.log("[Research] Successfully created Notion page:", response.data.url || response.data.pageId);
      return response.data.url || response.data.pageId;
    } catch (e: any) {
      console.error("[Research] Notion delivery failed:", e.message);
      if (e.response?.data) {
        console.error("[Research] Notion API Error Body:", JSON.stringify(e.response.data, null, 2));
      }
      throw e;
    }
  }
}

export const researchService = new ResearchService();
