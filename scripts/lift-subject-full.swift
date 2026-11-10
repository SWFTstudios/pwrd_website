// Full-frame variant of lift-subject.swift: keeps the original canvas so several shots stay aligned.
// Usage: swift scripts/lift-subject-full.swift input.jpg output.png
// Like lift-subject.swift but keeps the full frame (not cropped), so several shots stay aligned.
import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers
let a = CommandLine.arguments
let handler = VNImageRequestHandler(url: URL(fileURLWithPath: a[1]))
let req = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([req])
guard let obs = req.results?.first else { print("no subject"); exit(1) }
let buf = try obs.generateMaskedImage(ofInstances: obs.allInstances, from: handler, croppedToInstancesExtent: false)
let ci = CIImage(cvPixelBuffer: buf)
let cg = CIContext().createCGImage(ci, from: ci.extent, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)!
let d = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(d, cg, nil); CGImageDestinationFinalize(d)
print(a[1].split(separator: "/").last!, "instances:", obs.allInstances.count, cg.width, "x", cg.height)
