import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index";
import { knowledgeBases, users } from "../src/db/schema";

const DEV_EMAIL = "dev@local.rag";

async function main() {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, DEV_EMAIL))
    .limit(1);

  let userId = existing?.id;
  if (!userId) {
    const [row] = await db
      .insert(users)
      .values({ email: DEV_EMAIL })
      .returning({ id: users.id });
    userId = row!.id;
    console.log("Usuario de desarrollo creado:", DEV_EMAIL, userId);
  } else {
    console.log("Usuario de desarrollo ya existe:", DEV_EMAIL, userId);
  }

  const [kbExisting] = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.userId, userId))
    .limit(1);

  if (kbExisting) {
    console.log("Base de conocimiento:", kbExisting.name, kbExisting.id);
    return;
  }

  const [kb] = await db
    .insert(knowledgeBases)
    .values({ userId, name: "Personal" })
    .returning({ id: knowledgeBases.id });
  console.log("Base de conocimiento creada: Personal", kb!.id);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
