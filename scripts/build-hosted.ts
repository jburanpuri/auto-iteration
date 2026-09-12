import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { feedbackBatchScenarios } from '../src/demo-feedback.js';
export async function buildHosted(productRoot: string, destination = resolve('hosted')) {
  const publicRoot = resolve(destination, 'public');
  await mkdir(resolve(publicRoot,'product'),{recursive:true});
  for(const file of ['index.html','app.mjs','styles.css']) await cp(resolve('examples/reviews',file),resolve(publicRoot,file));
  const html=await readFile(resolve(publicRoot,'index.html'),'utf8');
  await writeFile(resolve(publicRoot,'index.html'),html.replace('http://127.0.0.1:4348/','/product/'));
  for(const file of ['index.html','app.mjs','styles.css','export.mjs']) await cp(resolve(productRoot,file),resolve(publicRoot,'product',file));
  await mkdir(resolve(destination,'api'),{recursive:true});
  await writeFile(resolve(destination,'api','samples.js'),`export const scenarios = ${JSON.stringify(feedbackBatchScenarios)};\n`);
}
if(process.argv[1]?.endsWith('build-hosted.ts'))await buildHosted(resolve(process.env.PRODUCT_REPO || '.local/northstar-company-demo/customer-demo'));
