import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

interface LearningPlan {
  topic: string;
  difficulty: string;
  duration: string;
  lessons: Array<{
    day: number;
    title: string;
    content: string;
    exercises: string[];
  }>;
}

async function generateLearningPlan(
  topic: string,
  difficulty: string,
  durationDays: number
): Promise<LearningPlan> {
  const prompt = `Create a detailed ${durationDays}-day learning plan for ${topic} at ${difficulty} level.

Return JSON in this exact format:
{
  "topic": "${topic}",
  "difficulty": "${difficulty}",
  "duration": "${durationDays} days",
  "lessons": [
    {
      "day": 1,
      "title": "Lesson title",
      "content": "Detailed lesson content (2-3 paragraphs)",
      "exercises": ["Exercise 1", "Exercise 2"]
    }
  ]
}

Include ${durationDays} lessons, one for each day. Make content practical and engaging.`;

  if (!NVIDIA_API_KEY) {
    // Fallback demo mode
    return generateDemoPlan(topic, difficulty, durationDays);
  }

  try {
    const response = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "meta/llama-3.1-8b-instruct",
          messages: [
            {
              role: "system",
              content:
                "You are an expert educator. Create structured learning plans with clear daily lessons and exercises. Return only valid JSON.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 2000,
        }),
      }
    );

    const data = await response.json();
    const content = data.choices[0]?.message?.content || "";

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    throw new Error("Invalid response format");
  } catch (error) {
    console.log("Using demo plan due to error:", error);
    return generateDemoPlan(topic, difficulty, durationDays);
  }
}

function generateDemoPlan(
  topic: string,
  difficulty: string,
  days: number
): LearningPlan {
  const lessons = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    title: `Day ${i + 1}: ${topic} - Module ${i + 1}`,
    content: `This is a demo lesson for ${topic}. In a real scenario, this would contain detailed educational content covering key concepts, examples, and practical applications. Connect your NVIDIA API key for AI-generated personalized lessons.`,
    exercises: [
      `Exercise ${i + 1}.1: Practice ${topic} fundamentals`,
      `Exercise ${i + 1}.2: Apply ${topic} concepts`,
      `Exercise ${i + 1}.3: Review and reflect`,
    ],
  }));

  return {
    topic,
    difficulty,
    duration: `${days} days`,
    lessons,
  };
}

async function generateQuiz(
  topic: string,
  lesson: string,
  numQuestions: number = 5
): Promise<Array<{
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}>> {
  const prompt = `Create a ${numQuestions}-question multiple choice quiz about "${lesson}" in the topic of "${topic}".

Return JSON array in this format:
[
  {
    "question": "Question text?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": 0,
    "explanation": "Why this answer is correct"
  }
]

Make questions challenging but fair. Use 0-based index for correctAnswer.`;

  if (!NVIDIA_API_KEY) {
    return generateDemoQuiz(topic, numQuestions);
  }

  try {
    const response = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "meta/llama-3.1-8b-instruct",
          messages: [
            {
              role: "system",
              content:
                "You create educational quizzes with clear questions and explanations. Return only valid JSON array.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 1500,
        }),
      }
    );

    const data = await response.json();
    const content = data.choices[0]?.message?.content || "";

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    throw new Error("Invalid quiz format");
  } catch (error) {
    return generateDemoQuiz(topic, numQuestions);
  }
}

function generateDemoQuiz(topic: string, numQuestions: number) {
  return Array.from({ length: numQuestions }, (_, i) => ({
    question: `Demo Question ${i + 1}: What is an important concept in ${topic}?`,
    options: [
      "Key concept A (correct)",
      "Incorrect option B",
      "Incorrect option C",
      "Incorrect option D",
    ],
    correctAnswer: 0,
    explanation: `This is a demo explanation for ${topic}. Connect NVIDIA API for AI-generated quizzes with real educational content.`,
  }));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, userId = "default" } = body;

    switch (action) {
      case "create": {
        const { topic, difficulty = "beginner", durationDays = 7 } = body;

        if (!topic) {
          return NextResponse.json(
            { error: "Topic required" },
            { status: 400 }
          );
        }

        const plan = await generateLearningPlan(topic, difficulty, durationDays);

        // Save to database
        try {
          await prisma.skillPlan.create({
            data: {
              userId,
              topic,
              difficulty,
              duration: durationDays,
              plan: JSON.stringify(plan),
              progress: 0,
              currentDay: 1,
            },
          });
        } catch (e) {
          console.log("DB save failed, continuing without persistence:", e);
        }

        return NextResponse.json({
          success: true,
          plan,
          message: `Learning plan created for ${topic}`,
        });
      }

      case "quiz": {
        const { topic, lesson, numQuestions = 5 } = body;

        if (!topic || !lesson) {
          return NextResponse.json(
            { error: "Topic and lesson required" },
            { status: 400 }
          );
        }

        const quiz = await generateQuiz(topic, lesson, numQuestions);

        return NextResponse.json({
          success: true,
          quiz,
          topic,
          lesson,
        });
      }

      case "progress": {
        const { planId, day, completed } = body;

        try {
          const plan = await prisma.skillPlan.findUnique({ where: { id: planId } });
          const totalDays = plan?.duration || 7;
          const updated = await prisma.skillPlan.update({
            where: { id: planId },
            data: {
              currentDay: day,
              progress: Math.round((day / totalDays) * 100),
            },
          });

          return NextResponse.json({
            success: true,
            progress: updated.progress,
            currentDay: updated.currentDay,
          });
        } catch (e) {
          return NextResponse.json({
            success: true,
            demo: true,
            progress: Math.round((day / 7) * 100),
            currentDay: day,
          });
        }
      }

      default:
        return NextResponse.json(
          { error: "Unknown action", available: ["create", "quiz", "progress"] },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Skill trainer error:", error);
    return NextResponse.json(
      { error: "Skill trainer failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") || "default";

  try {
    const plans = await prisma.skillPlan.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      plans: plans.map((p) => ({
        id: p.id,
        topic: p.topic,
        difficulty: p.difficulty,
        progress: p.progress,
        currentDay: p.currentDay,
        createdAt: p.createdAt,
      })),
    });
  } catch (e) {
    return NextResponse.json({
      success: true,
      demo: true,
      plans: [],
      message: "Connect to database to persist learning plans",
    });
  }
}
