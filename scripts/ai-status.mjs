import {existsSync} from 'node:fs';
import {loadLocalEnv} from '../lib/local-env.mjs';
import {aiStatus} from '../lib/ai-status.mjs';
loadLocalEnv();
console.log(JSON.stringify({envLocalExists:existsSync('.env.local'),envExists:existsSync('.env'),...aiStatus()},null,2));
