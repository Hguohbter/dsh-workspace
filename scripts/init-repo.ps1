# Initialize the git repository for this workspace.
# Must run in a DSH session whose workspace IS D:\Dev\dsh-workspace:
# the Windows ACL sandbox only lets subprocesses write inside the session workspace.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if (Test-Path .git) {
    Write-Host 'Repository already initialized - nothing to do.' -ForegroundColor Yellow
    git --no-pager log --oneline -3
    exit 0
}

git init -b main
git config user.name 'Hgh'
git config user.email 'm17383652469@outlook.com'
git add -A
git commit -m 'chore: initialize dsh workspace' -m 'Layout: AGENTS.md, README.md, .gitignore, scripts/, scratch/.'

Write-Host "`n--- log ---"
git --no-pager log --oneline
Write-Host "`n--- status ---"
git status --short
