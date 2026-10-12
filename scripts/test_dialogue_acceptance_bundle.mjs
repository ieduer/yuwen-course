import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

test('actual acceptance upload bundle has only the synthetic DB and reviewed identity/APIS bindings',async()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const temp=mkdtempSync(path.join(os.tmpdir(),'yw-acceptance-bundle-'));
  try{
    const config=readFileSync(path.join(root,'wrangler.dialogue-acceptance.example.toml'),'utf8')
      .replace('pages_build_output_dir = ".acceptance/site"',`pages_build_output_dir = "${path.join(root,'.acceptance/site')}"`)
      .replace('migrations_dir = "migrations"',`migrations_dir = "${path.join(root,'migrations')}"`);
    writeFileSync(path.join(temp,'wrangler.toml'),config);
    const outfile=path.join(temp,'worker.bundle');
    execFileSync(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),
      'pages','functions','build','--project-directory',temp,'--build-output-directory',path.join(root,'.acceptance/site'),
      '--build-metadata-path',path.join(temp,'build.json'),'--outfile',outfile],{
      cwd:temp,timeout:30000,stdio:'pipe',env:{...process.env,TMPDIR:temp,PAGES_ENVIRONMENT:'production',
        WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:path.join(temp,'wrangler.log'),CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'},
    });
    const bytes=readFileSync(outfile),boundary=bytes.toString().split('\r\n',1)[0].slice(2);
    const form=await new Response(bytes,{headers:{'content-type':`multipart/form-data; boundary=${boundary}`}}).formData();
    const raw=form.get('metadata'),metadata=JSON.parse(typeof raw==='string'?raw:await raw.text());
    const bindings=metadata.bindings,byName=name=>bindings.find(x=>x.name===name);
    assert.equal(byName('ACCEPTANCE_DB').type,'d1');
    assert.equal(byName('USER_CENTER_EVIDENCE').service,'bdfz-user-center');
    assert.equal(byName('USER_CENTER_EVIDENCE').entrypoint,'YuwenEvidenceIdentity');
    assert.equal(byName('APIS').service,'apis');
    for(const name of ['READING_DB','READING_TEST_SLUG','LEARNING_EVIDENCE_QUEUE','YW_DURABLE_EVALUATION_ENABLED'])assert.equal(byName(name),undefined);
    assert.equal(byName('YW_ACCEPTANCE_USER_ID').text,'0','template must remain unconfigured');
    assert.doesNotMatch(bytes.toString(),/"id":"99c541e7-e70b-4584-b939-7e88a6dd68c5"/);
    const entry=await form.get(metadata.main_module).text();
    assert.match(entry,/createAcceptanceWorker\(/);assert.match(entry,/acceptance_host_required/);
    assert.match(entry,/acceptance_configuration_invalid/);
  }finally{rmSync(temp,{recursive:true,force:true});}
});
