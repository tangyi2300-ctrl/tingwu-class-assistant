// Independent microphone recorder. Node restarts never send it a stop command.
import Cocoa
import AVFoundation
import Darwin

let fm = FileManager.default
let args = CommandLine.arguments
let base = args.count > 1 ? URL(fileURLWithPath: args[1]) : fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/TingwuClassAssistant/data/local")
let recordings = base.appendingPathComponent("Recordings")
try fm.createDirectory(at: recordings, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
let lockFD = Darwin.open(base.appendingPathComponent("recorder.lock").path, O_CREAT | O_RDWR, 0o600)
guard lockFD >= 0, flock(lockFD, LOCK_EX | LOCK_NB) == 0 else { exit(0) }
func now() -> Double { Date().timeIntervalSince1970 * 1000 }
func writeJSON(_ value: [String: Any], _ url: URL) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    try data.write(to: url, options: .atomic)
    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
}
func readJSON(_ url: URL) -> [String: Any]? { guard let data = try? Data(contentsOf: url) else { return nil }; return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] }
func permission() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return "authorized"
    case .notDetermined: return "notDetermined"
    default: return "denied"
    }
}
final class Recorder: NSObject, AVAudioRecorderDelegate {
    var audio: AVAudioRecorder?
    var active: [String: Any]?
    var error = ""
    var lastCommand = ""
    var activity: NSObjectProtocol?
    var timer: Timer?
    var signals: [DispatchSourceSignal] = []
    func file(_ id: String) -> URL { recordings.appendingPathComponent(id + ".wav") }
    func meta(_ id: String) -> URL { recordings.appendingPathComponent(id + ".json") }
    func saveActive() throws { if let item = active, let id = item["id"] as? String { try writeJSON(item, meta(id)) } }
    func recover() {
        for url in (try? fm.contentsOfDirectory(at: recordings, includingPropertiesForKeys: nil)) ?? [] where url.pathExtension == "json" {
            if var item = readJSON(url), item["status"] as? String == "recording" {
                item["status"] = "interrupted"; item["error"] = "录音进程曾意外退出，已保留写入的音频，请检查完整性。"
                try? writeJSON(item, url)
            }
        }
    }
    func snapshot() {
        if let audio = audio, audio.isRecording {
            audio.updateMeters()
            active?["durationSeconds"] = audio.currentTime
        }
        var status: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier, "updatedAt": now(), "permission": permission(), "recording": audio?.isRecording ?? false, "error": error]
        if let item = active { status["active"] = item }
        if let audio = audio { status["level"] = audio.averagePower(forChannel: 0) }
        try? writeJSON(status, base.appendingPathComponent("status.json"))
    }
    func reply(_ id: String, _ message: String, _ failed: Bool = false) {
        snapshot()
        try? writeJSON(["id": id, "ok": !failed, "message": message], base.appendingPathComponent("reply.json"))
    }
    func start(_ id: String) throws {
        if audio?.isRecording == true { return }
        guard permission() == "authorized" else { throw NSError(domain: "Recorder", code: 1, userInfo: [NSLocalizedDescriptionKey: "请先在听课搭子授权麦克风。"] ) }
        guard id.range(of: "^[a-zA-Z0-9-]{1,80}$", options: .regularExpression) != nil, !fm.fileExists(atPath: file(id).path) else { throw NSError(domain: "Recorder", code: 2, userInfo: [NSLocalizedDescriptionKey: "录音编号无效或文件已存在，已保护原音频。"] ) }
        let disk = try fm.attributesOfFileSystem(forPath: base.path)
        guard (disk[.systemFreeSize] as? NSNumber)?.int64Value ?? 0 > 800_000_000 else { throw NSError(domain: "Recorder", code: 3, userInfo: [NSLocalizedDescriptionKey: "磁盘可用空间不足 800 MB，请腾出空间后再录音。"] ) }
        // PCM WAV remains recoverable after a crash; no unfinalized AAC container.
        let recorder = try AVAudioRecorder(url: file(id), settings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false])
        recorder.delegate = self; recorder.isMeteringEnabled = true
        guard recorder.prepareToRecord() else { throw NSError(domain: "Recorder", code: 4, userInfo: [NSLocalizedDescriptionKey: "麦克风尚未准备好。"] ) }
        active = ["id": id, "startedAt": now(), "status": "recording", "durationSeconds": 0]
        try saveActive()
        guard recorder.record() else { active?["status"] = "failed"; try saveActive(); throw NSError(domain: "Recorder", code: 5, userInfo: [NSLocalizedDescriptionKey: "麦克风启动失败，未确认录音。"] ) }
        audio = recorder; error = ""
        activity = ProcessInfo.processInfo.beginActivity(options: [.idleSystemSleepDisabled], reason: "课堂本地录音")
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file(id).path)
    }
    func finish(_ interrupted: Bool = false) {
        guard let recorder = audio else { return }
        active?["durationSeconds"] = recorder.currentTime
        recorder.delegate = nil; recorder.stop(); audio = nil
        if let activity = activity { ProcessInfo.processInfo.endActivity(activity); self.activity = nil }
        active?["status"] = interrupted ? "interrupted" : "saved"
        active?["endedAt"] = now()
        if interrupted { active?["error"] = error.isEmpty ? "录音异常中断，已保留音频。" : error }
        do { try saveActive() } catch { self.error = "音频已保留，但记录保存失败：" + error.localizedDescription }
        snapshot()
    }
    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) { self.error = error?.localizedDescription ?? "录音写入失败"; finish(true) }
    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) { error = "麦克风录制意外结束，请检查音频。"; finish(true) }
    func tick() {
        if let recorder = audio, !recorder.isRecording { error = "麦克风录制已中断，请检查输入设备。"; finish(true) }
        if let cmd = readJSON(base.appendingPathComponent("command.json")), let id = cmd["id"] as? String, id != lastCommand {
            lastCommand = id
            if (cmd["expiresAt"] as? Double ?? 0) < now() { reply(id, "操作已过期，请重试。", true); return }
            switch cmd["action"] as? String {
            case "permission":
                AVCaptureDevice.requestAccess(for: .audio) { allowed in DispatchQueue.main.async { self.reply(id, allowed ? "麦克风已授权" : "麦克风未授权，请在系统设置允许听课搭子录音。", !allowed) } }
            case "start":
                do { try start(cmd["recordId"] as? String ?? ""); reply(id, "本地录音已开始") } catch { self.error = error.localizedDescription; reply(id, self.error, true) }
            case "stop":
                guard let expected = cmd["recordId"] as? String, expected == active?["id"] as? String else { reply(id, "当前录音已变化，请重新查看后结束。", true); return }
                finish(); reply(id, "本地录音已保存")
            default: reply(id, "未知操作", true)
            }
        }
        snapshot()
    }
    func run() {
        recover(); snapshot()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in self.tick() }
        for code in [SIGTERM, SIGINT] {
            signal(code, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: code, queue: .main)
            source.setEventHandler { self.error = "录音进程退出，已保存音频。"; self.finish(true); exit(0) }
            source.resume(); signals.append(source)
        }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let recorder = Recorder(); recorder.run()
app.run()
