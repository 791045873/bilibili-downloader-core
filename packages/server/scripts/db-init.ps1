# 数据库 schema 演进：把 packages/server/.env 的 DATABASE_URL 注入环境后
# 执行 prisma db init（对已签名旧库只补 additive 差异，幂等），随后 db verify 校验。
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path .env)) {
  Write-Error "未找到 packages/server/.env，请先配置 DATABASE_URL"
  exit 1
}
$line = (Select-String -Path .env -Pattern '^DATABASE_URL=' | Select-Object -First 1).Line
if (-not $line) {
  Write-Error "packages/server/.env 中未找到 DATABASE_URL"
  exit 1
}
$env:DATABASE_URL = ($line -replace '^DATABASE_URL=', '').Trim()

& pnpm exec prisma db init
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& pnpm exec prisma db verify
exit $LASTEXITCODE
