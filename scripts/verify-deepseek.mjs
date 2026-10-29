import {loadLocalEnv} from '../lib/local-env.mjs';
import {aiStatus,readAIStatus} from '../lib/ai-status.mjs';
import {processGameAsync} from '../api/game.js';
loadLocalEnv();
if(!aiStatus().ready){console.log(JSON.stringify(aiStatus()));process.exitCode=1;}
else{
  // A single real hand initialization exercises the same path as the browser.
  await processGameAsync({command:'start',config:{seats:6}});
  console.log(JSON.stringify(await readAIStatus(),null,2));
}
