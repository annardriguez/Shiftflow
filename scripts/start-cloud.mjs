/** Hosted runtime: persistent external PostgreSQL; no administrator credentials. */
import { spawn } from 'node:child_process';

if(process.env.SHIFTFLOW_CLOUD!=='1') throw new Error('Explicit hosted mode is required.');
for(const name of ['SHIFTFLOW_APP_DATABASE_URL','SHIFTFLOW_AUTH_DATABASE_URL','SHIFTFLOW_AUTH_SECRET','SHIFTFLOW_ENGINE_TOKEN','SHIFTFLOW_PUBLIC_ORIGIN'])
  if(!process.env[name])throw new Error('Missing hosted setting: '+name);
const children=[];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const c of children)c.kill('SIGTERM');setTimeout(()=>process.exit(code),500).unref();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
const engine=spawn('sh',['scripts/engine.sh','uvicorn','backend.api.main:app','--host','127.0.0.1','--port','8000'],{stdio:'inherit',env:{...process.env,SHIFTFLOW_ENGINE_REQUIRE_KEY:'1'}});
children.push(engine);engine.on('exit',code=>stop(code||1));
let ready=false;
for(let i=0;i<60;i++){
  try{if((await fetch('http://127.0.0.1:8000/health')).ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,500));
}
if(!ready){stop(1);throw new Error('Scheduling engine failed readiness.');}
const web=spawn('node',['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port',process.env.PORT||'3000'],{stdio:'inherit',env:process.env});
children.push(web);web.on('exit',code=>stop(code||0));
