// mac-app-audio <windowID>
//
// Captures audio from only the running application that owns the given window (a CGWindowID,
// matching desktopCapturer's `window:<id>:<n>` source id — main/app-audio.js extracts the id),
// using ScreenCaptureKit's per-application content filter. Writes raw interleaved Float32 PCM,
// stereo at SAMPLE_RATE, to stdout as a continuous byte stream. Status/errors go to stderr as a
// single line each ("ready", or "error: ..."); main/app-audio.js reads the first stderr line to
// know whether capture actually started before trusting stdout.
//
// There is no narrower API: ScreenCaptureKit scopes a filter to an application (all its windows
// on one display), not to a single window's audio in isolation. Sharing one window still only
// sends video from that window — this just adds that window's app's audio alongside it.
import Foundation
import ScreenCaptureKit
import CoreMedia

let SAMPLE_RATE = 48000
let CHANNELS = 2

func fail(_ message: String) -> Never {
    FileHandle.standardError.write("error: \(message)\n".data(using: .utf8)!)
    exit(1)
}

guard CommandLine.arguments.count > 1, let windowID = UInt32(CommandLine.arguments[1]) else {
    fail("usage: mac-app-audio <windowID>")
}

// A CMSampleBuffer's audio may arrive as one interleaved buffer or one buffer per channel
// (planar), depending on the source. Handle both rather than assume either.
//
// AudioBufferList is a variable-length C struct (mNumberBuffers, then that many AudioBuffer
// entries); MemoryLayout<AudioBufferList>.size only covers ONE entry. Allocating that fixed size
// and then letting multi-buffer (e.g. planar stereo) audio write into it overflows the
// allocation — this crashed the moment real stereo audio arrived. Query the size actually
// needed first, the way Apple's own sample code does, and allocate exactly that.
func extractPCM(from sampleBuffer: CMSampleBuffer) -> Data? {
    var blockBuffer: CMBlockBuffer?
    var bufferListSizeNeeded = 0
    let sizeStatus = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sampleBuffer,
        bufferListSizeNeededOut: &bufferListSizeNeeded,
        bufferListOut: nil,
        bufferListSize: 0,
        blockBufferAllocator: nil,
        blockBufferMemoryAllocator: nil,
        flags: 0,
        blockBufferOut: nil
    )
    guard sizeStatus == noErr, bufferListSizeNeeded > 0 else { return nil }
    let rawBufferList = UnsafeMutableRawPointer.allocate(byteCount: bufferListSizeNeeded, alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { rawBufferList.deallocate() }
    let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sampleBuffer,
        bufferListSizeNeededOut: nil,
        bufferListOut: rawBufferList.assumingMemoryBound(to: AudioBufferList.self),
        bufferListSize: bufferListSizeNeeded,
        blockBufferAllocator: nil,
        blockBufferMemoryAllocator: nil,
        flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
        blockBufferOut: &blockBuffer
    )
    guard status == noErr else { return nil }
    let bufferList = UnsafeMutableAudioBufferListPointer(rawBufferList.assumingMemoryBound(to: AudioBufferList.self))
    guard bufferList.count > 0 else { return nil }
    if bufferList.count == 1 {
        guard let data = bufferList[0].mData else { return nil }
        return Data(bytes: data, count: Int(bufferList[0].mDataByteSize))
    }
    let frameCount = Int(bufferList[0].mDataByteSize) / MemoryLayout<Float32>.size
    var interleaved = [Float32](repeating: 0, count: frameCount * bufferList.count)
    for (channel, buffer) in bufferList.enumerated() {
        guard let data = buffer.mData else { continue }
        let samples = data.assumingMemoryBound(to: Float32.self)
        for frame in 0..<frameCount {
            interleaved[frame * bufferList.count + channel] = samples[frame]
        }
    }
    return interleaved.withUnsafeBufferPointer { Data(buffer: $0) }
}

final class AudioOutput: NSObject, SCStreamOutput, SCStreamDelegate {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .audio, sampleBuffer.isValid, sampleBuffer.numSamples > 0 else { return }
        guard let data = extractPCM(from: sampleBuffer) else { return }
        FileHandle.standardOutput.write(data)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fail("stream stopped: \(error.localizedDescription)")
    }
}

let output = AudioOutput()

do {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
        fail("window \(windowID) not found")
    }
    guard let app = window.owningApplication else {
        fail("window \(windowID) has no owning application")
    }
    // The filter's display must actually show one of the app's windows, or it captures nothing
    // (audio included) — matters on multi-monitor setups where the shared window isn't on the
    // first display.
    let appWindows = content.windows.filter { $0.owningApplication?.processID == app.processID }
    guard let display = content.displays.first(where: { display in appWindows.contains { $0.frame.intersects(display.frame) } }) ?? content.displays.first else {
        fail("no display available")
    }
    let filter = SCContentFilter(display: display, including: [app], exceptingWindows: [])
    let config = SCStreamConfiguration()
    config.capturesAudio = true
    config.excludesCurrentProcessAudio = true
    config.sampleRate = SAMPLE_RATE
    config.channelCount = CHANNELS
    // ScreenCaptureKit always captures some video alongside audio; this app sends its own video
    // separately (via getDisplayMedia), so keep this stream's video as small as it allows.
    config.width = 2
    config.height = 2
    config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

    let stream = SCStream(filter: filter, configuration: config, delegate: output)
    try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: DispatchQueue(label: "mac-app-audio.output"))
    try await stream.startCapture()
    FileHandle.standardError.write("ready\n".data(using: .utf8)!)
} catch {
    fail("could not start capture: \(error.localizedDescription)")
}

signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }
dispatchMain()
