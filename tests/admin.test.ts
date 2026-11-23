import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import AdmZip from 'adm-zip';
import { createAdminRouter } from '../src/server/adminRouter';

test('local admin setup is single-use, protects package installs, persists the account and revokes sessions', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soldat-admin-test-'));
  t.after(() => fs.rm(dir, {recursive:true,force:true}));
  const app = express();
  app.use('/api/admin',createAdminRouter(dir));
  const server = app.listen(0, '127.0.0.1');
  await once(server,'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/admin/';
  const credentials = {login:'test',password:randomUUID()};
  const post = (route: string, form: { login: string; password: string }) => fetch(base+route,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form),
  });
  assert.equal((await fetch(base+'font',{method:'POST'})).status,401);
  const setup = await Promise.all([post('setup',credentials),post('setup',credentials)]);
  assert.deepEqual(setup.map(r => r.status).sort(),[200,409]);
  assert.ok(!(await fs.readFile(path.join(dir,'account.json'),'utf8')).includes(credentials.password));
  assert.equal((await post('login',{...credentials,password:'wrong'})).status,401);
  const login = await post('login',credentials);
  assert.equal(login.status,200);
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const font = await fs.readFile(path.resolve('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2'));
  const zip = new AdmZip();
  zip.addFile('my-pack/webfonts/fa-solid-900.woff2',font);
  zip.addFile('my-pack/css/all.css',Buffer.from('unused'));
  const upload = (buffer: Buffer) => fetch(base+'font',{method:'POST',
    headers:{cookie,'Content-Type':'application/zip'},body:new Uint8Array(buffer)});
  assert.equal((await upload(zip.toBuffer())).status,200);
  assert.equal((await upload(Buffer.from('invalid package'))).status,400);
  assert.deepEqual(Buffer.from(await (await fetch(base+'font')).arrayBuffer()),font);
  assert.deepEqual((await fs.readdir(dir)).sort(),['account.json','fa-solid-900.woff2']);
  await fetch(base+'logout',{method:'POST',headers:{cookie}});
  assert.equal((await upload(zip.toBuffer())).status,401);
});
