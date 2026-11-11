from pathlib import Path
import os,plistlib,shutil,subprocess,shlex
root=Path(__file__).resolve().parent
base=Path.home()/'Library/Application Support/TingwuClassAssistant'
app=Path.home()/'Desktop/听课搭子.app'
label='com.tangyi.tingwuclassassistant.agent'
plist=Path.home()/'Library/LaunchAgents'/f'{label}.plist'
if app.exists():
 info=app/'Contents/Info.plist'
 if not info.exists() or plistlib.loads(info.read_bytes()).get('CFBundleIdentifier')!='com.tangyi.tingwuclassassistant':
  raise SystemExit('桌面同名应用不属于本项目，停止安装，避免覆盖。')
subprocess.run(['/usr/bin/swiftc',str(root/'native/TingwuUI.swift'),'-o',str(root/'native/tingwu-ui')],check=True)
if plist.exists():
 old=plistlib.loads(plist.read_bytes())
 if old.get('Label')!=label:raise SystemExit('后台服务名称冲突')
 subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}',str(plist)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
base.mkdir(parents=True,exist_ok=True)
for name in ['desktop','extension','native']:
 shutil.copytree(root/name,base/name,dirs_exist_ok=True)
(base/'runtime').mkdir(exist_ok=True)
node=Path(shutil.which('node')).resolve()
shutil.copy2(node,base/'runtime/node')
(base/'logs').mkdir(exist_ok=True)
(base/'data').mkdir(mode=0o700,exist_ok=True)
contents=app/'Contents';(contents/'MacOS').mkdir(parents=True,exist_ok=True);(contents/'Resources').mkdir(exist_ok=True)
info={'CFBundleName':'听课搭子','CFBundleDisplayName':'听课搭子','CFBundleIdentifier':'com.tangyi.tingwuclassassistant','CFBundleVersion':'0.4.0','CFBundleShortVersionString':'0.4.0','CFBundleExecutable':'launcher','CFBundlePackageType':'APPL','LSUIElement':True,'CFBundleIconFile':'AppIcon','NSAppleEventsUsageDescription':'在上课前打开通义听悟并点击开始录音。'}
(contents/'Info.plist').write_bytes(plistlib.dumps(info))
config={'Label':label,'ProgramArguments':[str(base/'runtime/node'),str(base/'desktop/server.mjs')],'WorkingDirectory':str(base),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':30,'ProcessType':'Background','StandardOutPath':str(base/'logs/service.log'),'StandardErrorPath':str(base/'logs/error.log')}
plist.parent.mkdir(exist_ok=True);plist.write_bytes(plistlib.dumps(config))
launcher='''#!/bin/bash
set -eu
USER_DOMAIN="gui/$(id -u)"
SERVICE="com.tangyi.tingwuclassassistant.agent"
PLIST='''+shlex.quote(str(plist))+'''
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
print('Installed:',app)
print('Support:',base)
print('LaunchAgent:',plist)
