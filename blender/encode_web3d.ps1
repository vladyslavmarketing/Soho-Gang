# encode_web3d.ps1 - run in C:\Users\vladk\ae-studio after:
#   blender -b --factory-startup --python blender\web3d_pack.py -- --stage pack
# all:        powershell -NoProfile -ExecutionPolicy Bypass -File blender\encode_web3d.ps1
# one clip:   powershell -NoProfile -ExecutionPolicy Bypass -File blender\encode_web3d.ps1 -Only hero/S/intro -Codec av1 -Crf 38
# one image:  powershell -NoProfile -ExecutionPolicy Bypass -File blender\encode_web3d.ps1 -Only hero/M/look -WebpQ 78
# (spec B10; the only change: ffmpeg is looked up in the winget folder when it is not on PATH)
param([string]$Only = '', [string]$Codec = '', [int]$Crf = 0, [int]$WebpQ = 0)
$ErrorActionPreference = 'Stop'
$env:SVT_LOG = '1'                                     # SVT-AV1: errors only on stderr
$FFX = (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue).Source
if (-not $FFX) { $FFX = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe | Select-Object -First 1).FullName }
$ROOT = 'C:\Users\vladk\ae-studio'
$SEQ  = "$ROOT\web3d_seq"                              # packer PNGs (not shipped)
$OUT  = "$ROOT\web3d_enc"                              # plain-named encodes; finalize hashes them into web3d\
$TAGS = @('-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart','-an')
$VF   = 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p'
$CrfStart  = @{ av1 = 36; hevc = 27; h264 = 22 }       # ceilings av1 42, hevc 32, h264 27. Never call this $CRF: PowerShell names ignore case.
$WebpStart = [ordered]@{ rest = 82; look = 82; tongue = 80 }

function Run-FF([string[]]$A) { & $FFX $A; if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed: $($A -join ' ')" } }
function Want([string]$id, [string]$c) { ($Only -eq '' -or $Only -eq $id) -and ($Codec -eq '' -or $Codec -eq $c) }
function Q([string]$c) { if ($Crf -gt 0) { "$Crf" } else { "$($CrfStart[$c])" } }

function Enc-Clip([string]$scene, [string]$clip, [string]$tier) {
  $src = "$SEQ\$scene\$clip\$tier"
  if (-not (Test-Path "$src\0000.png")) { return }      # tier not produced (L clips are optional)
  $id = "$scene/$tier/$clip"; $dir = "$OUT\$scene\$tier"; New-Item -ItemType Directory -Force $dir | Out-Null
  $in = @('-y','-hide_banner','-loglevel','error','-framerate','30','-start_number','0','-i',"$src\%04d.png",'-vf',$VF)
  if (Want $id 'av1')  { Run-FF ($in + @('-c:v','libsvtav1','-preset','4','-crf',(Q 'av1'),'-g','300','-svtav1-params','tune=0:scd=0') + $TAGS + @("$dir\$clip.av1.mp4")) }
  if (Want $id 'hevc') { Run-FF ($in + @('-c:v','libx265','-preset','slow','-crf',(Q 'hevc'),'-tag:v','hvc1','-x265-params','keyint=300:min-keyint=300:scenecut=0:open-gop=0:log-level=error') + $TAGS + @("$dir\$clip.hevc.mp4")) }
  if (Want $id 'h264') { Run-FF ($in + @('-c:v','libx264','-preset','slow','-crf',(Q 'h264'),'-profile:v','high','-refs','4','-g','300','-bf','2','-x264-params','scenecut=0') + $TAGS + @("$dir\$clip.h264.mp4")) }
}
function Enc-Webp([string]$scene, [string]$name, [string]$tier) {
  $id = "$scene/$tier/$name"; $src = "$SEQ\$scene\${name}_$tier.png"
  if ($Codec -ne '' -or -not ($Only -eq '' -or $Only -eq $id) -or -not (Test-Path $src)) { return }
  $q = if ($WebpQ -gt 0) { $WebpQ } else { $WebpStart[$name] }
  $dir = "$OUT\$scene\$tier"; New-Item -ItemType Directory -Force $dir | Out-Null
  # bgra in: libwebp does RGB->YUV itself (ffmpeg's "Using libwebp for RGB-to-YUV" note is expected)
  Run-FF @('-y','-hide_banner','-loglevel','error','-i',$src,'-frames:v','1','-c:v','libwebp','-pix_fmt','bgra','-quality',"$q",'-compression_level','6',"$dir\$name.webp")
}

# J1 journey: all-intra (the player seeks on every scroll step, both ways); M is taller than 4096 -> no H.264 M
function Enc-Journey([string]$tier) {
  $src = "$SEQ\journey\journey\$tier"
  if (-not (Test-Path "$src\0000.png")) { return }
  $id = "journey/$tier/journey"; $dir = "$OUT\journey\$tier"; New-Item -ItemType Directory -Force $dir | Out-Null
  $in = @('-y','-hide_banner','-loglevel','error','-framerate','30','-start_number','0','-i',"$src\%04d.png",'-vf',$VF)
  $qa = if ($Crf -gt 0) { "$Crf" } else { '40' }; $qh = if ($Crf -gt 0) { "$Crf" } else { '30' }; $q4 = if ($Crf -gt 0) { "$Crf" } else { '26' }
  if (Want $id 'av1')  { Run-FF ($in + @('-c:v','libsvtav1','-preset','4','-crf',$qa,'-g','1','-svtav1-params','tune=0:scd=0') + $TAGS + @("$dir\journey.av1.mp4")) }
  if (Want $id 'hevc') { Run-FF ($in + @('-c:v','libx265','-preset','slow','-crf',$qh,'-tag:v','hvc1','-x265-params','keyint=1:min-keyint=1:scenecut=0:log-level=error') + $TAGS + @("$dir\journey.hevc.mp4")) }
  if ($tier -eq 'S' -and (Want $id 'h264')) { Run-FF ($in + @('-c:v','libx264','-preset','slow','-crf',$q4,'-profile:v','high','-g','1','-keyint_min','1','-x264-params','keyint=1:scenecut=0') + $TAGS + @("$dir\journey.h264.mp4")) }
}

foreach ($t in 'S','M','L') {
  Enc-Journey $t
  foreach ($c in @('hero:intro','hero:depart','hero:depart-rev','gauge:arrive')) { $p = $c.Split(':'); Enc-Clip $p[0] $p[1] $t }
  foreach ($s in 'hero','gauge') { foreach ($n in $WebpStart.Keys) { Enc-Webp $s $n $t } }
}
if ($Only -eq '') {
  foreach ($s in 'hero','gauge') { if (Test-Path "$SEQ\$s\mask.png") { Copy-Item "$SEQ\$s\mask.png","$SEQ\$s\flow.png" "$OUT\$s\" } }
  # 1-frame probe for the player's blocked-autoplay test; finalize embeds it as manifest.probe
  Run-FF @('-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=16x16:r=30','-frames:v','1','-c:v','libx264','-profile:v','baseline','-pix_fmt','yuv420p','-movflags','+faststart','-an',"$OUT\probe.mp4")
}
# then:  blender -b --factory-startup --python blender\web3d_pack.py -- --stage finalize
