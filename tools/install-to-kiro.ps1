# Windows installer: copy converted Kiro artifacts into the Kiro CLI config tree.
#
# Kiro CLI (kiro-cli chat) reads:
#   Agents  : <config>\cli-agents\*.json   (select with /agent or --agent <name>)
#   Prompts : <config>\prompts\*.md         (invoke with @<name> in chat)
#   Rules   : <config>\rules\*.md           (always-on steering context)
#
# The config root is the KIRO CLI home. On most installs that is one of:
#   %USERPROFILE%\.aws\amazonq          (Amazon Q / Kiro CLI shared home)
#   %USERPROFILE%\.kiro
# Set -ConfigRoot explicitly if yours differs.

param(
    [string]$Source     = "$PSScriptRoot\..\kiro-converted",
    [string]$ConfigRoot = "$env:USERPROFILE\.aws\amazonq",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$src = Resolve-Path $Source
Write-Host "Source     : $src"
Write-Host "ConfigRoot : $ConfigRoot"
Write-Host ("DryRun     : {0}" -f $DryRun.IsPresent)
Write-Host ""

$map = @(
    @{ From = "cli-agents"; To = "cli-agents" },
    @{ From = "prompts";    To = "prompts"    },
    @{ From = "rules";      To = "rules"       },
    @{ From = "resources";  To = "resources"   }
)

foreach ($m in $map) {
    $fromDir = Join-Path $src $m.From
    if (-not (Test-Path $fromDir)) { continue }
    $toDir = Join-Path $ConfigRoot $m.To
    $files = Get-ChildItem $fromDir -Recurse -File
    Write-Host ("{0,-11} {1} files -> {2}" -f $m.From, $files.Count, $toDir)
    if ($DryRun) { continue }
    New-Item -ItemType Directory -Force -Path $toDir | Out-Null
    Copy-Item -Path (Join-Path $fromDir '*') -Destination $toDir -Recurse -Force
}

Write-Host ""
if ($DryRun) {
    Write-Host "Dry run complete. Re-run without -DryRun to copy."
} else {
    Write-Host "Done. Start 'kiro-cli chat' and:"
    Write-Host "  - list prompts with @ ,   e.g.  @hunt   @skill-hunt-xss"
    Write-Host "  - switch agents with /agent, e.g.  /agent maui-expert"
}
