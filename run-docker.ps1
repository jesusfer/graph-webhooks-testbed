$imageName = "graphwebhooks:latest"
$containerName = "graphwebhooks"
$envFile = Join-Path $PSScriptRoot ".env"

if (-not (Test-Path $envFile)) {
    Write-Error "No .env file found at $envFile"
    exit 1
}

# Remove any existing container with the same name
docker rm -f $containerName 2>$null

docker run -d `
    --name $containerName `
    --env-file $envFile `
    -p 3000:3000 `
    $imageName

Write-Host "Container '$containerName' started on http://localhost:3000"
