import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.milestone.findMany({ orderBy: { happenedAt: "desc" } });
  console.log(
    rows.map((m) => `${m.title} [${m.category}] ${m.happenedAt.toISOString().slice(0, 10)}`).join("\n") || "EMPTY"
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("ERR:", e.message);
    await prisma.$disconnect();
    process.exit(1);
  });
