# build-and-save.ps1
# 一键构建 bilibili-downloader 的两个镜像（Linux/AMD64），并分别 docker save 为独立 tar 包（不合并）。
#
# 用法（可在仓库任意目录执行）:
#   pwsh ./packages/docker/build-and-save.ps1
#   pwsh ./packages/docker/build-and-save.ps1 -OutputDir D:\images     # 自定义输出目录
#   pwsh ./packages/docker/build-and-save.ps1 -Compress                # 每个 tar 额外 gzip 压缩
#   pwsh ./packages/docker/build-and-save.ps1 -DryRun                  # 只打印将执行的命令，不真正执行

[CmdletBinding()]
param(
    [string]$OutputDir,
    [switch]$Compress,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw '未找到 docker 命令，请先安装/启动 Docker。'
}

$repoRoot  = Resolve-Path (Join-Path (Join-Path $PSScriptRoot '..') '..')
if (-not $OutputDir) { $OutputDir = Join-Path $repoRoot 'dist' 'docker' }
$OutputDir = [IO.Path]::GetFullPath($OutputDir)

if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null }

$platform   = 'linux/amd64'
$dockerfile = Join-Path $repoRoot 'packages' 'docker' 'Dockerfile'
$context    = $repoRoot

$images = @(
    @{ Tag = 'bilibili-downloader:vision-proxy'; Target = 'vision-proxy'; SaveName = 'bilibili-downloader-vision-proxy_linux-amd64.tar' },
    @{ Tag = 'bilibili-downloader';              Target = 'server';       SaveName = 'bilibili-downloader-server_linux-amd64.tar' }
)

foreach ($img in $images) {
    # 1) 构建镜像
    if ($DryRun) {
        Write-Host "[dry-run] docker build --platform $platform --target $($img.Target) -t $($img.Tag) -f $dockerfile $context"
    } else {
        Write-Host "==> 构建 $($img.Tag) (target: $($img.Target))" -ForegroundColor Cyan
        docker build --platform $platform --target $img.Target -t $img.Tag -f $dockerfile $context
        if ($LASTEXITCODE -ne 0) { throw "docker build 失败: $($img.Tag)" }
    }

    # 2) 校验平台确为 linux/amd64
    if (-not $DryRun) {
        $arch = (docker image inspect $img.Tag --format '{{.Os}}/{{.Architecture}}').Trim()
        if ($arch -ne $platform) { throw "$($img.Tag) 平台为 $arch，不符合 $platform" }
        Write-Host "    平台校验通过: $arch" -ForegroundColor Yellow
    }

    # 3) 分别导出独立 tar（不合并到同一文件）
    $tar = Join-Path $OutputDir $img.SaveName
    if ($DryRun) {
        Write-Host "[dry-run] docker save $($img.Tag) -o $tar"
    } else {
        Write-Host "==> 导出 $($img.Tag) -> $tar" -ForegroundColor Cyan
        docker save $img.Tag -o $tar
        if ($LASTEXITCODE -ne 0) { throw "docker save 失败: $($img.Tag)" }
    }

    # 4) 可选 gzip
    if ($Compress) {
        $gz = "$tar.gz"
        if ($DryRun) {
            Write-Host "[dry-run] tar -czf $gz -C $OutputDir $($img.SaveName)"
        } else {
            Write-Host "==> 压缩 $gz" -ForegroundColor Cyan
            tar -czf $gz -C $OutputDir $img.SaveName
            if ($LASTEXITCODE -ne 0) { throw "gzip 压缩失败: $tar" }
            Remove-Item $tar
        }
    }
}

if ($DryRun) {
    Write-Host "`n[dry-run] 以上命令将被执行。目标平台: $platform，输出目录: $OutputDir"
} else {
    Write-Host "`n完成。两个独立镜像包已输出到: $OutputDir" -ForegroundColor Green
    Get-ChildItem $OutputDir -File | ForEach-Object { Write-Host "  - $($_.Name)  ($([math]::Round($_.Length / 1MB, 1)) MB)" }
}
