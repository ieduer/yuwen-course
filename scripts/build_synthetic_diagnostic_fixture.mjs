import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dialogueConclusionSchema} from '../site/dialogue-conclusion-schema.js';
import {fullMaterialize,recoveryPrompt,CASE23_SCHEMA_RECOVERY} from '../site/dialogue-full-language.js';
import packet from '../site/dialogue-full-language-packet.json' with {type:'json'};
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
export function schemaStructure(value){
 if(Array.isArray(value))return value.map(schemaStructure);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='enum'?v.map(x=>typeof x):schemaStructure(v)]));
 return value;
}
export function makeSyntheticFixture(){
 // Public source repository + explicitly synthetic calibration packet only.
 // No learner database, historical POST body, secret or external service is read.
 const spec=packet.cases.find(x=>x.id==='conclusion-grounded-dissent');
 const curriculum=JSON.parse(fs.readFileSync(new URL('../site/dialogue-curriculum/lesson-1717-p2.json',import.meta.url)));
 const original=fullMaterialize(spec,curriculum);original.prompt=recoveryPrompt(original.prompt,CASE23_SCHEMA_RECOVERY,original);
 const schema=dialogueConclusionSchema(original);assert.equal(sha(schema),CASE23_SCHEMA_RECOVERY.responseSchemaDigest);
 let enumIndex=0;
 const synthetic=x=>Array.isArray(x)?x.map(synthetic):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,k==='enum'?v.map(()=>`SYNTHETIC_VALUE_${++enumIndex}`):synthetic(v)])):x;
 const responseJsonSchema=synthetic(schema),prompt='Synthetic compatibility diagnostic only. There is no student, lesson assessment, or historical answer in this request. Return JSON with reply "Synthetic diagnostic only" and assessments []. Optional fields may be omitted. Do not invent an assessment.';
 assert.deepEqual(schemaStructure(responseJsonSchema),schemaStructure(schema));
 const payload={stream:true,providerAttemptLimit:1,model:'gemini-3.8-flash',contents:[{role:'user',parts:[{text:prompt}]}],taskType:'chat',thinkingLevel:'low',generationConfig:{temperature:0.3,maxOutputTokens:2400,responseMimeType:'application/json',responseJsonSchema}};
 const provenance={version:'yw-entirely-synthetic-schema-v1',originalSchemaDigest:sha(schema),schemaStructureDigest:sha(schemaStructure(schema)),syntheticSchemaDigest:sha(responseJsonSchema),payloadDigest:sha(payload),enumValuesReplaced:enumIndex,source:'Repository public curriculum and synthetic packet; never student/history data',comparisonLimit:'Schema keywords, nesting, required fields, refs and enum cardinality/types match; enum values/string lengths and payload size intentionally differ. A new response cannot establish the original root cause.'};
 return {version:'yw-single-diagnostic-fixture-v1',syntheticOnly:true,payload,provenance,fixtureSourceDigest:sha({payload,provenance})};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const file=new URL('../site/dialogue-synthetic-diagnostic-fixture.json',import.meta.url),value=makeSyntheticFixture();
 if(process.argv.includes('--check'))assert.deepEqual(JSON.parse(fs.readFileSync(file)),value);
 else fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
 console.log(JSON.stringify({syntheticOnly:true,schemaDigest:value.provenance.syntheticSchemaDigest,structureDigest:value.provenance.schemaStructureDigest,sourceDigest:value.fixtureSourceDigest,enumValuesReplaced:value.provenance.enumValuesReplaced}));
}
