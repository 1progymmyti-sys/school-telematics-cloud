$port = 8080
$path = "c:\Users\user\Desktop\school-telematics-cloud"

echo "Running server at http://localhost:$port"
echo "Press Ctrl+C to stop"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

while ($true) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $fileRequest = $request.Url.LocalPath.TrimStart('/')
        if ($fileRequest -eq "") { $fileRequest = "admin.html" }
        
        $fullPath = Join-Path $path $fileRequest
        
        if (Test-Path $fullPath) {
            $bytes = [System.IO.File]::ReadAllBytes($fullPath)
            
            if ($fullPath.EndsWith(".html")) { $response.ContentType = "text/html" }
            elseif ($fullPath.EndsWith(".css")) { $response.ContentType = "text/css" }
            elseif ($fullPath.EndsWith(".js")) { $response.ContentType = "text/javascript" }
            
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
