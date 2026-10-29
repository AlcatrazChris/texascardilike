import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for(const file of ['lib/ai-status.mjs','api/ai-status.js','scripts/ai-status.mjs','scripts/verify-deepseek.mjs','scripts/benchmark.mjs','lib/state-codec.mjs','lib/poker.mjs','lib/cards.mjs','lib/ai.mjs','lib/ai-observation.mjs','lib/deepseek.mjs','lib/rooms.mjs','lib/room-store.mjs','lib/local-env.mjs','api/game.js','api/room.js','server.mjs','public/app.js','public/betting.js','public/rooms-client.js','public/game-client.js']) execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
for(const file of ['public/index.html','public/styles.css','public/refinements.css','public/lobby.css','public/table-updates.css','public/table-layout.css','vercel.json']) await readFile(file);
console.log('静态资源与服务端语法检查通过。');
