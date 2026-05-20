$port = 8080
$path = "c:\Users\user\Desktop\school-telematics-cloud"

echo "Running server at http://localhost:$port"
echo "Press Ctrl+C to stop"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

# Automatically open the browser at the local server URL
Start-Process "http://localhost:$port/"

while ($true) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $fileRequest = $request.Url.LocalPath.TrimStart('/')
        if ($fileRequest -eq "") { $fileRequest = "index.html" }
        
        $fullPath = Join-Path $path $fileRequest
        
        if (Test-Path $fullPath) {
            $bytes = [System.IO.File]::ReadAllBytes($fullPath)
            
            if ($fullPath.EndsWith(".html")) { $response.ContentType = "text/html" }
            elseif ($fullPath.EndsWith(".css")) { $response.ContentType = "text/css" }
            elseif ($fullPath.EndsWith(".js")) { $response.ContentType = "text/javascript" }
            
            # Disable aggressive browser caching for local development
            $response.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            $response.Headers.Add("Pragma", "no-cache")
            $response.Headers.Add("Expires", "0")
            
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        else {
            $response.StatusCode = 404
        }
        $response.Close()
    }
    catch {
        echo $_.Exception.Message
    }
}
