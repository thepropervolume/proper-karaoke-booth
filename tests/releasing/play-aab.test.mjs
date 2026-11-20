import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, copyFile, realpath, rm, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const home=process.env.JAVA_HOME;
const exe=(name)=>join(home, 'bin', process.platform==='win32'?`${name}.exe`:name);
const run=(file,args,options={})=>spawnSync(file,args,{...options,windowsHide:true,stdio:'ignore',shell:false});

test('a synthetic upload key signs every bundle payload and tampering or the wrong key is rejected', {skip:!home}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),'tpv-play-test-'));
  try {
    const payload=join(dir,'payload'), keystore=join(dir,'synthetic key with spaces.p12');
    await mkdir(join(payload,'base','manifest'),{recursive:true});
    await writeFile(join(payload,'BundleConfig.pb'),'synthetic bundle config');
    await writeFile(join(payload,'base','manifest','AndroidManifest.xml'),'synthetic manifest');
    const env={...process.env,TPV_PLAY_KEYSTORE:keystore,TPV_PLAY_KEY_ALIAS:'upload',TPV_PLAY_STORE_PASSWORD:'synthetic-password',TPV_PLAY_KEY_PASSWORD:'synthetic-password'};
    const call=(name,args,opts={})=>run(exe(name),args,{env,...opts});
    for(const alias of ['upload','different']) {
      const result=call('keytool',['-genkeypair','-alias',alias,'-keyalg','RSA','-keysize','2048','-dname','CN=Synthetic Test Only','-validity','2','-storetype','PKCS12','-keystore',keystore,'-storepass:env','TPV_PLAY_STORE_PASSWORD','-keypass:env','TPV_PLAY_KEY_PASSWORD','-noprompt']);
      assert.equal(result.status,0, 'Synthetic key creation failed');
    }
    const unsigned=join(dir,'unsigned.aab'), signed=join(dir,'signed.aab');
    assert.equal(call('jar',['--create','--file',unsigned,'-C',payload,'.']).status,0);
    const verify=(file,extra={})=>call('java',[resolve('scripts/VerifyPlayAab.java'),file],{env:{...env,...extra}}).status;
    assert.notEqual(verify(unsigned),0,'Unsigned bundle must fail');
    assert.equal(call('jarsigner',['-keystore',keystore,'-storepass:env','TPV_PLAY_STORE_PASSWORD','-keypass:env','TPV_PLAY_KEY_PASSWORD','-signedjar',signed,unsigned,'upload']).status,0);
    assert.equal(verify(signed),0,'Valid synthetic signature must pass');
    assert.notEqual(verify(signed,{TPV_PLAY_KEY_ALIAS:'different'}),0,'Wrong upload certificate must fail');
    const changed=join(dir,'changed.aab'); await copyFile(signed,changed);
    await writeFile(join(payload,'BundleConfig.pb'),'tampered');
    assert.equal(call('jar',['--update','--file',changed,'-C',payload,'BundleConfig.pb']).status,0);
    assert.notEqual(verify(changed),0,'Tampering must fail');
    const extra=join(dir,'extra.aab'); await copyFile(signed,extra);
    await writeFile(join(payload,'unsigned.txt'),'unsigned injected entry');
    assert.equal(call('jar',['--update','--file',extra,'-C',payload,'unsigned.txt']).status,0);
    assert.notEqual(verify(extra),0,'Unsigned payload must fail');
    if (process.env.TPV_PLAY_TEST_AAB) {
      const actual=resolve(process.env.TPV_PLAY_TEST_AAB), actualSigned=join(dir,'published-synthetic-signature.aab');
      assert.notEqual(verify(actual),0,'Published unsigned bundle must not appear signed');
      assert.equal(call('jarsigner',['-keystore',keystore,'-storepass:env','TPV_PLAY_STORE_PASSWORD','-keypass:env','TPV_PLAY_KEY_PASSWORD','-signedjar',actualSigned,actual,'upload']).status,0);
      assert.equal(verify(actualSigned),0,'Published bundle signed with disposable key must verify');
    }
    // Exercise the full orchestrator in a disposable clean Git repo with stub build steps;
    // the signing and entry verifier still use the real JDK and a real bundle.
    const checkout=join(dir,'checkout with spaces'); await mkdir(join(checkout,'scripts'),{recursive:true});
    await mkdir(join(checkout,'mobile','android','app'),{recursive:true});
    await mkdir(join(checkout,'mobile','node_modules','@capacitor','cli','bin'),{recursive:true});
    await copyFile(resolve('scripts/build-play-aab.mjs'),join(checkout,'scripts','build-play-aab.mjs'));
    await copyFile(resolve('scripts/VerifyPlayAab.java'),join(checkout,'scripts','VerifyPlayAab.java'));
    const buildStub="for (const k of ['TPV_PLAY_KEYSTORE','TPV_PLAY_KEY_ALIAS','TPV_PLAY_STORE_PASSWORD','TPV_PLAY_KEY_PASSWORD']) if (process.env[k]) process.exit(19);\n";
    await writeFile(join(checkout,'scripts','build-mobile.mjs'),buildStub);
    await writeFile(join(checkout,'mobile','node_modules','@capacitor','cli','bin','capacitor'),buildStub);
    const version=JSON.parse(await readFile(resolve('package.json'),'utf8')).version;
    const actualGradle=await readFile(resolve('mobile/android/app/build.gradle'),'utf8');
    const versionCode=Number(/\bversionCode\s+(\d+)/.exec(actualGradle)?.[1]);
    assert.ok(Number.isSafeInteger(versionCode) && versionCode > 0);
    const pkg={version}, lock={version,packages:{'':{version}}};
    await writeFile(join(checkout,'package.json'),JSON.stringify(pkg)); await writeFile(join(checkout,'package-lock.json'),JSON.stringify(lock));
    await writeFile(join(checkout,'mobile','package.json'),JSON.stringify(pkg)); await writeFile(join(checkout,'mobile','package-lock.json'),JSON.stringify(lock));
    await writeFile(join(checkout,'mobile','android','app','build.gradle'),`versionCode ${versionCode}\nversionName \"${version}\"\n`);
    await writeFile(join(checkout,'mobile','android','variables.gradle'),'targetSdkVersion = 36\n');
    await writeFile(join(checkout,'.gitignore'),'release/\nmobile/node_modules/\nmobile/android/app/build/\n');
    await writeFile(join(checkout,'mobile','android','gradlew.bat'),'@echo off\r\nif defined TPV_PLAY_STORE_PASSWORD exit /b 19\r\nif not exist app\\build\\outputs\\bundle\\release mkdir app\\build\\outputs\\bundle\\release\r\ncopy /y \"%TPV_TEST_INPUT%\" app\\build\\outputs\\bundle\\release\\app-release.aab >nul\r\n');
    await writeFile(join(checkout,'mobile','android','gradlew'),'#!/bin/bash\ntest -z \"${TPV_PLAY_STORE_PASSWORD+x}\" || exit 19\nmkdir -p app/build/outputs/bundle/release\ncp \"$TPV_TEST_INPUT\" app/build/outputs/bundle/release/app-release.aab\n');
    const git=(args)=>run('git',args,{cwd:checkout});
    assert.equal(git(['init','--quiet']).status,0);
    assert.equal(git(['add','.']).status,0);
    assert.equal(git(['-c','user.name=Synthetic Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','fixture']).status,0);
    // Always exercise forward-slash input: cmd.exe's copy builtin rejects it even when quoted.
    const forwardInput=(process.env.TPV_PLAY_TEST_AAB || unsigned).replaceAll('\\','/');
    const childEnv={...env,TPV_TEST_INPUT:resolve(forwardInput)};
    const execute=()=>spawnSync(process.execPath,[join(checkout,'scripts','build-play-aab.mjs'),'--execute'],{cwd:checkout,env:childEnv,windowsHide:true,shell:false,encoding:'utf8'});
    const initial=execute();
    const safeError=String(initial.stderr ?? '').replaceAll(env.TPV_PLAY_STORE_PASSWORD,'[redacted]').replaceAll(env.TPV_PLAY_KEY_PASSWORD,'[redacted]').replaceAll(keystore,'[test-keystore]');
    assert.equal(initial.status,0,`Full signing orchestration should succeed: ${safeError}`);
    const output=join(checkout,'release','play',`Proper-Karaoke-Booth-${version}-play-upload.aab`);
    assert.equal(verify(output),0,'Output bundle must verify against the synthetic key');
    const first=await readFile(output); assert.notEqual(execute().status,0,'Existing output must not be overwritten');
    assert.deepEqual(await readFile(output),first);
    await writeFile(join(checkout,'mobile','android','variables.gradle'),'targetSdkVersion = 35\n');
    assert.notEqual(execute().status,0,'Dirty source must fail before the build');
  } finally {
    const actual=await realpath(dir); assert.equal(dirname(actual),await realpath(tmpdir()));
    assert.ok(basename(actual).startsWith('tpv-play-test-')); await rm(actual,{recursive:true,force:true});
  }
});
