/** Portable local initialization. No credentials, cloud mutations or real data. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const run=(args)=>{const r=spawnSync(process.execPath,args,{stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);};
run(['scripts/run-framework.mjs','build']);
const generated=JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
const bindings=generated.d1_databases?.map(d=>({...d,migrations_dir:resolve('drizzle')}));
if(!bindings?.length)throw new Error('Binding DB non trovato: controlla .openai/hosting.json.');
mkdirSync('.sites-runtime',{recursive:true});
const config=resolve('.sites-runtime/local-database.json');
writeFileSync(config,JSON.stringify({name:'prima-colazione-local',compatibility_date:generated.compatibility_date,d1_databases:bindings}));
run(['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config',config,'--persist-to','.wrangler/state']);
process.stdout.write('\nAmbiente locale pronto. Avvia con npm run dev.\n');
