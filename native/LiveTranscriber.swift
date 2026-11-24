// Uses Apple's on-device SpeechAnalyzer. Reads WAV bytes; never owns or stops a microphone.
import Foundation
import Speech
import AVFoundation
import CoreMedia
import Darwin

struct Segment: Codable { var start: Double; var end: Double; var text: String }
struct Transcript: Codable {
    var schema = 1
    var phase = "preparing"
    var pid = ProcessInfo.processInfo.processIdentifier
    var updatedAt = Date().timeIntervalSince1970 * 1000
    var processedThrough: Double = 0
    var segments: [Segment] = []
    var partial: Segment?
    var error: String?
}
actor Output {
    let url: URL
    var value: Transcript
    init(_ url: URL) {
        self.url = url
        value = (try? JSONDecoder().decode(Transcript.self, from: Data(contentsOf: url))) ?? Transcript()
        value.pid = ProcessInfo.processInfo.processIdentifier
        value.phase = "preparing"; value.error = nil; value.partial = nil
    }
    func save() throws {
        value.updatedAt = Date().timeIntervalSince1970 * 1000
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    func phase(_ phase: String, error: String? = nil) throws { value.phase = phase; value.error = error; try save() }
    func progress(_ seconds: Double) { value.processedThrough = seconds }
    func resumeAt() -> Double { value.segments.map { $0.end }.max() ?? 0 }
    func result(_ r: SpeechTranscriber.Result) throws {
        let text = String(r.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let segment = Segment(start: max(0, r.range.start.seconds), end: max(0, r.range.end.seconds), text: text)
        if r.isFinal {
            // Re-reading after a service restart cannot append the same final range twice.
            value.segments.removeAll { abs($0.start - segment.start) < 0.02 }
            value.segments.append(segment); value.segments.sort { $0.start < $1.start }
            value.partial = nil
        } else { value.partial = segment }
        try save()
    }
}
func failure(_ message: String) -> NSError { NSError(domain: "TingwuLiveText", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
func u16(_ d: Data, _ p: Int) -> Int { Int(d[p]) | Int(d[p+1]) << 8 }
func u32(_ d: Data, _ p: Int) -> Int { Int(d[p]) | Int(d[p+1]) << 8 | Int(d[p+2]) << 16 | Int(d[p+3]) << 24 }
func wavOffset(_ file: URL) throws -> UInt64 {
    let f = try FileHandle(forReadingFrom: file); defer { try? f.close() }
    let d = try f.read(upToCount: 65536) ?? Data()
    guard d.count >= 44, String(data: d[0..<4], encoding: .ascii) == "RIFF", String(data: d[8..<12], encoding: .ascii) == "WAVE" else { throw failure("等待本地 WAV 音频准备完成") }
    var p = 12, valid = false
    while p + 8 <= d.count {
        let tag = String(data: d[p..<p+4], encoding: .ascii), size = u32(d, p+4)
        if tag == "fmt ", size >= 16, p+24 <= d.count {
            valid = u16(d,p+8) == 1 && u16(d,p+10) == 1 && u32(d,p+12) == 16000 && u16(d,p+22) == 16
        }
        if tag == "data" { guard valid else { throw failure("实时转写需要 16 kHz 单声道 PCM 音频") }; return UInt64(p+8) }
        p += 8 + size + size%2
    }
    throw failure("尚未读到音频数据区")
}
func isRecording(_ metadata: URL) -> Bool {
    guard let d = try? Data(contentsOf: metadata), let value = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return false }
    return value["status"] as? String == "recording"
}
func makeTranscriber(_ output: Output) async throws -> SpeechTranscriber {
    guard SpeechTranscriber.isAvailable, let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "zh-CN")) else { throw failure("这台 Mac 暂不支持中文本机实时转写；本地录音不受影响") }
    let t = SpeechTranscriber(locale: locale, preset: .timeIndexedProgressiveTranscription)
    if await AssetInventory.status(forModules: [t]) != .installed {
        try await output.phase("preparing")
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [t]) { try await request.downloadAndInstall() }
    }
    return t
}
func transcribe(_ file: URL, metadata: URL, output: Output) async throws {
    let transcriber = try await makeTranscriber(output)
    let sourceFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false)!
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber], considering: sourceFormat), let converter = AVAudioConverter(from: sourceFormat, to: format) else { throw failure("中文转写音频格式不可用") }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    try await analyzer.prepareToAnalyze(in: format)
    let offset = try wavOffset(file), input = try FileHandle(forReadingFrom: file)
    defer { try? input.close() }
    var frame = Int64((await output.resumeAt() * 16000).rounded(.down))
    try input.seek(toOffset: offset + UInt64(frame*2))
    let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream(bufferingPolicy: .bufferingOldest(8))
    let results = Task { for try await result in transcriber.results { try await output.result(result) } }
    let producer = Task {
        do {
            try await output.phase("listening")
            while !Task.isCancelled {
                let data = try input.read(upToCount: 16000) ?? Data()
                if data.count < 2 {
                    if !isRecording(metadata) { break }
                    try await Task.sleep(for: .milliseconds(250)); continue
                }
                let count = data.count / 2
                guard let buffer = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: AVAudioFrameCount(count)) else { throw failure("音频缓冲分配失败") }
                buffer.frameLength = AVAudioFrameCount(count)
                _ = data.withUnsafeBytes { bytes in memcpy(buffer.int16ChannelData![0], bytes.baseAddress!, count*2) }
                let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(ceil(Double(count)*format.sampleRate/16000)))!
                var supplied = false, conversionError: NSError?
                converter.convert(to: out, error: &conversionError) { _, status in
                    if supplied { status.pointee = .noDataNow; return nil }
                    supplied = true; status.pointee = .haveData; return buffer
                }
                if let error = conversionError { throw error }
                if out.frameLength > 0 {
                    let item = AnalyzerInput(buffer: out, bufferStartTime: CMTime(value: frame, timescale: 16000))
                    var sent = false
                    while !sent && !Task.isCancelled {
                        switch continuation.yield(item) {
                        case .enqueued: sent = true
                        case .dropped: try await Task.sleep(for: .milliseconds(30))
                        case .terminated: throw CancellationError()
                        @unknown default: throw CancellationError()
                        }
                    }
                }
                frame += Int64(count); await output.progress(Double(frame)/16000)
                try await Task.sleep(for: .milliseconds(5))
            }
            continuation.finish()
        } catch { continuation.finish(); throw error }
    }
    do {
        let last = try await analyzer.analyzeSequence(stream)
        try await producer.value
        if let last = last { try await analyzer.finalizeAndFinish(through: last) } else { await analyzer.cancelAndFinishNow() }
        try await results.value
        try await output.phase("complete")
    } catch {
        producer.cancel(); continuation.finish(); results.cancel(); await analyzer.cancelAndFinishNow(); throw error
    }
}
let args = CommandLine.arguments
guard args.count == 4 || (args.count == 3 && args[1] == "--prepare") else { exit(2) }
let outputURL = URL(fileURLWithPath: args.last!)
try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
let lockFD = Darwin.open(outputURL.path + ".lock", O_CREAT | O_RDWR, 0o600)
guard lockFD >= 0, flock(lockFD, LOCK_EX | LOCK_NB) == 0 else { exit(0) }
let output = Output(outputURL)
Task {
    let heartbeat = Task { while !Task.isCancelled { try? await output.save(); try? await Task.sleep(for: .seconds(2)) } }
    do {
        if args[1] == "--prepare" { _ = try await makeTranscriber(output); try await output.phase("ready") }
        else { try await transcribe(URL(fileURLWithPath: args[1]), metadata: URL(fileURLWithPath: args[2]), output: output) }
        heartbeat.cancel(); exit(0)
    } catch { heartbeat.cancel(); try? await output.phase("error", error: error.localizedDescription); exit(1) }
}
RunLoop.main.run()
