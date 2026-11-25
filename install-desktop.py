from pathlib import Path
import os,plistlib,shutil,subprocess,shlex
root=Path(__file__).resolve().parent
base=Path.home()/'Library/Application Support/TingwuClassAssistant'
app=Path.home()/'Desktop/听课搭子.app'
label='com.tangyi.tingwuclassassistant.agent'
plist=Path.home()/'Library/LaunchAgents'/f'{label}.plist'
guard_label='com.tangyi.tingwuclassassistant.guard'
guard_plist=Path.home()/'Library/LaunchAgents'/f'{guard_label}.plist'
# Never overwrite a helper which is recording, even if the dashboard is closed.
status_file=base/'data/local/status.json'
if status_file.exists():
 import json,time
 local=json.loads(status_file.read_text())
 if local.get('recording') and time.time()*1000-local.get('updatedAt',0)<10000:
  raise SystemExit('本地录音正在进行，请先手动结束后安装。')
subprocess.run([os.sys.executable,str(root/'build-recorder.py')],check=True)
subprocess.run([os.sys.executable,str(root/'build-transcriber.py')],check=True)
if not (root/'node_modules/ali-oss').exists():raise SystemExit('请先运行 npm ci 安装依赖。')
if app.exists():
 info=app/'Contents/Info.plist'
 if not info.exists() or plistlib.loads(info.read_bytes()).get('CFBundleIdentifier')!='com.tangyi.tingwuclassassistant':
  raise SystemExit('桌面同名应用不属于本项目，停止安装，避免覆盖。')
subprocess.run(['/usr/bin/swiftc',str(root/'native/TingwuUI.swift'),'-o',str(root/'native/tingwu-ui')],check=True)
node_source=shutil.which('node')
if not (base/'runtime/node').exists() and not node_source:raise SystemExit('请先安装 Node.js，再运行安装程序。')
for target,expected in [(guard_plist,guard_label),(plist,label)]:
 if target.exists():
  old=plistlib.loads(target.read_bytes())
  if old.get('Label')!=expected:raise SystemExit('后台服务名称冲突')
  subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}',str(target)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
base.mkdir(parents=True,exist_ok=True)
for name in ['desktop','extension','native']:
 shutil.copytree(root/name,base/name,dirs_exist_ok=True)
shutil.copytree(root/'node_modules',base/'node_modules',dirs_exist_ok=True,ignore=shutil.ignore_patterns('playwright','playwright-core','.cache'))
for name in ['package.json','package-lock.json','README.md','THIRD_PARTY_NOTICES.md','LICENSES']:
 source=root/name
 if source.is_dir():shutil.copytree(source,base/name,dirs_exist_ok=True)
 elif source.exists():shutil.copy2(source,base/name)
(base/'runtime').mkdir(exist_ok=True)
# Keep the existing runtime identity so macOS Accessibility permission remains valid.
if not (base/'runtime/node').exists():shutil.copy2(Path(node_source).resolve(),base/'runtime/node')
(base/'logs').mkdir(exist_ok=True)
(base/'data').mkdir(mode=0o700,exist_ok=True)
contents=app/'Contents';(contents/'MacOS').mkdir(parents=True,exist_ok=True);(contents/'Resources').mkdir(exist_ok=True)
info={'CFBundleName':'听课搭子','CFBundleDisplayName':'听课搭子','CFBundleIdentifier':'com.tangyi.tingwuclassassistant','CFBundleVersion':'0.16.1','CFBundleShortVersionString':'0.16.1','CFBundleExecutable':'launcher','CFBundlePackageType':'APPL','LSUIElement':True,'CFBundleIconFile':'AppIcon','NSAppleEventsUsageDescription':'在上课前打开通义听悟并点击开始录音。'}
(contents/'Info.plist').write_bytes(plistlib.dumps(info))
config={'Label':label,'ProgramArguments':[str(base/'runtime/node'),str(base/'desktop/server.mjs')],'WorkingDirectory':str(base),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':30,'ProcessType':'Background','StandardOutPath':str(base/'logs/service.log'),'StandardErrorPath':str(base/'logs/error.log')}
plist.parent.mkdir(exist_ok=True);plist.write_bytes(plistlib.dumps(config))
guard_config={'Label':guard_label,'ProgramArguments':[str(base/'runtime/node'),str(base/'desktop/service-guard.mjs')],'WorkingDirectory':str(base),'RunAtLoad':True,'StartInterval':30,'ThrottleInterval':30,'ProcessType':'Background','StandardOutPath':str(base/'logs/guard-output.log'),'StandardErrorPath':str(base/'logs/guard-error.log')}
guard_plist.write_bytes(plistlib.dumps(guard_config))
launcher='''#!/bin/bash
set -eu
USER_DOMAIN="gui/$(id -u)"
SERVICE="com.tangyi.tingwuclassassistant.agent"
PLIST='''+shlex.quote(str(plist))+'''
GUARD_PLIST='''+shlex.quote(str(guard_plist))+'''
if ! /bin/launchctl print "$USER_DOMAIN/com.tangyi.tingwuclassassistant.guard" >/dev/null 2>&1; then
 /bin/launchctl bootstrap "$USER_DOMAIN" "$GUARD_PLIST" >/dev/null 2>&1 || true
fi
if ! /bin/launchctl print "$USER_DOMAIN/$SERVICE" >/dev/null 2>&1; then
 /bin/launchctl bootstrap "$USER_DOMAIN" "$PLIST"
fi
/bin/launchctl kickstart "$USER_DOMAIN/$SERVICE" >/dev/null 2>&1 || true
for attempt in {1..30}; do
 if /usr/bin/curl --silent --fail --max-time 1 http://127.0.0.1:18766/api/status >/dev/null; then
  /usr/bin/open -a "Google Chrome" http://127.0.0.1:18766/
  exit 0
 fi
 /bin/sleep 0.2
done
/usr/bin/osascript -e 'display alert "听课搭子暂时无法启动" message "请检查后台服务日志，或重新运行安装程序。"'
'''
(contents/'MacOS/launcher').write_text(launcher);(contents/'MacOS/launcher').chmod(0o755)
iconset=base/'AppIcon.iconset';iconset.mkdir(exist_ok=True)
for size in [16,32,128,256,512]:
 for scale in [1,2]:
  name=f'icon_{size}x{size}'+('@2x' if scale==2 else '')+'.png'
  subprocess.run(['sips','-z',str(size*scale),str(size*scale),str(root/'extension/icon.png'),'--out',str(iconset/name)],check=True,stdout=subprocess.DEVNULL)
subprocess.run(['iconutil','-c','icns',str(iconset),'-o',str(contents/'Resources/AppIcon.icns')],check=True)
subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(plist)],check=True)
subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(guard_plist)],check=True)
print('Installed:',app)
print('Support:',base)
print('LaunchAgent:',plist)
