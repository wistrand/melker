#!/usr/bin/env swift
//
// macos-audio-record.swift
// Streams raw PCM audio (s16le, 16kHz, mono) to stdout for use with Melker
//
// Usage: swift macos-audio-record.swift [gain]
//   gain: Volume multiplier (default: 1.0, e.g., 2.0 for double volume)
//
// Output format matches ffmpeg: -f s16le -ac 1 -ar 16000
// Send SIGTERM or SIGINT to stop recording
//

import AVFoundation
import Foundation

// Audio format settings matching ffmpeg output
let sampleRate: Double = 16000
let channels: AVAudioChannelCount = 1
let bitsPerSample: UInt32 = 16

/// Request microphone permission and wait for result
func requestMicrophonePermission() -> Bool {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false

    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
        return true
    case .notDetermined:
        AVCaptureDevice.requestAccess(for: .audio) { result in
            granted = result
            semaphore.signal()
        }
        semaphore.wait()
        return granted
    case .denied, .restricted:
        return false
    @unknown default:
        return false
    }
}

class AudioStreamer {
    private var audioEngine: AVAudioEngine?
    private var gain: Float = 1.0
    // Pre-allocated buffer to avoid allocation in hot path
    private var outputData: [Int16] = []

    init(gain: Float) {
        self.gain = gain
    }

    func start() throws {
        audioEngine = AVAudioEngine()
        guard let engine = audioEngine else {
            throw NSError(domain: "AudioStreamer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio engine"])
        }

        let inputNode = engine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)

        // Create output format: 16kHz, mono, s16le
        guard let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: channels, interleaved: true) else {
            throw NSError(domain: "AudioStreamer", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to create output format"])
        }

        // Create converter from input format to output format
        guard let converter = AVAudioConverter(from: inputFormat, to: outputFormat) else {
            throw NSError(domain: "AudioStreamer", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio converter"])
        }

        // Install tap on input node
        let bufferSize: AVAudioFrameCount = 4096
        inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, time in
            guard let self = self else { return }
            self.processAudio(buffer: buffer, converter: converter, outputFormat: outputFormat)
        }

        try engine.start()
    }

    private func processAudio(buffer: AVAudioPCMBuffer, converter: AVAudioConverter, outputFormat: AVAudioFormat) {
        // Calculate output frame capacity based on sample rate ratio
        let inputFormat = buffer.format
        let ratio = outputFormat.sampleRate / inputFormat.sampleRate
        let outputFrameCapacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1

        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: outputFrameCapacity) else {
            fputs("Error: Failed to create output buffer\n", stderr)
            return
        }

        var error: NSError?
        var hasProvidedData = false
        let inputBlock: AVAudioConverterInputBlock = { inNumPackets, outStatus in
            if hasProvidedData {
                outStatus.pointee = .noDataNow
                return nil
            }
            hasProvidedData = true
            outStatus.pointee = .haveData
            return buffer
        }

        converter.convert(to: outputBuffer, error: &error, withInputFrom: inputBlock)

        if let error = error {
            fputs("Conversion error: \(error.localizedDescription)\n", stderr)
            return
        }

        // Get the int16 data and apply gain
        guard let int16Data = outputBuffer.int16ChannelData else {
            fputs("Error: No int16 channel data available\n", stderr)
            return
        }
        let frameLength = Int(outputBuffer.frameLength)

        // Grow buffer only if needed (avoids allocation in hot path)
        if outputData.count < frameLength {
            outputData = [Int16](repeating: 0, count: frameLength)
        }

        // Apply gain and write to stdout
        for i in 0..<frameLength {
            var sample = Float(int16Data[0][i]) * self.gain
            // Clamp to prevent clipping
            sample = max(-32768, min(32767, sample))
            outputData[i] = Int16(sample)
        }

        // Write raw PCM to stdout
        outputData.withUnsafeBufferPointer { bufferPointer in
            let rawPointer = UnsafeRawPointer(bufferPointer.baseAddress!)
            let byteCount = frameLength * MemoryLayout<Int16>.size
            fwrite(rawPointer, 1, byteCount, stdout)
            fflush(stdout)
        }
    }

    func stop() {
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
    }
}

// --- Main ---

// Parse gain argument
let args = CommandLine.arguments
let gain: Float = args.count > 1 ? (Float(args[1]) ?? 1.0) : 1.0

let streamer = AudioStreamer(gain: gain)

// Check microphone permission first
if !requestMicrophonePermission() {
    fputs("Error: Microphone permission denied. Grant access in System Preferences > Security & Privacy > Privacy > Microphone\n", stderr)
    exit(1)
}

// Setup signal handlers using DispatchSource for proper cleanup
func setupSignalHandler(_ sig: Int32) -> DispatchSourceSignal {
    signal(sig, SIG_IGN) // Ignore default handling
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler {
        streamer.stop()
        exit(0)
    }
    source.resume()
    return source
}

let sigintSource = setupSignalHandler(SIGINT)
let sigtermSource = setupSignalHandler(SIGTERM)

// Keep sources alive
_ = sigintSource
_ = sigtermSource

do {
    try streamer.start()

    // Keep running until interrupted
    RunLoop.current.run()
} catch {
    fputs("Error: \(error.localizedDescription)\n", stderr)
    exit(1)
}
