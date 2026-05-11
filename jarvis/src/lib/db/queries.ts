import { PrismaClient } from "@prisma/client";

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Simple PrismaClient - DATABASE_URL is read from env automatically
export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Memory queries
export async function getMemories(category?: string, limit: number = 10) {
  return prisma.memory.findMany({
    where: category ? { category } : undefined,
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}

export async function addMemory(
  content: string,
  category: string = "user_fact",
  source: string = "explicit"
) {
  return prisma.memory.create({
    data: {
      content,
      category,
      source,
    },
  });
}

// Conversation queries
export async function getRecentConversations(limit: number = 5) {
  return prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function createConversation(messages: { role: string; content: string }[]) {
  return prisma.conversation.create({
    data: {
      messages: {
        create: messages,
      },
    },
    include: {
      messages: true,
    },
  });
}

// Task queries
export async function getTasks(completed?: boolean) {
  return prisma.task.findMany({
    where: completed !== undefined ? { completed } : undefined,
    orderBy: [
      { completed: "asc" },
      { priority: "asc" },
      { dueDate: "asc" },
    ],
  });
}

export async function createTask(data: {
  title: string;
  description?: string;
  priority?: string;
  category?: string;
  dueDate?: Date;
}) {
  return prisma.task.create({
    data: {
      ...data,
      priority: data.priority || "normal",
    },
  });
}

export async function toggleTaskCompletion(id: string) {
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) return null;
  return prisma.task.update({
    where: { id },
    data: { completed: !task.completed },
  });
}

export async function deleteTask(id: string) {
  return prisma.task.delete({ where: { id } });
}

// Note queries
export async function getNotes(tag?: string) {
  return prisma.note.findMany({
    where: tag ? { tags: { contains: tag } } : undefined,
    orderBy: { updatedAt: "desc" },
  });
}

export async function createNote(data: {
  title: string;
  content: string;
  tags?: string;
}) {
  return prisma.note.create({ data });
}

export async function updateNote(
  id: string,
  data: { title?: string; content?: string; tags?: string }
) {
  return prisma.note.update({
    where: { id },
    data,
  });
}

export async function deleteNote(id: string) {
  return prisma.note.delete({ where: { id } });
}
