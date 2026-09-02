import { startMusicBot } from "./bot";

void startMusicBot().catch((error) => {
  console.error(error);
  process.exit(1);
});
