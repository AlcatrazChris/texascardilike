import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadLocalEnv} from '../lib/local-env.mjs';
test('自动读取本地配置，系统环境优先且 .env.local 优先于 .env',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'river-env-')),keys=['RIVER_TEST_PRIORITY','RIVER_TEST_LOCAL','RIVER_TEST_BASE'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{process.env.RIVER_TEST_PRIORITY='external';delete process.env.RIVER_TEST_LOCAL;delete process.env.RIVER_TEST_BASE;await writeFile(join(directory,'.env.local'),'RIVER_TEST_PRIORITY=local\nRIVER_TEST_LOCAL=local\n');await writeFile(join(directory,'.env'),'RIVER_TEST_LOCAL=base\nRIVER_TEST_BASE=base\n');loadLocalEnv(directory);assert.equal(process.env.RIVER_TEST_PRIORITY,'external');assert.equal(process.env.RIVER_TEST_LOCAL,'local');assert.equal(process.env.RIVER_TEST_BASE,'base');}
  finally{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}for(const file of ['.env.local','.env'])await unlink(join(directory,file));await rmdir(directory);}
});
