'use strict';
/**
 * lib/image-safety.js — Per-file wrapper around scripts/safety-scan.ps1.
 *
 * The script itself signals only through an exit code: 1 if ANY image in the
 * folder was flagged. Used naively that would reject all ninety of a night's
 * images because one was bad. So this parses the per-file stdout lines instead
 * and returns a verdict per filename.
 *
 * Scanning is batched by design. Each invocation opens a WinRM session and cold
 * starts Python on the GPU box, so one call per wave (~30 images) is right and
 * one call per image is not.
 *
 * Availability is a hard gate for a family publication: when the scanner cannot
 * be reached, `enforce` mode fails closed and the images simply are not
 * published. The pipeline is re-runnable, so that costs a delay, not content.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_SERVER = process.env.IMGSAFE_SERVER || 'HDC-INSPIRESERVER.JubileeIntelligence.com';

/**
 * The scan runner, emitted to a local temp file at call time rather than read
 * from scripts/safety-scan.ps1.
 *
 * Two reasons the on-disk script is not used here. The repo lives on a mapped
 * network drive (W: -> \\HDC-INSPIRESERVER\Websites), and powershell.exe's
 * -File parameter resolves that path unreliably from a spawned process, which
 * surfaces as a per-image "classifier failed" rather than a setup error. The
 * file has also repeatedly disappeared from the share mid-run. Writing our own
 * copy to os.tmpdir() removes both failure modes: the path is always local and
 * always present.
 *
 * scripts/safety-scan.ps1 remains for manual use and is the source this was
 * derived from; both carry the same fixes.
 */
const SCAN_PS1 = String.raw`
param([string]$Dir, [string]$Server)
$ErrorActionPreference = 'Stop'

# When this runs ON the classifier host — which is the case for the scheduled
# job, since the GPU box is also the imgsafe box — go straight to local paths.
# A UNC hop to \\self\D$ plus a WinRM loopback is slower, and admin-share
# loopback is exactly what host hardening tends to block.
$isLocal = $Server -in @('localhost', '127.0.0.1', $env:COMPUTERNAME, "$env:COMPUTERNAME.$env:USERDNSDOMAIN")
$incoming = if ($isLocal) { 'D:\inspire-imgsafe\incoming' } else { "\\$Server\D` + '`' + String.raw`$\inspire-imgsafe\incoming" }

$pngs = Get-ChildItem $Dir -Filter '*.png' -File
if (-not $pngs) { Write-Output "No PNGs in $Dir"; exit 0 }

New-Item -ItemType Directory -Force $incoming | Out-Null
$pngs | ForEach-Object { Copy-Item $_.FullName $incoming -Force }

# @() forces an array even for one file. Splatting a bare string passes each
# CHARACTER as its own argument, so the classifier would be called with
# 'D', ':', '\', ... and report "can't open/read file: 'D'".
$names = @($pngs.Name)

$classify = {
  param($names)
  $env:PYTHONUTF8 = '1'
  $paths = @($names | ForEach-Object { "D:\inspire-imgsafe\incoming\$_" })
  # 2>$null: OpenCV writes "[ WARN:...]" to stderr, which Invoke-Command would
  # otherwise raise as a terminating NativeCommandError.
  $out = & 'D:\inspire-imgsafe\venv\Scripts\python.exe' 'D:\inspire-imgsafe\safety_check.py' @paths 2>$null
  # Match the JSON array specifically: a bare '^\[' also matches those warnings.
  $out | Where-Object { $_ -match '^\s*\[\s*(\{|\])' }
}

$json = if ($isLocal) {
  & $classify $names
} else {
  Invoke-Command -ComputerName $Server -ArgumentList (,$names) -ScriptBlock $classify
}

# PowerShell 5.1, two opposing traps: piping into ConvertFrom-Json emits an
# array as ONE object instead of enumerating, while @(ConvertFrom-Json ...)
# re-wraps an already-array result. Convert by parameter, then promote only a
# lone object, which is what a one-image scan returns.
$results = ConvertFrom-Json -InputObject ($json -join "` + '`' + String.raw`n")
if ($results -isnot [System.Array]) { $results = ,$results }

$unsafe = 0
foreach ($r in $results) {
  $name = Split-Path $r.file -Leaf
  if ($r.error) { Write-Output ("ERROR  {0}  {1}" -f $name, $r.error); $unsafe++ }
  elseif ($r.safe) { Write-Output ("SAFE   {0}" -f $name) }
  else { Write-Output ("UNSAFE {0}  score={1}  flags={2}" -f $name, $r.score, ($r.flags -join ',')); $unsafe++ }
}
Write-Output ("--- {0} image(s), {1} flagged ---" -f $results.Count, $unsafe)
if ($unsafe -gt 0) { exit 1 } else { exit 0 }
`;

/**
 * Write the runner into a private temp directory, once per process.
 *
 * A fixed filename in os.tmpdir() is not safe here: a leftover copy from an
 * earlier run can be locked (by a scanner still exiting, or by AV), and the
 * rewrite then fails EPERM. mkdtempSync gives this process its own directory,
 * so there is nothing to collide with.
 */
let _scriptPath = null;
function scriptPath() {
    if (_scriptPath && fs.existsSync(_scriptPath)) return _scriptPath;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-safety-'));
    const file = path.join(dir, 'safety-scan.ps1');
    fs.writeFileSync(file, SCAN_PS1, 'utf8');
    _scriptPath = file;
    return file;
}

/** enforce: no scanner, no upload. warn: log and upload. off: skip entirely. */
const MODE = (process.env.NEWS_SAFETY_MODE || 'enforce').toLowerCase();

function isWindows() {
    return process.platform === 'win32';
}

/**
 * Can we even attempt a scan from this host?
 *
 * Checks the script is present before probing WinRM. The script lives on a
 * mapped network drive, so "missing" is a real and recoverable state; without
 * this check a missing file surfaces only as an opaque PowerShell -File error
 * per image, which reads like a classifier failure rather than a setup problem.
 */
async function isAvailable({ server = DEFAULT_SERVER, timeoutMs = 20000 } = {}) {
    if (!isWindows()) return false;
    // Probe locally when we are the classifier host; only reach for WinRM when
    // the box is genuinely remote.
    const probe = `$s='${server}'
$local = $s -in @('localhost','127.0.0.1',$env:COMPUTERNAME,"$env:COMPUTERNAME.$env:USERDNSDOMAIN")
if ($local) { Test-Path 'D:\\inspire-imgsafe\\venv\\Scripts\\python.exe' }
else { try { Invoke-Command -ComputerName $s -ScriptBlock { Test-Path 'D:\\inspire-imgsafe\\venv\\Scripts\\python.exe' } -ErrorAction Stop } catch { 'False' } }`;
    return new Promise((resolve) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command', probe,
        ], { windowsHide: true });

        let out = '';
        const timer = setTimeout(() => { ps.kill(); resolve(false); }, timeoutMs);
        ps.stdout.on('data', d => { out += d; });
        ps.on('error', () => { clearTimeout(timer); resolve(false); });
        ps.on('close', () => { clearTimeout(timer); resolve(/true/i.test(out)); });
    });
}

/**
 * Scan every PNG in a directory.
 *
 * @returns {Promise<Map<string, {safe: boolean, score?: number, flags: string[], error?: string}>>}
 *          keyed by filename. An empty map means the scan could not run at all.
 */
function scanDirectory(dir, { server = DEFAULT_SERVER, timeoutMs = 300000 } = {}) {
    return new Promise((resolve) => {
        const results = new Map();
        const ps = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath(), '-Dir', dir, '-Server', server,
        ], { windowsHide: true });

        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { ps.kill(); }, timeoutMs);

        ps.stdout.on('data', d => { stdout += d; });
        ps.stderr.on('data', d => { stderr += d; });
        ps.on('error', (e) => {
            clearTimeout(timer);
            results.set('__error__', { safe: false, flags: [], error: e.message });
            resolve(results);
        });
        ps.on('close', () => {
            clearTimeout(timer);
            // Deliberately parse stdout rather than branch on the exit code:
            // exit 1 only means "at least one flagged", which says nothing
            // about which ones.
            for (const line of stdout.split(/\r?\n/)) {
                let m;
                if ((m = /^SAFE\s+(\S.*?)\s*$/.exec(line))) {
                    results.set(m[1], { safe: true, flags: [] });
                } else if ((m = /^UNSAFE\s+(\S.*?)\s+score=(\S+)\s+flags=(.*)$/.exec(line))) {
                    results.set(m[1], {
                        safe: false,
                        score: Number(m[2]),
                        flags: m[3].split(',').map(s => s.trim()).filter(Boolean),
                    });
                } else if ((m = /^ERROR\s+(\S.*?)\s+(.*)$/.exec(line))) {
                    results.set(m[1], { safe: false, flags: [], error: m[2] });
                }
            }
            if (!results.size && stderr.trim()) {
                results.set('__error__', { safe: false, flags: [], error: stderr.trim().slice(0, 300) });
            }
            resolve(results);
        });
    });
}

/**
 * Decide which staged images may be uploaded.
 *
 * @param {string} dir  directory of staged PNGs
 * @param {string[]} filenames  the files we care about
 * @returns {Promise<{verdicts: Map, mode: string, scanned: boolean}>}
 */
async function screen(dir, filenames, { mode = MODE, logger = console } = {}) {
    const verdicts = new Map();

    if (mode === 'off') {
        filenames.forEach(f => verdicts.set(f, { safe: true, flags: [], skipped: true }));
        return { verdicts, mode, scanned: false };
    }

    const available = await isAvailable();
    if (!available) {
        const safe = mode !== 'enforce';
        logger.warn(
            `[safety] scanner unavailable — ${safe
                ? 'mode=warn, publishing unscanned images'
                : 'mode=enforce, holding all images back'}`
        );
        filenames.forEach(f => verdicts.set(f, {
            safe, flags: [], error: 'scanner unavailable',
        }));
        return { verdicts, mode, scanned: false };
    }

    const scanned = await scanDirectory(dir);
    for (const name of filenames) {
        const v = scanned.get(name);
        if (v) { verdicts.set(name, v); continue; }
        // Present on disk but absent from the report: treat as unscanned, and
        // apply the same fail-closed rule.
        verdicts.set(name, {
            safe: mode !== 'enforce', flags: [], error: 'no verdict returned',
        });
    }

    const flagged = [...verdicts.entries()].filter(([, v]) => !v.safe);
    if (flagged.length) {
        logger.warn(`[safety] ${flagged.length}/${filenames.length} flagged: `
            + flagged.map(([n, v]) => `${n}(${v.flags.join('/') || v.error})`).join(', '));
    } else {
        logger.log(`[safety] ${filenames.length} image(s) cleared`);
    }

    return { verdicts, mode, scanned: true };
}

module.exports = {
    MODE,
    DEFAULT_SERVER,
    isWindows,
    isAvailable,
    scanDirectory,
    screen,
};
