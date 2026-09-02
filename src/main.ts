import { startMusicBot } from "./bot.js";

void startMusicBot().catch((error) => {
  console.error(error);
  process.exit(1);
});
