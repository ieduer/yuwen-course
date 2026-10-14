import {dirname} from 'node:path';
import {build} from 'esbuild';

// Match the deployed module graph, including source-owned JSON packets, without
// writing an artifact or asking Miniflare's direct loader to reinterpret JSON.
// source is used only by tests that inject a wrapper around the actual Worker.
export async function bundleWorkerd(scriptPath, source){
 const result=await build({bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*'],logLevel:'silent',
  ...(source===undefined?{entryPoints:[scriptPath]}:{stdin:{contents:source,resolveDir:dirname(scriptPath),sourcefile:scriptPath,loader:'js'}})});
 if(result.outputFiles.length!==1)throw Error('workerd_fixture_requires_one_in_memory_bundle');
 return {modules:true,scriptPath,script:result.outputFiles[0].text};
}
