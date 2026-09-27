import AppKit
import Foundation
import Vision

struct OCRBox: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct OCRPage: Codable {
    let path: String
    let width: Int
    let height: Int
    let boxes: [OCRBox]
}

func recognize(path: String) throws -> OCRPage {
    guard let image = NSImage(contentsOfFile: path) else {
        throw NSError(domain: "VisionOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot open image: \(path)"])
    }
    var proposed = NSRect(origin: .zero, size: image.size)
    guard let cgImage = image.cgImage(forProposedRect: &proposed, context: nil, hints: nil) else {
        throw NSError(domain: "VisionOCR", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot decode image: \(path)"])
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    let observations = (request.results ?? []).sorted { left, right in
        if abs(left.boundingBox.midY - right.boundingBox.midY) > 0.01 {
            return left.boundingBox.midY > right.boundingBox.midY
        }
        return left.boundingBox.minX < right.boundingBox.minX
    }
    let boxes = observations.compactMap { observation -> OCRBox? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return OCRBox(
            text: candidate.string,
            confidence: candidate.confidence,
            x: box.minX,
            y: box.minY,
            width: box.width,
            height: box.height
        )
    }
    return OCRPage(path: path, width: cgImage.width, height: cgImage.height, boxes: boxes)
}

var arguments = Array(CommandLine.arguments.dropFirst())
var outputPath: String? = nil
if arguments.count >= 2, arguments[0] == "--output" {
    outputPath = arguments[1]
    arguments.removeFirst(2)
}
let paths = arguments
if paths.isEmpty {
    FileHandle.standardError.write(Data("Usage: vision_ocr [--output result.json] image...\n".utf8))
    exit(2)
}

do {
    let pages = try paths.map(recognize)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    var data = try encoder.encode(pages)
    data.append(Data("\n".utf8))
    if let outputPath {
        try data.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
    } else {
        FileHandle.standardOutput.write(data)
    }
} catch {
    let nsError = error as NSError
    FileHandle.standardError.write(Data("\(nsError.domain) [\(nsError.code)]: \(nsError.localizedDescription) \(nsError.userInfo)\n".utf8))
    exit(1)
}
