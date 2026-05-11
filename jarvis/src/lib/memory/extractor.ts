// Memory Extractor - Extracts entities and relationships from conversations using LLM
// Automatically builds the knowledge graph from user interactions

import { addEntity, addRelationship, findEntityByName, EntityType } from "./graph";

// Entity extraction prompt
const EXTRACTION_PROMPT = `You are a memory extraction AI. Analyze the conversation and extract entities and relationships.

Return a JSON object with this exact structure:
{
  "entities": [
    {
      "name": "Person or thing name",
      "type": "PERSON|COMPANY|PROJECT|CONCEPT|LOCATION|SKILL|PREFERENCE|EVENT",
      "description": "Brief description (optional)",
      "metadata": {"key": "value"} // Non-sensitive data like email, phone
    }
  ],
  "relationships": [
    {
      "source": "Entity name",
      "target": "Entity name",
      "type": "works_at|client_of|knows_about|prefers|friend_of|located_in|interested_in|etc"
    }
  ]
}

Rules:
1. Extract people mentioned as PERSON
2. Extract companies/organizations as COMPANY
3. Extract projects, products, or initiatives as PROJECT
4. Extract concepts, topics, or ideas as CONCEPT
5. Extract places as LOCATION
6. Extract skills or abilities as SKILL
7. Extract user preferences as PREFERENCE (e.g., "prefers dark mode")
8. Extract events as EVENT
9. Create relationships between entities based on context
10. For preferences, create a relationship from "User" to the preference with type "prefers"

Important: Always create a "User" entity representing the user if preferences are mentioned.

Return ONLY the JSON, no explanation. If nothing to extract, return {"entities": [], "relationships": []}`;

interface ExtractedEntity {
  name: string;
  type: EntityType;
  description?: string;
  metadata?: Record<string, string>;
}

interface ExtractedRelationship {
  source: string;
  target: string;
  type: string;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

/**
 * Extract entities and relationships from a conversation message
 */
export async function extractMemoriesFromMessage(
  message: string,
  context?: string
): Promise<ExtractionResult> {
  try {
    const prompt = context
      ? `${EXTRACTION_PROMPT}\n\nContext: ${context}\n\nMessage: ${message}`
      : `${EXTRACTION_PROMPT}\n\nMessage: ${message}`;

    // Use NVIDIA API for extraction (or fallback to local)
    const apiBase = process.env.INTERNAL_API_URL || 'http://localhost:3000';
    const response = await fetch(`${apiBase}/api/openai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3, // Low temperature for consistent extraction
        max_tokens: 1500,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.error("[MemoryExtractor] API error:", response.status);
      return { entities: [], relationships: [] };
    }

    const data = await response.json();
    const content = data.content || data.choices?.[0]?.message?.content;

    if (!content) {
      console.warn("[MemoryExtractor] No content in response");
      return { entities: [], relationships: [] };
    }

    // Parse the JSON response
    try {
      const parsed = JSON.parse(content) as ExtractionResult;
      return {
        entities: parsed.entities || [],
        relationships: parsed.relationships || [],
      };
    } catch (parseError) {
      console.error("[MemoryExtractor] Failed to parse JSON:", parseError);
      return { entities: [], relationships: [] };
    }
  } catch (error) {
    console.error("[MemoryExtractor] Extraction failed:", error);
    return { entities: [], relationships: [] };
  }
}

/**
 * Process extracted entities and add them to the knowledge graph
 */
export async function processExtraction(extraction: ExtractionResult): Promise<{
  addedEntities: string[];
  addedRelationships: string[];
  skipped: string[];
}> {
  const addedEntities: string[] = [];
  const addedRelationships: string[] = [];
  const skipped: string[] = [];

  // First, add all entities
  const entityIdMap = new Map<string, string>(); // name -> id mapping

  for (const entity of extraction.entities) {
    try {
      // Check if entity already exists
      const existing = await findEntityByName(entity.name);
      if (existing) {
        entityIdMap.set(entity.name, existing.id);
        skipped.push(`Entity "${entity.name}" already exists`);
        continue;
      }

      // Add new entity
      const id = await addEntity({
        name: entity.name,
        type: entity.type,
        description: entity.description,
        metadata: entity.metadata,
      });
      entityIdMap.set(entity.name, id);
      addedEntities.push(entity.name);
    } catch (error) {
      console.error("[MemoryExtractor] Failed to add entity:", entity.name, error);
      skipped.push(`Failed to add entity "${entity.name}"`);
    }
  }

  // Then, add relationships
  for (const rel of extraction.relationships) {
    try {
      // Resolve entity names to IDs
      let sourceId = entityIdMap.get(rel.source);
      let targetId = entityIdMap.get(rel.target);

      // If not in our map, try to find in database
      if (!sourceId) {
        const existing = await findEntityByName(rel.source);
        if (existing) {
          sourceId = existing.id;
        } else {
          skipped.push(`Relationship source "${rel.source}" not found`);
          continue;
        }
      }

      if (!targetId) {
        const existing = await findEntityByName(rel.target);
        if (existing) {
          targetId = existing.id;
        } else {
          skipped.push(`Relationship target "${rel.target}" not found`);
          continue;
        }
      }

      // Add relationship
      const id = await addRelationship({
        sourceId,
        targetId,
        type: rel.type,
      });
      addedRelationships.push(`${rel.source} -> ${rel.type} -> ${rel.target}`);
    } catch (error) {
      console.error("[MemoryExtractor] Failed to add relationship:", rel, error);
      skipped.push(`Failed to add relationship "${rel.source} -> ${rel.target}"`);
    }
  }

  return {
    addedEntities,
    addedRelationships,
    skipped,
  };
}

/**
 * High-level function: Extract and store memories from a user message
 */
export async function extractAndStoreMemories(
  userMessage: string,
  conversationContext?: string
): Promise<{
  success: boolean;
  addedEntities: string[];
  addedRelationships: string[];
  message?: string;
}> {
  console.log("[MemoryExtractor] Processing message:", userMessage.substring(0, 100));

  // Extract entities and relationships
  const extraction = await extractMemoriesFromMessage(userMessage, conversationContext);

  if (extraction.entities.length === 0 && extraction.relationships.length === 0) {
    return {
      success: true,
      addedEntities: [],
      addedRelationships: [],
      message: "No new information to learn",
    };
  }

  console.log(
    "[MemoryExtractor] Extracted:",
    extraction.entities.length,
    "entities,",
    extraction.relationships.length,
    "relationships"
  );

  // Process and store in graph
  const result = await processExtraction(extraction);

  const totalAdded = result.addedEntities.length + result.addedRelationships.length;
  if (totalAdded === 0) {
    return {
      success: true,
      addedEntities: [],
      addedRelationships: [],
      message: "Information already known",
    };
  }

  return {
    success: true,
    addedEntities: result.addedEntities,
    addedRelationships: result.addedRelationships,
    message: `Learned ${result.addedEntities.length} new facts and ${result.addedRelationships.length} relationships`,
  };
}

/**
 * Extract specific preference from user statement
 * Example: "I prefer dark mode" -> PREFERENCE entity
 */
export async function extractPreference(
  statement: string
): Promise<{ success: boolean; entityId?: string; message?: string }> {
  const prompt = `Extract the user's preference from this statement.

Return JSON: {"preference": "what they prefer", "category": "ui|behavior|content|other"}

Statement: ${statement}`;

  try {
    const apiBase = process.env.INTERNAL_API_URL || 'http://localhost:3000';
    const response = await fetch(`${apiBase}/api/openai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 200,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      return { success: false, message: "Failed to extract preference" };
    }

    const data = await response.json();
    const content = data.content || data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);

    if (!parsed.preference) {
      return { success: false, message: "No preference found" };
    }

    // Create User entity if it doesn't exist
    let userId = await findEntityByName("User");
    if (!userId) {
      userId = {
        id: await addEntity({
          name: "User",
          type: "PERSON",
          description: "The user of JARVIS",
        }),
        name: "User",
        type: "PERSON" as EntityType,
      };
    }

    // Create preference entity
    const preferenceId = await addEntity({
      name: parsed.preference,
      type: "PREFERENCE",
      category: parsed.category || "other",
    });

    // Create relationship
    await addRelationship({
      sourceId: userId.id,
      targetId: preferenceId,
      type: "prefers",
    });

    return {
      success: true,
      entityId: preferenceId,
      message: `Remembered: User prefers ${parsed.preference}`,
    };
  } catch (error) {
    console.error("[MemoryExtractor] Preference extraction failed:", error);
    return { success: false, message: "Failed to extract preference" };
  }
}
