import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const config=JSON.parse(await readFile(path.resolve(process.env.SHIFTFLOW_DATA_DIR||'.data','runtime.json'),'utf8'));
const child=spawn('sh',['scripts/engine.sh','uvicorn','backend.api.main:app','--host','127.0.0.1','--port','8000'],{stdio:'inherit',env:{...process.env,SHIFTFLOW_ENGINE_TOKEN:config.engineToken,SHIFTFLOW_ENGINE_REQUIRE_KEY:'1'}});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exit(code??0));
