import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { RESEARCH_PROMPTS } from './ResearchPrompts';

// Use environment variable or default to port 3004 for the API base URL
const API_BASE = process.env.INTERNAL_API_URL || 'http://localhost:3000';

interface ResearchState {
  query: string;
  subQueries: { query: string; goal: string }[];
  collectedFacts: Map<string, string[]>; // URL -> Facts
  visitedUrls: Set<string>;
  iteration: number;
}

class ResearchService {
  private maxIterations = 5;
  private maxPagesPerIteration = 3;

  async startResearch(query: string) {
    console.log(`[Research Service] startResearch CALLED for: ${query}`);
    console.log(`JARVIS: Starting deep research on: ${query}`);

    const state: ResearchState = {
      query,
      subQueries: [],
      collectedFacts: new Map(),
      visitedUrls: new Set(),
      iteration: 0,
    };

    try {
      // 1. Planning Phase
      state.subQueries = await this.generateSubQueries(query);
      console.log("JARVIS: Research plan generated.");

      // 2. Iterative Research Loop
      while (state.iteration < this.maxIterations) {
        state.iteration++;
        console.log(`JARVIS: Research iteration ${state.iteration}/${this.maxIterations}...`);

        for (const subQuery of state.subQueries) {
          const urls = await this.discoverUrls(subQuery.query);

          for (const url of urls.slice(0, this.maxPagesPerIteration)) {
            if (state.visitedUrls.has(url)) continue;

            console.log(`JARVIS: Extracting data from ${url}...`);
            const content = await this.scrapePage(url);
            const facts = await this.extractFacts(content, query);

            if (facts && facts.length > 0) {
              const existing = state.collectedFacts.get(url) || [];
              state.collectedFacts.set(url, [...existing, ...facts]);
            }
            state.visitedUrls.add(url);
          }
        }
      }

      // 3. Synthesis Phase
      const finalReport = await this.synthesizeReport(query, state.collectedFacts);

      // 4. Delivery to Notion
      await this.deliverToNotion(query, finalReport);

      // 5. Final Notification
      await this.sendCompletionNotification(query);

    } catch (e) {
      console.error("JARVIS: Research pipeline failed:", e);
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
      const firecrawlKey = process.env.FIRECRAWL_API_KEY;
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
