import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  await prisma.watchJob.updateMany({ data: { lastCheckedAt: null } });
  console.log("reset");
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
