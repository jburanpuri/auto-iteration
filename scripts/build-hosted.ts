import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { feedbackBatchScenarios } from '../src/demo-feedback.js';
export async function buildHosted(productRoot: string, destination = resolve('hosted')) {
  const publicRoot = resolve(destination, 'public');
  for(const folder of ['reviews','product','feedback'])await mkdir(resolve(publicRoot,folder),{recursive:true});
  for(const file of ['index.html','app.mjs','styles.css']) {
    await cp(resolve('examples/reviews',file),resolve(publicRoot,file));
    await cp(resolve('examples/reviews',file),resolve(publicRoot,'reviews',file));
  }
  for(const folder of ['', 'reviews']) {
    const html=await readFile(resolve(publicRoot,folder,'index.html'),'utf8');
    await writeFile(resolve(publicRoot,folder,'index.html'),html.replaceAll('http://127.0.0.1:4348/','/'));
  }
  for(const folder of ['product','feedback'])for(const file of ['app.mjs','styles.css','export.mjs'])await cp(resolve(productRoot,file),resolve(publicRoot,folder,file));
  await cp(resolve(productRoot,'index.html'),resolve(publicRoot,'feedback','index.html'));
  await cp(resolve(productRoot,'product.html'),resolve(publicRoot,'product','index.html'));
  await mkdir(resolve(destination,'api'),{recursive:true});
  await writeFile(resolve(destination,'api','samples.js'),`export const scenarios = ${JSON.stringify(feedbackBatchScenarios)};\n`);
}
if(process.argv[1]?.endsWith('build-hosted.ts'))await buildHosted(resolve(process.env.PRODUCT_REPO || '.local/northstar-company-demo/customer-demo'));
