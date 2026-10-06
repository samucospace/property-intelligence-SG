import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

describe('Median worker launched by an ESM eval parent',()=>{
  for(const inputType of [['--input-type=module'],['--input-type','module']]) {
    it(`computes the exact median with ${inputType.join(' ')}`,()=>{
      const code=`
        import assert from 'node:assert/strict';
        import {createConnection} from './db.js';
        import {medianOne} from './utils/medianQueries.js';
        const db=createConnection(':memory:');
        try {
          const result=await medianOne('SELECT group_concat(value) AS numbers,count(*) AS size FROM (SELECT 1.5 AS value UNION ALL SELECT 2.5)',[],[{source:'numbers',count:'size',target:'median'}],db);
          assert.equal(result.median,2);
          console.log('median-worker-passed');
        } finally {await db.close();}
      `;
      const result=spawnSync(process.execPath,[...inputType,'--eval',code],{
        cwd:fileURLToPath(new URL('../',import.meta.url)),
        env:{...process.env,NODE_ENV:'test'},encoding:'utf8',timeout:10000
      });
      expect(result.error).toBeUndefined();
      expect(result.status,result.stderr).toBe(0);
      expect(result.stdout).toContain('median-worker-passed');
    });
  }
});
