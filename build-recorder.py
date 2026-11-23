"""Build the background microphone helper without launching or requesting access."""
from pathlib import Path
import plistlib, subprocess, tempfile
root = Path(__file__).resolve().parent
app = root / 'native/听课搭子录音.app'
mac = app / 'Contents/MacOS'
mac.mkdir(parents=True, exist_ok=True)
subprocess.run(['/usr/bin/xcrun', 'swiftc', str(root/'native/LocalRecorder.swift'), '-O', '-o', str(mac/'recorder'), '-module-cache-path', str(Path(tempfile.gettempdir())/'tingwu-swift-cache')], check=True)
info = {'CFBundleName':'听课搭子录音', 'CFBundleDisplayName':'听课搭子录音', 'CFBundleIdentifier':'com.tangyi.tingwuclassassistant.recorder', 'CFBundleVersion':'0.12.0', 'CFBundleShortVersionString':'0.12.0', 'CFBundleExecutable':'recorder', 'CFBundlePackageType':'APPL', 'LSUIElement':True, 'NSMicrophoneUsageDescription':'按课表将课堂声音保存在电脑，只有你点击结束后才上传通义听悟。'}
(app/'Contents/Info.plist').write_bytes(plistlib.dumps(info))
subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', '--identifier', info['CFBundleIdentifier'], str(app)], check=True)
print(app)
