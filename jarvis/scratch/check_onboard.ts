import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const ents = await prisma.entity.findMany({ select: { name: true, type: true }, take: 12 });
  console.log("ENTITIES:", ents.map((e) => `${e.name}:${e.type}`).join(" | "));
  console.log("RELATIONSHIPS:", await prisma.relationship.count());
  const marker = await prisma.memory.findFirst({ where: { category: "onboarding" } });
  console.log("MARKER:", marker ? marker.content.slice(0, 140) : "MISSING");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("ERR:", e.message);
    await prisma.$disconnect();
    process.exit(1);
  });
