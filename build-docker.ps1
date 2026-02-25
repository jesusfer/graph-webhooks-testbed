$imageName = "graphwebhooks:latest"

docker build --pull --rm -f (Join-Path $PSScriptRoot "Dockerfile") -t $imageName $PSScriptRoot

Write-Host "Image '$imageName' built successfully"
